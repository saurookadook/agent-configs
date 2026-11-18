# session-switcher

A Claude Code mod: a pane listing every live Claude session on this Mac, with its status, name and id. Click a row, or use the keyboard, to bring that session's terminal tab to the front, switching Desktop Space if needed.

- Lists sessions by name, so a row keeps its number while sessions turn busy and idle. A renamed session moves to its new place within 2 s.
- Opens by itself in terminals 144+ columns wide; `/sessions` opens it at any width.
- Reads the session registry in `~/.claude/sessions/` every 2 s, and checks each file against `ps` so sessions that crashed or exited don't show.
- Focusing works in Terminal.app (JXA, verified on screen with one retry) and iTerm2 (AppleScript, untested).

## Load it

The mod loads for one session at a time. Start Claude Code with the folder named, from the repo root:

```sh
claude --plugin-dir mods/session-switcher
```

or from anywhere, with the full path:

```sh
claude --plugin-dir ~/devel/personal/agent-configs/mods/session-switcher
```

The session watches the folder, so saving a file reloads the mod. Each session you want the pane in needs the flag; the pane then lists every live session, flag or not.

## Keyboard

A mod's keys work only while its pane holds the keyboard. Press `ctrl+x tab` at an empty prompt to give the pane the keyboard, press a key below, and press `Esc` to return to the prompt.

| Key | Action |
| --- | --- |
| `p` | Focus the session above this one; from the first row, wraps to the last |
| `n` | Focus the session below this one; from the last row, wraps to the first |
| `1`–`9` | Focus the session in that row |
| `0` | Focus the session in row 10 |

Rows past 10 have no key. The keys are set in one place, `DEFAULT_KEYMAP` in `hooks/register.tsx`; they are not configurable yet.

## macOS permissions

The first click asks to let your terminal control Terminal (or iTerm2): System Settings → Privacy & Security → Automation.

## Develop

```sh
claude plugin validate mods/session-switcher
claude plugin test mods/session-switcher
```

To debug clicks, set `TRACE = true` in `hooks/register.tsx`: each press and focus result is logged to the transcript.
