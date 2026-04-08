# Claude Code IM Adapters

通过 Telegram / 飞书与 Claude Code Desktop 对话。

每个 Adapter 是一个轻量独立脚本，直连 Desktop 服务端的 WebSocket 接口，与桌面 UI 走完全相同的协议。

## 架构

```
Telegram / 飞书
      ↕ (各平台 SDK)
IM Adapter (独立脚本)
      ↕ ws://localhost:3456/ws/{sessionId}
Claude Code Desktop 服务端 (已有，零改动)
      ↕
CLI 子进程 (Claude Code Agent)
```

## 前置条件

- **Claude Code Desktop** 已运行（服务端默认在 `localhost:3456`）
- **Bun** 运行时 `>= 1.0`

## 安装

```bash
cd adapters
bun install
```

---

## Telegram

### 1. 创建 Bot

1. 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，按提示创建
3. 获取 Bot Token（格式：`123456:ABC-DEF...`）

### 2. 配置

**方式一：环境变量（推荐）**

```bash
export TELEGRAM_BOT_TOKEN="你的Bot Token"
```

**方式二：配置文件**

编辑 `~/.claude/adapters.json`：

```json
{
  "telegram": {
    "botToken": "你的Bot Token",
    "allowedUsers": [],
    "defaultWorkDir": "/path/to/your/project"
  }
}
```

- `allowedUsers`：Telegram User ID 白名单。留空 `[]` 允许所有人（适合个人使用）
- `defaultWorkDir`：Claude Code 的工作目录

### 3. 启动

```bash
cd adapters
bun run telegram
```

### 4. 使用

在 Telegram 中找到你的 Bot，直接发消息即可。

**命令：**

| 命令 | 说明 |
|------|------|
| `/start` | 显示帮助信息 |
| `/new` | 新建会话（重置上下文） |
| `/stop` | 停止当前生成 |

**权限审批：** 当 Claude 需要执行敏感操作（如运行终端命令、写文件），Bot 会发送带按钮的消息，点击 **允许** 或 **拒绝** 即可。

---

## 飞书 (Feishu)

### 1. 创建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)
2. 创建「企业自建应用」
3. 记下 **App ID** 和 **App Secret**

### 2. 配置应用权限

在应用后台「权限管理」中开启：

- `im:message` — 获取与发送消息
- `im:message:send_as_bot` — 以机器人身份发送消息
- `im:resource` — 获取消息中的资源文件

### 3. 配置事件订阅

在应用后台「事件订阅」中：

1. 选择「使用长连接接收事件」(WebSocket 模式，无需公网地址)
2. 添加事件：
   - `im.message.receive_v1` — 接收消息
   - `card.action.trigger` — 卡片按钮点击回调

### 4. 配置 Adapter

**方式一：环境变量（推荐）**

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="你的App Secret"
```

**方式二：配置文件**

编辑 `~/.claude/adapters.json`：

```json
{
  "feishu": {
    "appId": "cli_xxx",
    "appSecret": "你的App Secret",
    "allowedUsers": [],
    "defaultWorkDir": "/path/to/your/project",
    "streamingCard": false
  }
}
```

- `allowedUsers`：飞书 Open ID 白名单。留空 `[]` 允许所有人
- `streamingCard`：启用流式卡片模式（实时更新消息内容，体验更好）

### 5. 发布应用

在应用后台「版本管理与发布」中创建版本并发布（至少发布到「开发中」状态，机器人才能收发消息）。

### 6. 启动

```bash
cd adapters
bun run feishu
```

### 7. 使用

- **私聊**：直接给机器人发消息
- **群聊**：需要 @机器人
- **新会话**：发送 `/new` 或 `新会话`
- **停止**：发送 `/stop` 或 `停止`

**权限审批：** 当 Claude 需要执行敏感操作，Bot 会发送交互式卡片，点击 **允许** 或 **拒绝** 按钮。

---

## 配置文件完整示例

`~/.claude/adapters.json`：

```json
{
  "serverUrl": "ws://127.0.0.1:3456",
  "telegram": {
    "botToken": "123456:ABC-DEF...",
    "allowedUsers": [123456789, 987654321],
    "defaultWorkDir": "/Users/me/workspace/my-project"
  },
  "feishu": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "encryptKey": "",
    "verificationToken": "",
    "allowedUsers": ["ou_xxx"],
    "defaultWorkDir": "/Users/me/workspace/my-project",
    "streamingCard": false
  }
}
```

环境变量优先级高于配置文件。

---

## 常见问题

### 连不上服务器

```
[WsBridge] Error on tg-xxx: connect ECONNREFUSED 127.0.0.1:3456
```

**原因**：Claude Code Desktop 没有运行。启动 Desktop App 后再启动 Adapter。

### Telegram Bot 无响应

1. 检查 Bot Token 是否正确
2. 检查 Bot 是否被 Telegram 封禁（找 @BotFather 查看状态）
3. 如果配置了 `allowedUsers`，确认你的 User ID 在列表中

**获取你的 Telegram User ID**：给 [@userinfobot](https://t.me/userinfobot) 发条消息。

### 飞书收不到消息

1. 检查 App ID / App Secret 是否正确
2. 检查应用是否已发布
3. 检查事件订阅是否配置了 `im.message.receive_v1`
4. 检查应用权限是否已开启 `im:message`
5. 群聊中确认已 @机器人

### 权限按钮不响应

- **Telegram**：可能是 callback_data 格式问题，查看 Adapter 日志
- **飞书**：检查事件订阅是否配置了 `card.action.trigger`

---

## 开发

### 运行测试

```bash
cd adapters
bun test              # 全部测试
bun test common/      # 公共模块测试
bun test telegram/    # Telegram 测试
bun test feishu/      # 飞书测试
```

### 目录结构

```
adapters/
├── common/                 # 公共模块
│   ├── ws-bridge.ts        # WebSocket 桥接
│   ├── message-buffer.ts   # 流式消息缓冲
│   ├── message-dedup.ts    # 消息去重
│   ├── chat-queue.ts       # 会话串行队列
│   ├── format.ts           # 消息格式化
│   ├── config.ts           # 配置加载
│   └── __tests__/          # 公共模块测试
├── telegram/
│   ├── index.ts            # Telegram Adapter 入口
│   └── __tests__/          # Telegram 测试
├── feishu/
│   ├── index.ts            # 飞书 Adapter 入口
│   └── __tests__/          # 飞书测试
├── package.json
├── tsconfig.json
└── README.md
```
