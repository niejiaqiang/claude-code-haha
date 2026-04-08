import { describe, it, expect } from 'bun:test'
import {
  splitMessage,
  formatToolUse,
  formatPermissionRequest,
  truncateInput,
  escapeMarkdownV2,
} from '../format.js'

describe('splitMessage', () => {
  it('returns single chunk for short text', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello'])
  })

  it('splits at paragraph boundary', () => {
    const text = 'First paragraph.\n\nSecond paragraph.'
    const chunks = splitMessage(text, 20)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('First paragraph')
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('Second paragraph')
  })

  it('splits at newline if no paragraph break', () => {
    const text = 'Line one\nLine two\nLine three\nLine four'
    const chunks = splitMessage(text, 20)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('hard-splits at limit if no natural break', () => {
    const text = 'a'.repeat(50)
    const chunks = splitMessage(text, 20)
    expect(chunks.length).toBe(3) // 20 + 20 + 10
    expect(chunks.every((c) => c.length <= 20)).toBe(true)
  })

  it('preserves all content after splitting', () => {
    const text = 'Hello world. This is a test. Foo bar baz.'
    const chunks = splitMessage(text, 15)
    const joined = chunks.join(' ')
    // All words should be present
    expect(joined).toContain('Hello')
    expect(joined).toContain('test')
    expect(joined).toContain('baz')
  })
})

describe('formatToolUse', () => {
  it('includes tool name and input preview', () => {
    const result = formatToolUse('Bash', { command: 'npm test' })
    expect(result).toContain('🔧 Bash')
    expect(result).toContain('npm test')
  })
})

describe('formatPermissionRequest', () => {
  it('includes tool name, input preview, and request ID', () => {
    const result = formatPermissionRequest('Bash', { command: 'rm -rf /' }, 'abcde')
    expect(result).toContain('🔐')
    expect(result).toContain('Bash')
    expect(result).toContain('abcde')
    expect(result).toContain('rm -rf')
  })
})

describe('truncateInput', () => {
  it('returns short input as-is', () => {
    expect(truncateInput('hello', 100)).toBe('hello')
  })

  it('truncates long input with ellipsis', () => {
    const long = 'x'.repeat(300)
    const result = truncateInput(long, 100)
    expect(result.length).toBe(101) // 100 chars + '…'
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles objects by stringifying', () => {
    const result = truncateInput({ key: 'value' }, 100)
    expect(result).toContain('key')
    expect(result).toContain('value')
  })

  it('handles unserializable input', () => {
    const circular: any = {}
    circular.self = circular
    expect(truncateInput(circular, 100)).toBe('(unserializable)')
  })
})

describe('escapeMarkdownV2', () => {
  it('escapes special characters', () => {
    expect(escapeMarkdownV2('hello_world')).toBe('hello\\_world')
    expect(escapeMarkdownV2('a*b*c')).toBe('a\\*b\\*c')
    expect(escapeMarkdownV2('test.md')).toBe('test\\.md')
  })

  it('leaves plain text unchanged', () => {
    expect(escapeMarkdownV2('hello world')).toBe('hello world')
  })
})
