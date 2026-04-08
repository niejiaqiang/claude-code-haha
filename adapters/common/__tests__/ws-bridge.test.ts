import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { WsBridge } from '../ws-bridge.js'

describe('WsBridge', () => {
  let bridge: WsBridge

  beforeEach(() => {
    bridge = new WsBridge('ws://127.0.0.1:19999', 'test')
  })

  afterEach(() => {
    bridge.destroy()
  })

  it('connectSession connects with provided sessionId', () => {
    const result = bridge.connectSession('chat-1', 'my-uuid-session-id')
    expect(result).toBe(true)
    expect(bridge.hasSession('chat-1')).toBe(true)
  })

  it('connectSession for different chatIds creates separate sessions', () => {
    bridge.connectSession('chat-1', 'uuid-1')
    bridge.connectSession('chat-2', 'uuid-2')
    expect(bridge.hasSession('chat-1')).toBe(true)
    expect(bridge.hasSession('chat-2')).toBe(true)
  })

  it('resetSession removes the session', () => {
    bridge.connectSession('chat-reset', 'uuid-reset')
    bridge.resetSession('chat-reset')
    expect(bridge.hasSession('chat-reset')).toBe(false)
  })

  it('sendUserMessage returns false when no open connection', () => {
    bridge.connectSession('chat-offline', 'uuid-offline')
    expect(bridge.sendUserMessage('chat-offline', 'hello')).toBe(false)
  })

  it('sendPermissionResponse returns false when no open connection', () => {
    bridge.connectSession('chat-perm', 'uuid-perm')
    expect(bridge.sendPermissionResponse('chat-perm', 'req-1', true)).toBe(false)
  })

  it('sendStopGeneration returns false when no open connection', () => {
    bridge.connectSession('chat-stop', 'uuid-stop')
    expect(bridge.sendStopGeneration('chat-stop')).toBe(false)
  })

  it('destroy cleans up all sessions', () => {
    bridge.connectSession('a', 'uuid-a')
    bridge.connectSession('b', 'uuid-b')
    bridge.destroy()
    expect(bridge.hasSession('a')).toBe(false)
    expect(bridge.hasSession('b')).toBe(false)
  })
})
