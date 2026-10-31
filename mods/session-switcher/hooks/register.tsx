import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { SessionRow } from '../types'

const PANE = 'sessions'
const REFRESH_MS = 2000
const COLUMNS = 48
// Traces presses and focus results into the transcript; flip on to debug clicks.
const TRACE = false
// Change the tag when a row's fields change: it declines what an earlier
// version stored, which outlives a reload.
const sessions = atom({ plugin: 'session-switcher', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
})

// One place for the status glyphs, so matching the agents overview is one edit.
type Look = { glyph: string; color?: Color; dim?: boolean }
const GLYPHS: Record<string, Look> = {
  busy: { glyph: '●', color: 'warning' },
  idle: { glyph: '○', dim: true },
  waiting: { glyph: '◐', color: 'permission' },
}
const UNKNOWN: Look = { glyph: '·', dim: true }

// JXA, for the CoreGraphics window list. Raising a window on another Space
// sometimes leaves the Space where it is while reporting success, and a
// second attempt lands, so it checks and retries once. Terminal's window id
// is the window server's, which lists only the windows on the Space showing.
// The tty arrives as argv, never spliced into the script text.
const TERMINAL_SCRIPT = `ObjC.import('CoreGraphics')

function onScreen(id) {
  const list = ObjC.deepUnwrap(
    ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)),
  )
  return list.some(w => w.kCGWindowNumber === id)
}

// About 0.3 s: a switch that lands shows up within ~0.2 s, and a spare retry
// on a window already showing changes nothing.
function settles(id) {
  for (let i = 0; i < 6; i++) {
    if (onScreen(id)) return true
    delay(0.05)
  }
  return false
}

function run(argv) {
  const ttyPath = argv[0]
  const term = Application('Terminal')
  for (const w of term.windows()) {
    let ttys
    try {
      ttys = w.tabs.tty()
    } catch (e) {
      continue // Settings and other panels are windows with no tabs.
    }
    const at = ttys.indexOf(ttyPath)
    if (at < 0) continue
    const id = w.id()
    // By id: an index-based reference moves once the window is reordered.
    const win = term.windows.byId(id)
    for (let tries = 1; tries <= 2; tries++) {
      win.tabs[at].selected = true
      win.index = 1
      term.activate()
      if (settles(id)) return 'ok tries=' + tries
    }
    return 'ok unverified'
  }
  return 'missing'
}`

const ITERM_SCRIPT = `on run argv
  set ttyPath to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is ttyPath then
            select w
            tell t to select
            tell s to select
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`

type RegistryFile = {
  pid?: number
  sessionId?: string
  name?: string
  status?: string
  startedAt?: number
  procStart?: string
}

type Live = { tty: string; lstart: string }

let configDir: string | undefined
let selfId: string | undefined
let lastKey = ''

const squash = (text: string) => text.trim().replace(/\s+/g, ' ')

// `ps -o pid=,tty=,lstart=` under TZ=UTC: lstart then reads as the registry's procStart.
export function parseLive(stdout: string): Map<number, Live> {
  const live = new Map<number, Live>()
  for (const line of stdout.split('\n')) {
    const [, pid, tty, lstart] = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/) ?? []
    if (pid && tty && lstart) live.set(Number(pid), { tty, lstart: squash(lstart) })
  }

  return live
}

export function toRows(files: RegistryFile[], live: Map<number, Live>, self?: string): SessionRow[] {
  const rows: SessionRow[] = []
  for (const file of files) {
    if (typeof file.pid !== 'number' || !file.sessionId) continue
    const proc = live.get(file.pid)
    // A crashed session leaves its file; a reused pid starts at another time.
    if (!proc || proc.tty === '??') continue
    if (file.procStart && squash(file.procStart) !== proc.lstart) continue
    rows.push({
      pid: file.pid,
      sessionId: file.sessionId,
      name: file.name ?? file.sessionId.slice(0, 8),
      status: file.status ?? 'unknown',
      tty: proc.tty,
      startedAt: file.startedAt ?? 0,
      isSelf: file.sessionId === self,
    })
  }

  return rows.sort(
    (a, b) => Number(b.status === 'busy') - Number(a.status === 'busy') || a.startedAt - b.startedAt,
  )
}

async function refresh($: EngineInterface) {
  if (!configDir) return
  const dir = `${configDir}/sessions`
  const entries = await $.fs.list(dir).catch(() => [])
  const files: RegistryFile[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      files.push(JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as RegistryFile)
    } catch {
      // A file mid-write or removed between the list and the read.
    }
  }
  const pids = files.map(file => file.pid).filter(pid => typeof pid === 'number')
  let live = new Map<number, Live>()
  if (pids.length > 0) {
    // ps exits 1 when any pid is gone; the live ones are still on stdout.
    const ps = await $.process.run(['ps', '-o', 'pid=,tty=,lstart=', '-p', pids.join(',')], {
      env: { TZ: 'UTC' },
    })
    live = parseLive(ps.stdout)
  }
  const rows = toRows(files, live, selfId)
  const key = JSON.stringify(rows)
  if (key === lastKey) return
  lastKey = key
  await update($, sessions, () => rows)
}

// Walks up from the session's process to the terminal app that owns it.
export function terminalOf(psTable: string, pid: number): 'terminal' | 'iterm' | undefined {
  const parents = new Map<number, { ppid: number; comm: string }>()
  for (const line of psTable.split('\n')) {
    const [, pid, ppid, comm] = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/) ?? []
    if (pid && ppid && comm) parents.set(Number(pid), { ppid: Number(ppid), comm })
  }
  for (let at = parents.get(pid); at; at = parents.get(at.ppid)) {
    if (/\/Terminal$|^Terminal$/.test(at.comm)) return 'terminal'
    if (/iTerm2?$|iTerm\.app/.test(at.comm)) return 'iterm'
    if (at.ppid <= 1) break
  }

  return undefined
}

async function focus($: EngineInterface, row: SessionRow) {
  const t0 = await $.clock.now()
  if (TRACE) $.ui.log(`session-switcher: onPress ${row.name} (/dev/${row.tty})`)
  const table = await $.process.run(['ps', '-axo', 'pid=,ppid=,comm='])
  const app = terminalOf(table.stdout, row.pid)
  if (!app) {
    $.ui.toast(`${row.name}: not in Terminal or iTerm2, so it can't be focused`)
    return
  }
  const argv =
    app === 'terminal' ? ['osascript', '-l', 'JavaScript', '-e', TERMINAL_SCRIPT] : ['osascript', '-e', ITERM_SCRIPT]
  const t1 = await $.clock.now()
  const ran = await $.process.run([...argv, `/dev/${row.tty}`])
  const out = ran.stdout.trim()
  if (TRACE) {
    const t2 = await $.clock.now()
    $.ui.log(
      `session-switcher: osascript exit=${ran.exitCode} out=${out} err=${squash(ran.stderr)} ` +
        `script=${t2 - t1}ms sincePress=${t2 - t0}ms`,
    )
  }
  if (ran.exitCode === 0 && out.startsWith('ok')) return
  if (out === 'missing') {
    $.ui.toast(`${row.name}: no tab has /dev/${row.tty}`)
  } else if (ran.stderr.includes('-1743')) {
    $.ui.toast('Allow automation in System Settings → Privacy & Security → Automation')
  } else {
    $.ui.toast(`${row.name}: focus failed: ${squash(ran.stderr) || `exit ${ran.exitCode}`}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'sessions',
      description: 'Show every live Claude session; click one to focus its terminal',
    })
    configDir =
      (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
    selfId = await $.session.id()
    lastKey = ''
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    void $.ui.open({ id: PANE, title: 'Sessions', columns: COLUMNS })

    return started
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Sessions', columns: COLUMNS })

    return { text: 'Sessions pane opened.' }
  })

  if (TRACE) {
    on('ui.press', async ($, e, next) => {
      if (e.requestId === PANE) $.ui.log(`session-switcher: ui.press element=${e.element}`)

      return next(e)
    })
    on('ui.focus', async ($, e, next) => {
      $.ui.log(`session-switcher: ui.focus ${JSON.stringify(e)}`)

      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, sessions)

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>No live sessions.</Text>}
        {rows.map((row, index) => {
          const look = GLYPHS[row.status] ?? UNKNOWN

          return (
            <Button
              key={row.sessionId}
              plain
              hotkey={index < 9 ? String(index + 1) : undefined}
              onPress={() => focus($, row)}
            >
              <Text color={look.color} dimColor={look.dim}>
                {look.glyph}
              </Text>{' '}
              {row.name}
              {row.isSelf ? ' (here)' : ''} <Text dimColor>{row.sessionId.slice(0, 8)}</Text>
            </Button>
          )
        })}
      </Box>
    )
  })
}
