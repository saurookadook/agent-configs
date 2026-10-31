# session-switcher

A Claude Code mod: a pane listing every live Claude session on this Mac, with its status, name and id. Click a row, or press its number 1–9, to bring that session's terminal tab to the front, switching Desktop Space if needed.

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

## macOS permissions

The first click asks to let your terminal control Terminal (or iTerm2): System Settings → Privacy & Security → Automation.

## Develop

```sh
claude plugin validate mods/session-switcher
claude plugin test mods/session-switcher
```

To debug clicks, set `TRACE = true` in `hooks/register.tsx`: each press and focus result is logged to the transcript.
