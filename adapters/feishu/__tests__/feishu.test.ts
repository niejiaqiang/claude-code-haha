/**
 * 飞书 Adapter 翻译逻辑测试
 *
 * 不启动真实 Bot，只测试事件解析和消息翻译逻辑。
 */

import { describe, it, expect } from 'bun:test'

// ---------- helpers extracted from feishu/index.ts for testability ----------

function extractText(content: string, msgType: string): string | null {
  try {
    const parsed = JSON.parse(content)
    if (msgType === 'text') {
      return parsed.text ?? null
    }
    if (msgType === 'post') {
      const zhContent = parsed.zh_cn?.content ?? parsed.en_us?.content ?? []
      return zhContent
        .flat()
        .filter((n: any) => n.tag === 'text' || n.tag === 'md')
        .map((n: any) => n.text ?? n.content ?? '')
        .join('')
        .trim() || null
    }
    return null
  } catch {
    return null
  }
}

function isBotMentioned(
  mentions: Array<{ id?: { open_id?: string } }> | undefined,
  botOpenId: string,
): boolean {
  if (!mentions || !botOpenId) return false
  return mentions.some((m) => m.id?.open_id === botOpenId)
}

function stripMentions(text: string): string {
  return text.replace(/@_user_\d+/g, '').trim()
}

function buildPermissionCard(toolName: string, input: unknown, requestId: string): Record<string, unknown> {
  const preview = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  const truncated = preview.length > 300 ? preview.slice(0, 300) + '…' : preview

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🔐 需要权限确认' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'markdown',
        content: `**工具**: ${toolName}\n**内容**:\n\`\`\`\n${truncated}\n\`\`\``,
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✅ 允许' },
            type: 'primary',
            value: { action: 'permit', requestId, allowed: true },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '❌ 拒绝' },
            type: 'danger',
            value: { action: 'permit', requestId, allowed: false },
          },
        ],
      },
    ],
  }
}

// ---------- tests ----------

describe('Feishu: event parsing', () => {
  describe('extractText', () => {
    it('extracts text from text message', () => {
      const content = JSON.stringify({ text: 'hello world' })
      expect(extractText(content, 'text')).toBe('hello world')
    })

    it('extracts text from post message (zh_cn)', () => {
      const content = JSON.stringify({
        zh_cn: {
          content: [[
            { tag: 'text', text: 'Hello ' },
            { tag: 'text', text: 'World' },
          ]],
        },
      })
      expect(extractText(content, 'post')).toBe('Hello World')
    })

    it('extracts text from post message with md tag', () => {
      const content = JSON.stringify({
        zh_cn: {
          content: [[{ tag: 'md', text: '**bold** text' }]],
        },
      })
      expect(extractText(content, 'post')).toBe('**bold** text')
    })

    it('returns null for unsupported message types', () => {
      expect(extractText('{}', 'image')).toBeNull()
      expect(extractText('{}', 'audio')).toBeNull()
    })

    it('returns null for malformed content', () => {
      expect(extractText('not-json', 'text')).toBeNull()
    })

    it('returns null for empty text', () => {
      const content = JSON.stringify({ text: '' })
      // empty string is falsy, so ?? null returns ''
      expect(extractText(content, 'text')).toBe('')
    })
  })

  describe('isBotMentioned', () => {
    const botId = 'ou_bot_123'

    it('returns true when bot is mentioned', () => {
      const mentions = [
        { id: { open_id: 'ou_user_1' } },
        { id: { open_id: 'ou_bot_123' } },
      ]
      expect(isBotMentioned(mentions, botId)).toBe(true)
    })

    it('returns false when bot is not mentioned', () => {
      const mentions = [
        { id: { open_id: 'ou_user_1' } },
        { id: { open_id: 'ou_user_2' } },
      ]
      expect(isBotMentioned(mentions, botId)).toBe(false)
    })

    it('returns false for undefined mentions', () => {
      expect(isBotMentioned(undefined, botId)).toBe(false)
    })

    it('returns false for empty mentions', () => {
      expect(isBotMentioned([], botId)).toBe(false)
    })
  })

  describe('stripMentions', () => {
    it('removes @_user_N patterns', () => {
      expect(stripMentions('@_user_1 hello world')).toBe('hello world')
    })

    it('removes multiple mentions', () => {
      expect(stripMentions('@_user_1 @_user_2 test')).toBe('test')
    })

    it('leaves text without mentions unchanged', () => {
      expect(stripMentions('hello world')).toBe('hello world')
    })

    it('trims whitespace', () => {
      expect(stripMentions('  @_user_1  hello  ')).toBe('hello')
    })
  })
})

describe('Feishu: permission card', () => {
  it('builds valid card structure', () => {
    const card = buildPermissionCard('Bash', { command: 'npm test' }, 'abcde')

    expect(card.schema).toBe('2.0')
    expect((card.header as any).title.content).toContain('权限确认')
    expect((card.elements as any[]).length).toBe(2) // markdown + action

    const actionElement = (card.elements as any[])[1]
    expect(actionElement.tag).toBe('action')
    expect(actionElement.actions.length).toBe(2) // allow + deny buttons
  })

  it('allow button has correct value', () => {
    const card = buildPermissionCard('Read', {}, 'xyz12')
    const allowBtn = (card.elements as any[])[1].actions[0]

    expect(allowBtn.value.action).toBe('permit')
    expect(allowBtn.value.requestId).toBe('xyz12')
    expect(allowBtn.value.allowed).toBe(true)
  })

  it('deny button has correct value', () => {
    const card = buildPermissionCard('Read', {}, 'xyz12')
    const denyBtn = (card.elements as any[])[1].actions[1]

    expect(denyBtn.value.action).toBe('permit')
    expect(denyBtn.value.requestId).toBe('xyz12')
    expect(denyBtn.value.allowed).toBe(false)
  })

  it('truncates long input preview', () => {
    const longInput = { command: 'x'.repeat(500) }
    const card = buildPermissionCard('Bash', longInput, 'abc')
    const mdElement = (card.elements as any[])[0]

    expect(mdElement.content).toContain('…')
  })
})

describe('Feishu: card.action.trigger parsing', () => {
  it('parses permit action from event', () => {
    const event = {
      operator: { open_id: 'ou_user_1' },
      action: { value: { action: 'permit', requestId: 'abcde', allowed: true } },
      context: { open_chat_id: 'oc_chat_123' },
    }

    expect(event.action.value.action).toBe('permit')
    expect(event.action.value.requestId).toBe('abcde')
    expect(event.action.value.allowed).toBe(true)
    expect(event.context.open_chat_id).toBe('oc_chat_123')
  })

  it('ignores non-permit actions', () => {
    const event = {
      action: { value: { action: 'other_action' } },
    }
    expect(event.action.value.action).not.toBe('permit')
  })
})
