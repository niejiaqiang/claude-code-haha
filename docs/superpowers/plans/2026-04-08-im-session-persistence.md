# IM Adapter Session 持久化改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 IM Adapter（Telegram/飞书）创建与 Desktop App 互通的持久化 Session，实现聊天记录互通、Session 恢复、项目目录选择。

**Architecture:** Adapter 在连接 WebSocket 之前，先通过 HTTP `POST /api/sessions` 创建正式 UUID Session。chatId→sessionId 映射持久化到本地 JSON 文件，adapter 重启后可恢复。用户通过 `/projects` 命令从最近项目列表选择工作目录，或使用 Settings 页面配置的默认目录。

**Tech Stack:** Bun (HTTP fetch + WebSocket), existing server REST API (`/api/sessions`, `/api/sessions/recent-projects`), JSON file persistence

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `adapters/common/session-store.ts` | Create | chatId→sessionId 持久化映射 |
| `adapters/common/http-client.ts` | Create | 调用服务端 REST API（创建 session、列出项目） |
| `adapters/common/ws-bridge.ts` | Modify | 移除自动 sessionId 生成，接受外部传入的 sessionId |
| `adapters/telegram/index.ts` | Modify | 接入 session 管理 + `/projects` 命令 |
| `adapters/feishu/index.ts` | Modify | 同 Telegram 的改造 |
| `adapters/common/config.ts` | Modify | 新增 `defaultProjectDir` 顶层配置字段 |
| `src/server/services/adapterService.ts` | Modify | AdapterFileConfig 新增 `defaultProjectDir` |
| `desktop/src/types/adapter.ts` | Modify | 前端类型同步 |
| `desktop/src/pages/AdapterSettings.tsx` | Modify | 新增"默认项目"字段 |
| `desktop/src/i18n/locales/en.ts` | Modify | i18n |
| `desktop/src/i18n/locales/zh.ts` | Modify | i18n |
| `adapters/common/__tests__/session-store.test.ts` | Create | session-store 测试 |
| `adapters/common/__tests__/http-client.test.ts` | Create | http-client 测试 |

---

### Task 1: Session Store — 持久化 chatId→sessionId 映射

**Files:**
- Create: `adapters/common/session-store.ts`
- Create: `adapters/common/__tests__/session-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// adapters/common/__tests__/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SessionStore } from '../session-store.js'

describe('SessionStore', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'))
    store = new SessionStore(path.join(tmpDir, 'sessions.json'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null for unknown chatId', () => {
    expect(store.get('unknown')).toBeNull()
  })

  it('stores and retrieves a session', () => {
    store.set('chat-1', 'uuid-aaa', '/path/to/project')
    const entry = store.get('chat-1')
    expect(entry).not.toBeNull()
    expect(entry!.sessionId).toBe('uuid-aaa')
    expect(entry!.workDir).toBe('/path/to/project')
  })

  it('overwrites existing entry on set', () => {
    store.set('chat-1', 'uuid-aaa', '/old')
    store.set('chat-1', 'uuid-bbb', '/new')
    expect(store.get('chat-1')!.sessionId).toBe('uuid-bbb')
  })

  it('deletes an entry', () => {
    store.set('chat-1', 'uuid-aaa', '/path')
    store.delete('chat-1')
    expect(store.get('chat-1')).toBeNull()
  })

  it('persists to disk and reloads', () => {
    store.set('chat-1', 'uuid-aaa', '/path')

    // Create a new store instance pointing to the same file
    const store2 = new SessionStore(path.join(tmpDir, 'sessions.json'))
    expect(store2.get('chat-1')!.sessionId).toBe('uuid-aaa')
  })

  it('handles missing file gracefully', () => {
    const store2 = new SessionStore(path.join(tmpDir, 'nonexistent.json'))
    expect(store2.get('anything')).toBeNull()
  })

  it('lists all entries', () => {
    store.set('chat-1', 'uuid-1', '/a')
    store.set('chat-2', 'uuid-2', '/b')
    const all = store.listAll()
    expect(all).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd adapters && bun test common/__tests__/session-store.test.ts`
Expected: FAIL — module `../session-store.js` not found

- [ ] **Step 3: Implement SessionStore**

```typescript
// adapters/common/session-store.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export type SessionEntry = {
  sessionId: string
  workDir: string
  updatedAt: number
}

type StoreData = Record<string, SessionEntry>

function getDefaultPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapter-sessions.json')
}

export class SessionStore {
  private data: StoreData
  private filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? getDefaultPath()
    this.data = this.load()
  }

  get(chatId: string): SessionEntry | null {
    return this.data[chatId] ?? null
  }

  set(chatId: string, sessionId: string, workDir: string): void {
    this.data[chatId] = { sessionId, workDir, updatedAt: Date.now() }
    this.save()
  }

  delete(chatId: string): void {
    delete this.data[chatId]
    this.save()
  }

  listAll(): Array<{ chatId: string } & SessionEntry> {
    return Object.entries(this.data).map(([chatId, entry]) => ({ chatId, ...entry }))
  }

  private load(): StoreData {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
    } catch {
      return {}
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${this.filePath}.tmp.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n')
    fs.renameSync(tmp, this.filePath)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd adapters && bun test common/__tests__/session-store.test.ts`
Expected: 7 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add adapters/common/session-store.ts adapters/common/__tests__/session-store.test.ts
git commit -m "feat(adapters): add persistent chatId→sessionId store"
```

---

### Task 2: HTTP Client — 调用服务端 REST API

**Files:**
- Create: `adapters/common/http-client.ts`
- Create: `adapters/common/__tests__/http-client.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// adapters/common/__tests__/http-client.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { AdapterHttpClient } from '../http-client.js'

describe('AdapterHttpClient', () => {
  let client: AdapterHttpClient
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    client = new AdapterHttpClient('ws://127.0.0.1:3456')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('derives HTTP URL from WS URL', () => {
    expect(client.httpBaseUrl).toBe('http://127.0.0.1:3456')

    const secure = new AdapterHttpClient('wss://example.com:443')
    expect(secure.httpBaseUrl).toBe('https://example.com:443')
  })

  it('createSession calls POST /api/sessions', async () => {
    const mockSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ sessionId: mockSessionId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const sessionId = await client.createSession('/path/to/project')
    expect(sessionId).toBe(mockSessionId)

    const call = (globalThis.fetch as any).mock.calls[0]
    expect(call[0]).toBe('http://127.0.0.1:3456/api/sessions')
    const body = JSON.parse(call[1].body)
    expect(body.workDir).toBe('/path/to/project')
  })

  it('listRecentProjects calls GET /api/sessions/recent-projects', async () => {
    const mockProjects = [
      { projectName: 'my-app', realPath: '/home/user/my-app', sessionCount: 3 },
    ]
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ projects: mockProjects }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const projects = await client.listRecentProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].projectName).toBe('my-app')
  })

  it('createSession throws on server error', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'workDir required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    expect(client.createSession('')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd adapters && bun test common/__tests__/http-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AdapterHttpClient**

```typescript
// adapters/common/http-client.ts
export type RecentProject = {
  projectPath: string
  realPath: string
  projectName: string
  isGit: boolean
  repoName: string | null
  branch: string | null
  modifiedAt: string
  sessionCount: number
}

export class AdapterHttpClient {
  readonly httpBaseUrl: string

  constructor(wsUrl: string) {
    this.httpBaseUrl = wsUrl
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/$/, '')
  }

  async createSession(workDir: string): Promise<string> {
    const res = await fetch(`${this.httpBaseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(`Failed to create session: ${(err as any).message}`)
    }
    const data = (await res.json()) as { sessionId: string }
    return data.sessionId
  }

  async listRecentProjects(): Promise<RecentProject[]> {
    const res = await fetch(`${this.httpBaseUrl}/api/sessions/recent-projects`)
    if (!res.ok) {
      throw new Error(`Failed to list projects: ${res.statusText}`)
    }
    const data = (await res.json()) as { projects: RecentProject[] }
    return data.projects
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd adapters && bun test common/__tests__/http-client.test.ts`
Expected: 4 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add adapters/common/http-client.ts adapters/common/__tests__/http-client.test.ts
git commit -m "feat(adapters): add HTTP client for server session API"
```

---

### Task 3: WsBridge — 支持外部传入 sessionId

**Files:**
- Modify: `adapters/common/ws-bridge.ts:46-56`
- Modify: `adapters/common/__tests__/ws-bridge.test.ts`

- [ ] **Step 1: Update ws-bridge.test.ts — add test for connectSession**

在现有测试文件末尾，`describe('WsBridge')` 块内添加：

```typescript
it('connectSession connects with provided sessionId', () => {
  bridge.connectSession('chat-1', 'my-uuid-session-id')
  expect(bridge.hasSession('chat-1')).toBe(true)
})

it('connectSession reuses existing open connection', () => {
  bridge.connectSession('chat-1', 'uuid-1')
  // Simulate WS open
  const ws1 = (bridge as any).sessions.get('chat-1')?.ws
  bridge.connectSession('chat-1', 'uuid-2')
  // Should not replace if first is still connecting/open
  // (In practice, WS is in CONNECTING state, so it gets replaced)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd adapters && bun test common/__tests__/ws-bridge.test.ts`
Expected: FAIL — `bridge.connectSession is not a function`

- [ ] **Step 3: Modify ws-bridge.ts**

Replace `getOrCreateSession` with `connectSession`:

```typescript
// In ws-bridge.ts, replace the getOrCreateSession method (lines 46-56) with:

/** Connect to a session with a known sessionId. Returns false if already connected. */
connectSession(chatId: string, sessionId: string): boolean {
  const existing = this.sessions.get(chatId)
  if (existing && existing.ws.readyState === WebSocket.OPEN) {
    return false // already connected
  }
  this.connect(chatId, sessionId)
  return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd adapters && bun test common/__tests__/ws-bridge.test.ts`
Expected: All pass (existing tests updated if they reference `getOrCreateSession`)

Note: If existing tests call `getOrCreateSession`, update them to use `connectSession` with an explicit sessionId like `'test-session-id'`.

- [ ] **Step 5: Commit**

```bash
git add adapters/common/ws-bridge.ts adapters/common/__tests__/ws-bridge.test.ts
git commit -m "refactor(ws-bridge): replace getOrCreateSession with connectSession"
```

---

### Task 4: Config — 新增 defaultProjectDir

**Files:**
- Modify: `adapters/common/config.ts:27-31`
- Modify: `src/server/services/adapterService.ts:13-29`
- Modify: `desktop/src/types/adapter.ts`
- Modify: `desktop/src/pages/AdapterSettings.tsx`
- Modify: `desktop/src/i18n/locales/en.ts`
- Modify: `desktop/src/i18n/locales/zh.ts`

- [ ] **Step 1: Add defaultProjectDir to adapter config types**

In `adapters/common/config.ts`, add to `AdapterConfig` type and `loadConfig`:

```typescript
// adapters/common/config.ts — update AdapterConfig type (line 27-31)
export type AdapterConfig = {
  serverUrl: string
  defaultProjectDir: string  // ← NEW
  telegram: TelegramConfig
  feishu: FeishuConfig
}

// In loadConfig() return statement, add:
  return {
    serverUrl: process.env.ADAPTER_SERVER_URL || file.serverUrl || 'ws://127.0.0.1:3456',
    defaultProjectDir: file.defaultProjectDir || '',  // ← NEW
    telegram: { ... },
    feishu: { ... },
  }
```

- [ ] **Step 2: Add to server-side AdapterFileConfig**

In `src/server/services/adapterService.ts`, add `defaultProjectDir` to the type (line 14):

```typescript
export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string  // ← NEW
  telegram?: { ... }
  feishu?: { ... }
}
```

- [ ] **Step 3: Add to frontend type**

In `desktop/src/types/adapter.ts`, add:

```typescript
export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string  // ← NEW
  telegram?: { ... }
  feishu?: { ... }
}
```

- [ ] **Step 4: Add UI field in AdapterSettings.tsx**

Add a `defaultProjectDir` state + `DirectoryPicker` between the server URL and the Telegram section:

```tsx
// Add import at top
import { DirectoryPicker } from '../components/shared/DirectoryPicker'

// Add state
const [defaultProjectDir, setDefaultProjectDir] = useState('')

// In useEffect config sync, add:
setDefaultProjectDir(config.defaultProjectDir ?? '')

// In handleSave, add to patch:
if (defaultProjectDir) patch.defaultProjectDir = defaultProjectDir

// In JSX, after the Server URL Input and before the Telegram section:
<div className="flex flex-col gap-1">
  <label className="text-sm font-medium text-[var(--color-text-primary)]">
    {t('settings.adapters.defaultProject')}
  </label>
  <DirectoryPicker value={defaultProjectDir} onChange={setDefaultProjectDir} />
  <p className="text-xs text-[var(--color-text-tertiary)]">
    {t('settings.adapters.defaultProjectHint')}
  </p>
</div>
```

- [ ] **Step 5: Add i18n keys**

In `desktop/src/i18n/locales/en.ts`, in the adapters section:

```typescript
'settings.adapters.defaultProject': 'Default Project',
'settings.adapters.defaultProjectHint': 'Default working directory for new IM sessions. If empty, the bot will ask you to choose.',
```

In `desktop/src/i18n/locales/zh.ts`:

```typescript
'settings.adapters.defaultProject': '默认项目',
'settings.adapters.defaultProjectHint': '新 IM 会话的默认工作目录。留空则由 Bot 询问选择。',
```

- [ ] **Step 6: Update API validation whitelist**

In `src/server/api/adapters.ts`, add `'defaultProjectDir'` to `ALLOWED_TOP_KEYS`:

```typescript
const ALLOWED_TOP_KEYS = new Set(['serverUrl', 'defaultProjectDir', 'telegram', 'feishu'])
```

- [ ] **Step 7: Run TypeScript check**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add adapters/common/config.ts src/server/services/adapterService.ts src/server/api/adapters.ts \
  desktop/src/types/adapter.ts desktop/src/pages/AdapterSettings.tsx \
  desktop/src/i18n/locales/en.ts desktop/src/i18n/locales/zh.ts
git commit -m "feat: add defaultProjectDir to adapter config and settings UI"
```

---

### Task 5: Telegram Adapter — Session 管理 + /projects 命令

**Files:**
- Modify: `adapters/telegram/index.ts`

- [ ] **Step 1: Add imports and initialization**

At the top of `adapters/telegram/index.ts`, add imports and initialize new modules:

```typescript
// Add these imports after existing ones
import { SessionStore } from '../common/session-store.js'
import { AdapterHttpClient } from '../common/http-client.js'

// After existing init section (after dedup initialization)
const sessionStore = new SessionStore()
const httpClient = new AdapterHttpClient(config.serverUrl)

// Track chats waiting for project selection
const pendingProjectSelection = new Map<string, boolean>()
```

- [ ] **Step 2: Replace setupMessageHandler with session-aware version**

Replace the current `setupMessageHandler` function with:

```typescript
async function ensureSession(chatId: string): Promise<boolean> {
  // Already connected?
  if (bridge.hasSession(chatId)) return true

  // Has stored session? Reconnect.
  const stored = sessionStore.get(chatId)
  if (stored) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    return true
  }

  // Need to create a new session — use default project or ask
  const workDir = config.defaultProjectDir
  if (workDir) {
    return await createSessionForChat(chatId, workDir)
  }

  // No default — ask user to pick
  await showProjectPicker(chatId)
  return false // message not sent yet, waiting for project selection
}

async function createSessionForChat(chatId: string, workDir: string): Promise<boolean> {
  const numericChatId = Number(chatId)
  try {
    const sessionId = await httpClient.createSession(workDir)
    sessionStore.set(chatId, sessionId, workDir)
    bridge.connectSession(chatId, sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    return true
  } catch (err) {
    await bot.api.sendMessage(numericChatId,
      `❌ 无法创建会话: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

async function showProjectPicker(chatId: string): Promise<void> {
  const numericChatId = Number(chatId)
  try {
    const projects = await httpClient.listRecentProjects()
    if (projects.length === 0) {
      await bot.api.sendMessage(numericChatId,
        '没有找到最近的项目。请先在 Desktop App 中打开一个项目，或在 Settings → IM 接入中配置默认项目。')
      return
    }

    const lines = projects.slice(0, 10).map((p, i) =>
      `${i + 1}. ${p.projectName}${p.branch ? ` (${p.branch})` : ''}\n   ${p.realPath}`
    )
    pendingProjectSelection.set(chatId, true)
    await bot.api.sendMessage(numericChatId,
      `选择项目（回复编号）：\n\n${lines.join('\n\n')}`)
  } catch (err) {
    await bot.api.sendMessage(numericChatId,
      `❌ 无法获取项目列表: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 3: Extract handleServerMessage from inline closure**

Extract the server message handler (currently the inline `async (msg: ServerMessage) => { ... }` in the old `setupMessageHandler`) into a standalone function. The body is the same `switch(msg.type)` block, just named:

```typescript
async function handleServerMessage(chatId: string, msg: ServerMessage): Promise<void> {
  const numericChatId = Number(chatId)
  const buf = getBuffer(chatId)

  switch (msg.type) {
    // ... exact same cases as before (status, content_start, content_delta,
    //     thinking, tool_use_complete, tool_result, permission_request,
    //     message_complete, error)
    // No changes to the switch body.
  }
}
```

- [ ] **Step 4: Update /new command**

Replace the `/new` command handler:

```typescript
bot.command('new', async (ctx) => {
  const chatId = String(ctx.chat.id)
  // Clean up current session state
  bridge.resetSession(chatId)
  sessionStore.delete(chatId)
  placeholders.delete(chatId)
  accumulatedText.delete(chatId)
  buffers.get(chatId)?.reset()
  buffers.delete(chatId)
  pendingProjectSelection.delete(chatId)
  // Show project picker for next session
  await showProjectPicker(chatId)
})
```

- [ ] **Step 5: Add /projects command**

```typescript
bot.command('projects', async (ctx) => {
  const chatId = String(ctx.chat.id)
  await showProjectPicker(chatId)
})
```

- [ ] **Step 6: Update message handler for project selection + normal messages**

Replace the `bot.on('message:text')` handler:

```typescript
bot.on('message:text', (ctx) => {
  if (!ctx.from || !isAllowed(ctx.from.id)) return
  if (!dedup.tryRecord(String(ctx.message.message_id))) return

  const chatId = String(ctx.chat.id)
  const text = ctx.message.text

  enqueue(chatId, async () => {
    // Check if user is responding to project selection
    if (pendingProjectSelection.has(chatId)) {
      const num = parseInt(text, 10)
      if (num >= 1) {
        try {
          const projects = await httpClient.listRecentProjects()
          const selected = projects[num - 1]
          if (selected) {
            pendingProjectSelection.delete(chatId)
            await createSessionForChat(chatId, selected.realPath)
            await bot.api.sendMessage(Number(chatId),
              `✅ 已选择 ${selected.projectName}。现在可以开始对话了。`)
            return
          }
        } catch { /* fall through to normal handling */ }
      }
      // Invalid selection — tell user
      await bot.api.sendMessage(Number(chatId), '请输入有效的编号。')
      return
    }

    // Normal message flow
    const ready = await ensureSession(chatId)
    if (ready) {
      bridge.sendUserMessage(chatId, text)
    }
    // If not ready, ensureSession already showed the project picker
  })
})
```

- [ ] **Step 7: Update /start command help text**

```typescript
bot.command('start', (ctx) => {
  ctx.reply(
    '👋 Claude Code Bot 已就绪。\n\n' +
    '命令:\n' +
    '/projects — 选择/切换项目\n' +
    '/new — 新建会话\n' +
    '/stop — 停止生成'
  )
})
```

- [ ] **Step 8: Update SIGINT handler — add sessionStore**

No change needed, sessionStore is sync-write so data is already persisted.

- [ ] **Step 9: Run all adapter tests**

Run: `cd adapters && bun test`
Expected: All pass (telegram mock tests may need updating if they reference `getOrCreateSession` — update mocks to use `connectSession`)

- [ ] **Step 10: Commit**

```bash
git add adapters/telegram/index.ts
git commit -m "feat(telegram): session persistence, /projects command, project selection"
```

---

### Task 6: Feishu Adapter — Session 管理 + /projects 命令

**Files:**
- Modify: `adapters/feishu/index.ts`

- [ ] **Step 1: Add imports and initialization**

Same pattern as Telegram — add at the top:

```typescript
import { SessionStore } from '../common/session-store.js'
import { AdapterHttpClient } from '../common/http-client.js'

// After existing init
const sessionStore = new SessionStore()
const httpClient = new AdapterHttpClient(config.serverUrl)
const pendingProjectSelection = new Map<string, boolean>()
```

- [ ] **Step 2: Add ensureSession, createSessionForChat, showProjectPicker**

Same functions as Telegram, but using `sendText(chatId, text)` instead of `bot.api.sendMessage(...)`:

```typescript
async function ensureSession(chatId: string): Promise<boolean> {
  if (bridge.hasSession(chatId)) return true

  const stored = sessionStore.get(chatId)
  if (stored) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    return true
  }

  const workDir = config.defaultProjectDir
  if (workDir) {
    return await createSessionForChat(chatId, workDir)
  }

  await showProjectPicker(chatId)
  return false
}

async function createSessionForChat(chatId: string, workDir: string): Promise<boolean> {
  try {
    const sessionId = await httpClient.createSession(workDir)
    sessionStore.set(chatId, sessionId, workDir)
    bridge.connectSession(chatId, sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    return true
  } catch (err) {
    await sendText(chatId, `❌ 无法创建会话: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

async function showProjectPicker(chatId: string): Promise<void> {
  try {
    const projects = await httpClient.listRecentProjects()
    if (projects.length === 0) {
      await sendText(chatId,
        '没有找到最近的项目。请先在 Desktop App 中打开一个项目，或在设置中配置默认项目。')
      return
    }
    const lines = projects.slice(0, 10).map((p, i) =>
      `${i + 1}. **${p.projectName}**${p.branch ? ` (${p.branch})` : ''}\n   ${p.realPath}`
    )
    pendingProjectSelection.set(chatId, true)
    await sendText(chatId, `选择项目（回复编号）：\n\n${lines.join('\n\n')}`)
  } catch (err) {
    await sendText(chatId, `❌ 无法获取项目列表: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 3: Extract handleServerMessage**

Same as Telegram — extract the `switch(msg.type)` body from the inline closure in old `setupMessageHandler` into a standalone `handleServerMessage(chatId, msg)` function.

- [ ] **Step 4: Update command handling in handleMessage**

In the `handleMessage` function, update the command section (around line 364):

```typescript
  // Handle commands
  if (text === '/new' || text === '新会话') {
    bridge.resetSession(chatId)
    sessionStore.delete(chatId)
    chatStates.delete(chatId)
    accumulatedText.delete(chatId)
    buffers.get(chatId)?.reset()
    buffers.delete(chatId)
    pendingProjectSelection.delete(chatId)
    await showProjectPicker(chatId)
    return
  }
  if (text === '/stop' || text === '停止') {
    bridge.sendStopGeneration(chatId)
    await sendText(chatId, '⏹ 已发送停止信号。')
    return
  }
  if (text === '/projects' || text === '项目列表') {
    await showProjectPicker(chatId)
    return
  }

  // Check if user is responding to project selection
  if (pendingProjectSelection.has(chatId)) {
    const num = parseInt(text, 10)
    if (num >= 1) {
      try {
        const projects = await httpClient.listRecentProjects()
        const selected = projects[num - 1]
        if (selected) {
          pendingProjectSelection.delete(chatId)
          await createSessionForChat(chatId, selected.realPath)
          await sendText(chatId, `✅ 已选择 **${selected.projectName}**。现在可以开始对话了。`)
          return
        }
      } catch { /* fall through */ }
    }
    await sendText(chatId, '请输入有效的编号。')
    return
  }

  // Normal message flow
  enqueue(chatId, async () => {
    const ready = await ensureSession(chatId)
    if (ready) {
      bridge.sendUserMessage(chatId, text!)
    }
  })
```

- [ ] **Step 5: Run all adapter tests**

Run: `cd adapters && bun test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add adapters/feishu/index.ts
git commit -m "feat(feishu): session persistence, /projects command, project selection"
```

---

### Task 7: Update existing tests for API changes

**Files:**
- Modify: `adapters/telegram/__tests__/telegram.test.ts`
- Modify: `adapters/feishu/__tests__/feishu.test.ts`
- Modify: `adapters/common/__tests__/ws-bridge.test.ts`

- [ ] **Step 1: Update ws-bridge tests**

Replace any `getOrCreateSession` calls with `connectSession`:

```typescript
// Find: bridge.getOrCreateSession('chat-1')
// Replace: bridge.connectSession('chat-1', 'test-session-id')
```

- [ ] **Step 2: Update telegram tests**

Update the mocked bridge to use `connectSession` instead of `getOrCreateSession`. Update any mock setup that references the old API.

- [ ] **Step 3: Update feishu tests**

Same as telegram test updates.

- [ ] **Step 4: Run all tests**

Run: `cd adapters && bun test`
Expected: All pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add adapters/telegram/__tests__/telegram.test.ts adapters/feishu/__tests__/feishu.test.ts \
  adapters/common/__tests__/ws-bridge.test.ts
git commit -m "test: update adapter tests for connectSession API"
```

---

### Task 8: Final TypeScript check + verify Desktop build

**Files:** None new — verification only.

- [ ] **Step 1: TypeScript check for desktop**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all adapter tests**

Run: `cd adapters && bun test`
Expected: All pass

- [ ] **Step 3: Verify adapters.json is properly written**

Run: `cat ~/.claude/adapters.json` (if exists)
Verify `defaultProjectDir` field can be read.

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: fixup after session persistence integration"
```
