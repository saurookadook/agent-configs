# Plan: "Claude sessions" switcher, in two versions

## Context

You run several Claude Code sessions at once in Terminal.app windows spread across macOS Spaces. You want a list of every live session in the top right of the screen. Each `SessionRow` shows a status symbol, the session's name and its id. Clicking a row brings that session's terminal tab to the front, switching Space if needed.

You asked for plans for two approaches:

- **A. A Claude Code mod**: a pane docked on the right inside every Claude session.
- **B. A Hammerspoon overlay**: a small window that floats over every app in the top-right corner of the screen.

Click-to-focus covers **Terminal.app and iTerm2**. Both versions share the session discovery and the focus logic described next. You can build either version alone, or both.

## Shared core

### 1. Finding the sessions

Claude Code already keeps a registry of its sessions: one file per process, `~/.claude/sessions/<pid>.json`. Each file holds what the rows need. For example:

```json
{"pid":69196,"sessionId":"b0fe9813-…","cwd":"…/connect-four-app","name":"connect-four-app-8b",
 "status":"idle","kind":"interactive","procStart":"Wed Oct 28 13:47:38 2026","statusUpdatedAt":…}
```

- Each row shows **status, name, and id** (`sessionId`, shortened to its first 8 characters, with the full id in the tooltip or detail).
- **Removing stale files.** A crashed session can leave its file behind. Keep an entry only if `ps -o pid=,tty=,lstart= -p <pids>` lists the pid and `lstart` equals `procStart`. The second check guards against an unrelated process that reused the pid. The same `ps` call also returns each session's **tty** (for example `ttys008`), which focusing needs. This is one `ps` call for all pids on each refresh.
- **Sorting.** Busy sessions first, then by `startedAt`. Mark the session you're viewing it from (`$.session.id()` in the mod).

### 2. Status symbols

Map the registry's `status` to the symbols used in the agents overview. So far the registry shows only `busy` and `idle`.

| status | symbol | color |
|---|---|---|
| `busy` | `●` | accent / yellow |
| `idle` | `○` | dim |
| `waiting` / needs input (if one appears) | `◐` | warning |
| anything else | `·` | dim |

During implementation, open the agents overview and copy its exact glyphs into this table. The table lives in one place in each version, so changing it later is a one-line edit.

### 3. Focusing a session's terminal

1. **Find the terminal app.** Walk up the session's parent processes (`ps -o ppid=,comm=`) until you reach `Terminal` or `iTerm2`. If neither turns up, show a toast or alert: "unsupported terminal".
2. **Run one `osascript` call with the tty passed as an argument** (`on run argv`). The tty never goes into the script text, so nothing can be injected through it.
   - **Terminal.app**: loop through `windows` → `tabs`, find the tab where `tty of t is "/dev/ttysNNN"`, then `set selected of t to true`, `set index of w to 1`, `activate`.
   - **iTerm2**: loop through `windows` → `tabs` → `sessions`, find the session where `tty of s is ttyPath`, then `select` the window, the tab and the session, and `activate`.
3. **Switching Spaces.** `activate` jumps to the window's Space when the macOS setting *Mission Control → "When switching to an application, switch to a Space with open windows"* is on (the default). If Terminal also has a window on the current Space, macOS may not switch. In that case, fall back to System Events and `perform action "AXRaise"` on the matched window. This needs Accessibility permission for the host (Terminal or Hammerspoon). Version B has a stronger option: `hs.window:focus()`, which switches Spaces reliably.
4. **First run.** macOS asks once for Automation permission ("… wants to control Terminal"). After a denial, the script fails with error -1743. Report that error in plain words.

iTerm2 is not installed on this Mac right now, so the iTerm2 path can only be tested after you install it.

---

## Version A: Claude Code mod `claude-sessions`

**Where it goes:** `~/.claude/dev-mods/9ee98337-6cf4-4acb-a26e-241145cb47e5/claude-sessions/`. This is the folder the mod engine hot-reloads from. Once it works, it can be copied into this repo, for example next to `claude/`.

### Files
- `.claude-plugin/plugin.json`: `{ name: "claude-sessions", version: "0.1.0", description, types: "./types/index.d.ts" }`
- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`
- `types/index.d.ts`: declares `PluginState['claude-sessions'] = { sessions: Shaped<SessionRow[]> }` and exports the `SessionRow` type, with fields `{ pid, sessionId, name, status, tty, terminal?, isSelf }`.
- `hooks/register.tsx`: the module, modeled on the skill's `examples/pane.tsx`.
- `hooks/register.test.tsx`: tests modeled on `examples/pane.test.tsx`.

### `register.tsx` outline
- **State:** `const sessions = atom({ plugin: 'claude-sessions', key: 'sessions' }, [], { shape: 'sessions-1' })`
- **`session.start`:**
  - Register the `/sessions` command.
  - Open the pane: `$.ui.open({ id: 'sessions', title: 'Sessions', columns: 40 })`. Opened automatically like this, it shows only at 144+ columns. Once you've run `/sessions`, it shows from 110 columns.
  - Read `HOME` with `$.env.get('HOME')`.
  - Start `$.clock.every(2000, refresh)`.
- **`refresh()`:**
  - List `~/.claude/sessions` with `$.fs.list`, and read each `*.json` file with `$.fs.read` (skipping the `.key` files).
  - Run one `ps` call through `$.process.run` to check which sessions are alive and get their ttys.
  - Call `update($, sessions, …)` only when the list has changed, so the pane doesn't redraw without reason.
- **`command.run` `{ command: 'sessions' }`:** opens the pane. Because you asked for it, it shows at any width.
- **`ui.render` `{ component: 'Pane', requestId: 'sessions' }`:**
  - Get `Box`, `Text` and `Button` from `$.ui.resolve(e)`.
  - Draw one `Button` per row, with `key={sessionId}`. Its children are `<Text color>{glyph}</Text> {name} <Text dimColor>{id8}</Text>`, and `onPress={() => focus(row)}`.
  - Give rows 1–9 hotkeys `"1"`…`"9"` for keyboard use.
  - Show dim text "No other sessions" when the list is empty.
- **`focus(row)`:** the shared core step 3, run through `$.process.run(['osascript', '-e', …, row.tty])`. Show any failure with `$.ui.toast`.

### Limits
- The pane docks to the right as a full-height column only in fullscreen at 110+ columns. Otherwise it sits inline above the prompt. It can't float in a corner.
- Every Claude session draws its own copy of the pane.

### Verification (A)
1. Run `claude plugin validate <mod folder>` and `tsc -p <mod folder>`.
2. Run `claude plugin test <mod folder>`. The tests stub `fs.list`, `fs.read` and `process.run` and check four things:
   - A busy and an idle session render with the right glyphs, names and ids.
   - A stale file (pid missing from `ps`) is dropped.
   - A pid reused by another process (`lstart` mismatch) is dropped.
   - Pressing a row calls `osascript` with that row's tty.
3. Live test:
   - Turn the mods on when asked, then run `/sessions` in this session. The four current sessions should appear (`connect-four-app-8b`, `dupe-connect-four-app-03`, …).
   - Start a prompt in another session and check that its symbol turns busy within about 2 s.
   - Click a row whose window is on another Space. The Space should switch and the right tab should be selected.
   - Close a session and check that its row disappears.

---

## Version B: Hammerspoon floating overlay

**Requires:** installing Hammerspoon (`brew install --cask hammerspoon`). It isn't installed now. Grant it Accessibility permission.

### Files
- `~/.hammerspoon/claude_sessions.lua`: the module. Its source can live in this repo and be symlinked into `~/.hammerspoon`.
- `~/.hammerspoon/init.lua`: add `require("claude_sessions").start()`.

### Module outline
- **Watching for changes:** `hs.pathwatcher.new(HOME.."/.claude/sessions", refresh)`, plus an `hs.timer.doEvery(3, refresh)` safety net. The timer covers sessions that die without removing their file.
- **`refresh()`:**
  - Read the JSON files with `hs.json.read`.
  - Check which sessions are alive and get their ttys with one `hs.execute("ps -o pid=,tty=,lstart= -p …")` call.
  - Rebuild the rows.
- **The overlay:** `hs.webview` (HTML/CSS, easiest to style), or `hs.canvas` for a lighter build.
  - Position: top right of `hs.screen.mainScreen():frame()`, with an 8 px margin.
  - Behavior: `level = hs.drawing.windowLevels.floating` and `behavior = canJoinAllSpaces`, so it shows on every Space. No title bar.
  - Height grows to fit the rows.
  - Each row shows the glyph, the name and the dim 8-character id.
  - A hotkey (for example ⌃⌥S) shows and hides it.
- **Clicks:** the webview's `navigationCallback` (a `claude://focus/<pid>` link) or a canvas `mouseCallback` calls `focus(pid)`.
- **`focus(pid)`:**
  - Find the terminal app's window with `hs.application.find("Terminal")` or `"iTerm2"`.
  - Run the shared AppleScript through `hs.osascript.applescript` to select the right tab. Pass the tty as a literal that is validated against `^/dev/ttys%d+$`, because there's no argv here.
  - Then call `hs.window.frontmostWindow():focus()`. When the window is on another Space, go there first with `hs.spaces.gotoSpace(hs.spaces.windowSpaces(win)[1])`, then focus it.

### Verification (B)
1. Reload the Hammerspoon config. The overlay should appear at the top right and stay there across Spaces and full-screen apps.
2. Check that the rows match `ls ~/.claude/sessions` minus any dead pids.
3. Check that the status flips within about 1 s through the path watcher.
4. Click a row on another Space. The Space should switch, the right tab should be selected, and the keyboard focus should be in that tab.
5. Kill a session with `kill -9`. Its row should go within about 3 s.

---

## Trade-offs

| | A: mod | B: Hammerspoon |
|---|---|---|
| Install | none (hot-reloads here) | Hammerspoon + Accessibility permission |
| Where it shows | inside each Claude session, docked right | its own window, top-right on every Space |
| Space switching | `activate` (plus the AXRaise fallback) | `hs.spaces` (more reliable) |
| Testable with `claude plugin test` | yes | manual only |

Recommended order: build **A** first. It is self-contained and testable here. Then build **B**, reusing the same status table and AppleScript.
