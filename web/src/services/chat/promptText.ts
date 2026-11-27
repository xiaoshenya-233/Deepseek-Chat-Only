/**
 * 自定义提示词包裹：把用户设定放在系统提示末尾，并用明确的分隔与优先级说明，
 * 避免被默认人设或很长的历史上下文淹没（模型对末尾内容的依从性更好）。
 */
export const PROMPT_PRIORITY_HEADER = '【对话设定｜优先于默认风格，始终遵守】'

export const composeSystemPrompt = (base: string, custom: string): string => {
  const trimmed = custom.trim()
  if (!trimmed) {
    return base
  }
  return `${base}\n\n${PROMPT_PRIORITY_HEADER}\n${trimmed}`
}
