import type { FileAttachment } from './types.js'

/** 选图结果：保留的图片 id、占用的图片块数与体积估算 */
export type ImageBudgetPlan = {
  keep: Set<string>
  blocks: number
  bytes: number
}

/** 历史图片最多占用的预算比例，剩下的留给当前提问（保证刚发的图能进请求） */
const HISTORY_SHARE = 0.75

/**
 * 挑选要纳入请求的图片，规则是「只追加、不重排」，让提示词缓存的前缀保持稳定。
 *
 * 服务端按前缀缓存 token（`cache_read_input_tokens`），只要请求前缀里任何一张图被
 * 换掉、少掉或补传换了 file_id，从那一张开始后面的历史全部算未命中。
 * 因此这里不用「最新优先」的滑动窗口，而是：
 * 1. 当前提问的图片优先纳入（它们位于上下文末尾，不改变更早的前缀）；
 * 2. 历史图片按时间正序（最早→最新）依次填充预算，预算用完就停。
 *    历史只会往后追加，这一条规则保证同一轮历史在后续请求里选中的图片集合完全相同，
 *    新出现的图片最多被跳过，不会挤掉已经在上下文里的旧图片。
 *
 * 同一张图在历史里重复出现时，请求只会发一次真实 image 块（其余是文本占位，
 * 见 `toRequestMessages`），所以预算按**唯一附件 id** 计费，一个 id 只占一个块。
 *
 * @param question 本轮提问的附件
 * @param history 历史轮次的附件列表，按时间正序（最早的在前）
 * @param budgetBytes 体积预算（按估算后的单张占用累加）
 * @param maxImages 图片块数上限
 * @param estimate 单张图片的体积估算
 */
export const planRequestImages = (
  question: FileAttachment[],
  history: FileAttachment[][],
  budgetBytes: number,
  maxImages: number,
  estimate: (file: FileAttachment) => number
): ImageBudgetPlan => {
  const keep = new Set<string>()
  let blocks = 0
  let bytes = 0
  /** 按给定顺序尽量纳入；同一张图只计一次，超预算就跳过，不挤掉已纳入的 */
  const include = (files: FileAttachment[], maxBlocks: number, maxBytes: number) => {
    for (const file of files) {
      if (!file.isImage || keep.has(file.id)) {
        continue
      }
      const size = estimate(file)
      if (blocks + 1 > maxBlocks || bytes + size > maxBytes) {
        continue
      }
      keep.add(file.id)
      blocks += 1
      bytes += size
    }
  }
  // 历史先占用大部分预算（与「本轮提问带了什么图」无关），保证同一轮历史的选图结果恒定；
  // 剩下的部分留给当前提问，刚发出去的图才有位置。
  const historyBlocks = Math.max(1, Math.floor(maxImages * HISTORY_SHARE))
  const historyBytes = Math.max(1, Math.floor(budgetBytes * HISTORY_SHARE))
  for (const files of history) {
    include(files, historyBlocks, historyBytes)
  }
  include(question, maxImages, budgetBytes)
  return { keep, blocks, bytes }
}

