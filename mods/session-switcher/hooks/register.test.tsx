import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
const PS_TREE = [
  '    1     0 /sbin/launchd',
  ' 1332     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
  ' 1929  1332 login',
  ' 1994  1929 -zsh',
  '  200  1994 claude',
].join('\n')

function world(on: On, registry: Record<string, object> = REGISTRY) {
  const osascript = { exitCode: 0, stdout: 'ok\n', stderr: '' }
  const calls: (readonly string[])[] = []
  mock.env(on, { HOME: '/Users/me' })
  mock.clock(on)
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

    return { value: { exitCode: 1, stdout: PS_LIVE, stderr: '', ...done } }
  })

  return calls
}

test('lists live sessions, busy first, and drops stale files', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.text)).toEqual([
    '● working-one (here) bbbbbbbb',
    '○ quiet-one aaaaaaaa',
  ])
  await ui.unmount()
})

test('pressing a row focuses its Terminal tab by tty', async ($, on) => {
  const calls = world(on)
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
