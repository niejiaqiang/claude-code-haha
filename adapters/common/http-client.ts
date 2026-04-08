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
