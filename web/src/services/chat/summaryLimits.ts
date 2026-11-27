/**
 * 摘要的三个阈值集中在这里：请求组装（reply.ts）与摘要服务（summary.ts）都要用，
 * 放在独立模块里避免两个模块互相 import 形成循环。
 */

/** 保留最近这些轮原文，不进入摘要 */
export const SUMMARY_KEEP_RECENT = 10
/** 攒够这么多新轮次才追加一次摘要，避免每轮都改变前缀导致缓存失效 */
export const SUMMARY_BATCH = 6
/** 第一次生成摘要所需的最少轮数 */
export const SUMMARY_MIN_ROUNDS = SUMMARY_KEEP_RECENT + SUMMARY_BATCH
/** 摘要正文的长度上限：超过后允许整理一次（合并成单份结构化要点） */
export const SUMMARY_MAX_CHARS = 1500
