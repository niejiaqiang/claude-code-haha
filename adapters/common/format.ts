/**
 * 消息格式化工具
 */

/** Split text into chunks that fit within a character limit, respecting paragraph/sentence boundaries. */
export function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    let splitAt = remaining.lastIndexOf('\n\n', limit)
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', limit)
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('. ', limit)
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', limit)
    if (splitAt <= 0) splitAt = limit

    // Include the delimiter for paragraph/sentence breaks
    if (remaining[splitAt] === '\n' || remaining[splitAt] === '.') splitAt += 1

    chunks.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}

/** Format tool use info for display in IM. */
export function formatToolUse(toolName: string, input: unknown): string {
  const preview = truncateInput(input, 200)
  return `🔧 ${toolName}\n${preview}`
}

/** Format a permission request for display in IM. */
export function formatPermissionRequest(toolName: string, input: unknown, requestId: string): string {
  const preview = truncateInput(input, 300)
  return `🔐 需要权限确认 [${requestId}]\n工具: ${toolName}\n${preview}`
}

/** Truncate tool input to a preview string. */
export function truncateInput(input: unknown, maxLen: number): string {
  try {
    const s = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
  } catch {
    return '(unserializable)'
  }
}

/** Escape special characters for Telegram MarkdownV2. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}
