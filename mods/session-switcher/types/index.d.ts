export type SessionRow = {
  pid: number
  sessionId: string
  name: string
  status: string
  tty: string
  startedAt: number
  isSelf: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-switcher': { sessions: Shaped<SessionRow[]> }
  }
}
