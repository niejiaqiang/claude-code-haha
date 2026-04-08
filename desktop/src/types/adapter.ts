export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  telegram?: {
    botToken?: string
    allowedUsers?: number[]
    defaultWorkDir?: string
  }
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    defaultWorkDir?: string
    streamingCard?: boolean
  }
}
