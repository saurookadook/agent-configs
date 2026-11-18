import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_KEYMAP, keymapProblems, neighbor } from './register'
import type { SessionRow } from '../types'

const PANE = {
  plugin: 'session-switcher',
  component: 'Pane',
  requestId: 'sessions',
  props: {
    title: 'Sessions',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const DIR = '/Users/me/.claude/sessions'
const REGISTRY: Record<string, object> = {
  '100.json': {
    pid: 100,
    sessionId: 'aaaaaaaa-1111',
    name: 'quiet-one',
    status: 'idle',
    startedAt: 1,
    procStart: 'Wed Oct 28 13:56:28 2026',
  },
  '200.json': {
    pid: 200,
    sessionId: 'bbbbbbbb-2222',
    name: 'working-one',
    status: 'busy',
    startedAt: 2,
    procStart: 'Wed Oct 28 13:58:01 2026',
  },
  // Crashed: its pid is not in ps.
  '300.json': { pid: 300, sessionId: 'cccccccc-3333', name: 'crashed', status: 'idle' },
  // Its pid now belongs to a process that started at another time.
  '400.json': {
    pid: 400,
    sessionId: 'dddddddd-4444',
    name: 'reused-pid',
    status: 'idle',
    procStart: 'Mon Oct 26 08:00:00 2026',
  },
}
const PS_LIVE = [
  '  100 ttys006  Wed Oct 28 13:56:28 2026    ',
  '  200 ttys014  Wed Oct  28 13:58:01 2026',
  '  400 ttys020  Wed Oct 28 14:10:00 2026',
].join('\n')
// A third live session, so up and down have somewhere to wrap to.
const THREE: Record<string, object> = {
  ...REGISTRY,
  '500.json': { pid: 500, sessionId: 'eeeeeeee-5555', name: 'zebra', status: 'idle', startedAt: 3 },
}
const PS_THREE = `${PS_LIVE}\n  500 ttys030  Wed Oct 28 14:20:00 2026`
const PS_TREE = [
  '    1     0 /sbin/launchd',
  ' 1332     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
  ' 1929  1332 login',
  ' 1994  1929 -zsh',
  '  200  1994 claude',
  '  100  1994 claude',
  '  500  1994 claude',
].join('\n')

function world(on: On, registry: Record<string, object> = REGISTRY, psLive = PS_LIVE) {
  const osascript = { exitCode: 0, stdout: 'ok\n', stderr: '' }
  const calls: (readonly string[])[] = []
  mock.env(on, { HOME: '/Users/me' })
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'bbbbbbbb-2222' }))
  on('command.register', () => ({ value: { command: 'sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [
      ...Object.keys(registry).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
      { name: '100.abc.key', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
    ],
  }))
  on('fs.read', (_, e) => ({ value: JSON.stringify(registry[e.path.slice(DIR.length + 1)]) }))
  on('process.run', (_, e) => {
    calls.push(e.argv)
    const done = { isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === 'osascript') return { value: { ...osascript, ...done } }
    if (e.argv[1] === '-axo') return { value: { exitCode: 0, stdout: PS_TREE, stderr: '', ...done } }

    return { value: { exitCode: 1, stdout: psLive, stderr: '', ...done } }
  })

  return { calls, clock }
}

const row = (name: string, isSelf = false): SessionRow => ({
  pid: 1,
  sessionId: `id-${name}`,
  name,
  status: 'idle',
  tty: 'ttys001',
  startedAt: 0,
  isSelf,
})

test('lists live sessions by name and drops stale files', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.text)).toEqual([
    '○ quiet-one aaaaaaaa',
    '● working-one (here) bbbbbbbb',
    'up',
    'down',
  ])
  await ui.unmount()
})

test('pressing a row focuses its Terminal tab by tty', async ($, on) => {
  const { calls } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'bbbbbbbb-2222' })
  const osascript = calls.find(argv => argv[0] === 'osascript')
  expect(osascript?.at(-1)).toBe('/dev/ttys014')
  expect(osascript?.slice(0, 3)).toEqual(['osascript', '-l', 'JavaScript'])
  expect(osascript?.[4]).toContain("Application('Terminal')")
  await ui.unmount()
})

test('a session with no registry files shows the empty line', async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No live sessions.')
  await ui.unmount()
})

test('a renamed session moves to its new place on the next refresh', async ($, on) => {
  const registry = structuredClone(REGISTRY) as Record<string, { name: string }>
  const { clock } = world(on, registry)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  registry['100.json']!.name = 'zulu'
  await clock.advance(2000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.slice(0, 2).map(b => b.text)).toEqual([
    '● working-one (here) bbbbbbbb',
    '○ zulu aaaaaaaa',
  ])
  await ui.unmount()
})

test('names sort without regard to case, numbers by value', () => {
  const names = ['app-10', 'Bravo', 'app-2', 'alpha']
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  expect(sorted).toEqual(['alpha', 'app-2', 'app-10', 'Bravo'])
})

test('neighbor steps from this session and wraps at both ends', () => {
  const middle = [row('a'), row('b', true), row('c')]
  expect(neighbor(middle, -1)?.name).toBe('a')
  expect(neighbor(middle, 1)?.name).toBe('c')

  const first = [row('a', true), row('b'), row('c')]
  expect(neighbor(first, -1)?.name).toBe('c')

  const last = [row('a'), row('b'), row('c', true)]
  expect(neighbor(last, 1)?.name).toBe('a')
})

test('neighbor without a row of its own, or with nowhere to go', () => {
  const others = [row('a'), row('b'), row('c')]
  expect(neighbor(others, 1)?.name).toBe('a')
  expect(neighbor(others, -1)?.name).toBe('c')

  expect(neighbor([], 1)).toBe(undefined)
  expect(neighbor([row('a', true)], 1)).toBe(undefined)
  expect(neighbor([row('a', true)], -1)).toBe(undefined)
})

test('down focuses the row below this session, up the row above', async ($, on) => {
  // By name: quiet-one, working-one (this session), zebra.
  const { calls } = world(on, THREE, PS_THREE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const ttys = () => calls.filter(argv => argv[0] === 'osascript').map(argv => argv.at(-1))
  await ui.press({ key: 'next' })
  expect(ttys()).toEqual(['/dev/ttys030'])
  await ui.press({ key: 'previous' })
  expect(ttys()).toEqual(['/dev/ttys030', '/dev/ttys006'])
  await ui.unmount()
})

test('down from the last row wraps to the first', async ($, on) => {
  // This session is working-one, the last of the two by name.
  const { calls } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'next' })
  expect(calls.find(argv => argv[0] === 'osascript')?.at(-1)).toBe('/dev/ttys006')
  await ui.unmount()
})

test('rows 1 to 10 carry the keys 1 to 9 then 0, and row 11 none', async ($, on) => {
  const registry: Record<string, object> = {}
  const ps: string[] = []
  for (let i = 1; i <= 11; i++) {
    const pid = 1000 + i
    const name = `s${String(i).padStart(2, '0')}`
    registry[`${pid}.json`] = { pid, sessionId: `${name}-0000`, name, status: 'idle' }
    ps.push(`${pid} ttys${100 + i}  Wed Oct 28 13:56:28 2026`)
  }
  world(on, registry, ps.join('\n'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.hotkey)).toEqual([
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', undefined, 'p', 'n',
  ])
  await ui.unmount()
})

test('the default keys are valid and none is bound twice', () => {
  expect(keymapProblems(DEFAULT_KEYMAP)).toEqual([])
  expect(keymapProblems({ previous: 'p', next: 'p', items: ['[', '1'] })).toEqual([
    '"p" is bound twice',
    '"[" is not one digit or lowercase letter',
  ])
})
