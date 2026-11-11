<div align="center">

# Agent Dashboard

**A local dashboard to watch, chat with and approve the AI coding agent sessions running on your Mac — all in one place**

Claude Code · Codex · zero dependencies · everything stays on your machine

[한국어](README.md) · **English**

</div>

> I built this because I needed it while running many AI coding sessions at once, and I built it **together with an AI coding agent (Claude Code)**. I use it every day and keep improving it.
>
> ⚠️ **This is a personal, experimental tool.** It types into your AI sessions, so please read [Security](#security) first and use it at your own judgment. Features and structure may change without notice.
>
> 🌐 **The UI is currently in Korean.** The screenshots below show what each part does.

**Roadmap** — ✅ Stage 1: vanilla JS, built fast and used for real · ⏳ Stage 2: split files and clean up (still zero dependencies) · ⏳ Stage 3: move to React

![Demo — approving a prompt and watching live diffs](docs/images/demo.gif)

![Overview — session list, org chart, account usage limits, activity log](docs/images/overview.png)

<sub>Project and session names in the screenshots are sample data from demo mode.</sub>

---

## Why

When you run several AI coding sessions at once, the bottleneck is no longer the AI — it's **you**.

- Terminals are scattered everywhere, so you have to open each one to see **which session is still working**
- A session asks "Can I run this command?" and you find it **stuck for 20+ minutes** much later
- Sessions send instructions to each other, but you can't see **who asked whom to do what**

Agent Dashboard puts all of this on one screen.

## Features

| | Feature | Description |
|---|---|---|
| 👀 | **Live status** | Working · **background task** · idle · **needs approval** · ended, plus the current tool and elapsed time |
| 🗺️ | **Org chart** | This Mac → tool → project → session → subagent. Messages between sessions are **purple arrows** (count + last message) |
| 💬 | **Chat · approve** | Send messages to tmux sessions (Enter), voice input, **file/image attachments**. Approval prompts show the real terminal screen plus option buttons; multi-question prompts let you go back and forth |
| 📂 | **Open the folder** | Click a project box to open that folder in VS Code · Cursor or reveal it in Finder — no hunting for the folder when you want to check what changed |
| ■ | **Stop · close** | Stop only what a session is doing (the conversation stays), or close a session from the dashboard |
| 📝 | **Live code diff** | Files changed in the current request with +/− counts and red/green diffs; commands with ✓ pass / ✕ fail and output |
| 🧠 | **Model · usage** | Start sessions with Opus · Sonnet · Haiku, switch a running session's model, context usage, Claude account 5-hour/weekly limits |
| 🔔 | **Notifications** | macOS notification when approval is needed or a task over 1 minute finishes; pending approvals in the tab title |
| 🛡️ | **Local-only security** | 127.0.0.1 only, Host/Origin checks, a secret token generated per machine |

![Session panel — current answer, file diffs, commands](docs/images/session-panel.png)

![Approval — the real terminal screen plus option buttons](docs/images/approval.png)

## Getting started

### Requirements

| | Required | Install |
|---|---|---|
| macOS | yes | Linux mostly works, Windows is not supported |
| Node.js 18+ | yes | `brew install node` |
| Claude Code | yes | latest recommended — `brew upgrade claude-code` |
| tmux | for chat/approve | `brew install tmux` (without it, view-only) |

### Run

```bash
git clone https://github.com/Yun7420/agent-dashboard.git
cd agent-dashboard
npm start          # → open http://localhost:4545
```

On first launch you'll see an **environment check** and a short guide, with fixes for anything missing (open it again with **?** in the top right).

### Keep it running (recommended)

Run it inside tmux with the auto-restart script; if the server stops it comes back after 2 seconds. Logs go to `~/.agent-dashboard/server.log`.

```bash
tmux new -d -s dashboard -c <repo path> ./bin/run.sh
tmux respawn-pane -k -t dashboard     # restart after editing code (sending Ctrl+C would kill the tmux session too)
```

### After a restart: restore all sessions at once

A restart kills tmux and every session inside it, but the conversations are saved, so they can be reopened with `--resume`. The dashboard keeps saving the list of live tmux Claude sessions (name · folder · session ID) to `~/.agent-dashboard/restore.json`, so you can bring them all back in one go.

```bash
npm run restore    # reopens the pre-restart sessions in tmux and starts the dashboard
```

If you open the dashboard first, the top of the list shows **"N sessions from before the restart · Reopen all"**. Sessions follow your default model; only ones you picked explicitly (Sonnet/Haiku) keep it. Conversations older than 30 days are cleaned up by Claude Code and can't be resumed.

## To chat and approve: start sessions in tmux

A session already running in a terminal has no official way to receive input from outside. The dashboard types into sessions **through tmux, the way a person would**, so **only sessions started inside tmux** can be chatted with, approved or closed. Other sessions are view-only.

```
[Terminal app] ─┐
                ├─▶ [tmux] ── input ──▶ AI session
[Dashboard] ────┘   (manages the input channel)
```

- **New session** — use **+ New session** in the dashboard (folder · name · model · first prompt); it opens inside tmux automatically.
- **Move an existing session** — `/exit` in that session, then in a **regular shell**:
  ```bash
  cd <folder where the session started> && tmux new -s name claude --resume <session-id>
  ```
  The conversation continues. Click the session in the dashboard to see the exact command under the input box.
- **tmux basics** — detach with `Ctrl+b` → `d` (the session keeps running) · reattach with `tmux attach -t name`
- ⚠️ Run screen-taking commands like `tmux new …` **one per terminal tab**. If you paste several lines at once, the second line goes into the first session's input. To start several from one tab, use `tmux new -d …`.

## Using the screen

<details open>
<summary><b>Left — session list</b></summary>

- Sort: **manual** (drag cards to fix the order) · by status · by name
- Bar under each card = context usage (green → yellow → red)
- **Collapse the list** with the top icon — a thin rail keeps status dots + initials (click to open)
- Click **Ended sessions N** under the live sessions to expand, and pick the time window (6h · 24h · 3d · 7d)
- Hover for ✕ — close the session (with confirmation) / hide an ended session
</details>

<details open>
<summary><b>Center — org chart</b></summary>

- Drag to pan · wheel to zoom · double-click to fit · **click empty space = close the right panel**
- Dashed line = working in the same folder, yellow = working, **purple arrow = messages between sessions**
- **Status text color** under each session box: idle = purple · working = yellow · background = light yellow · **needs approval = pink (bold)**
- **Click a project box** to open that folder in **VS Code · Cursor, or reveal it in Finder** (only installed apps are shown; only folders of listed sessions can be opened)
- Subagents: all running ones, up to 5 finished in the last 10 minutes, the rest folded into **"N done"** (click to expand)
</details>

<details open>
<summary><b>Right — session panel</b></summary>

- Header: status dot · name · ⓘ details (path, PID, session ID…) · **Now / History** tabs · model · ⤢ wide · ⋯ (close session) · › collapse
- Drag the left edge to **resize** (double-click = default width); the width is remembered
- **Now** tab: last request + **current answer** + **file diffs** + **commands** (✓/✕, output, "show all" for long ones)
- While working, **■ Stop** on the answer card stops the current task only (sends Esc); the session and conversation stay
- **History** tab: past prompts and answers, search, "load more"
- Answers render **bold** · `code` · headings · **tables** (`| head |` + `|---|`). Wide tables scroll horizontally inside the table
- Input: **Enter** to send · Shift+Enter for a new line · 🎤 voice · 📎 attach (drag & drop or ⌘V, up to 25MB)
- Needs approval: the real terminal screen plus option buttons. **Check what you're allowing before you click.** The approval view fills the panel with the input pinned at the bottom, and keeps your scroll position while you read.
- Multi-question prompts show **← Previous / Next →** and progress (✓ answered). You can go back to change an answer; you can't skip ahead before answering the current one.
- Options all look the same until you pick one; **only the picked answer turns purple with ✓**.
- Messages aren't sent while approval is pending (so your text can't land in the prompt by accident).
</details>

<details open>
<summary><b>Bottom — activity · keyboard</b></summary>

- Activity: changes since the dashboard started (status · new prompts · messages between sessions · subagents). Fold it to one line with the button on the right
- **Esc**: close popups → press again to collapse the panel
- 🔔: turn on notifications (approval needed · task over 1 minute finished)
</details>

## Model · usage

- **Model** — choose in + New session; change a running tmux session's model from the panel header (sends `/model`). Claude's `/model` also saves your default model, so when you change it from the dashboard **only that session** changes and your default is restored automatically.
- **Account usage limits (5-hour · weekly)** — turn on with **Show usage limits** in the header. Claude Code only passes this to the status line, so turning it on registers a status line (`bin/statusline.mjs`) in `~/.claude/settings.json`.
  - Every Claude session gets one line at the bottom: `model · context % · 5-hour limit %` (if you already had a status line, it keeps showing yours).
  - Your previous settings are backed up to `~/.agent-dashboard/` and **restored exactly** when you turn it off. While on, context usage becomes exact instead of estimated.

## Security

- **`127.0.0.1` only** — requests whose Host isn't localhost are rejected (blocks DNS rebinding). Prompts and code paths are visible, so don't share the address.
- **`.dashboard-token`** — a secret token just for this dashboard. It's generated per machine on first run (readable only by you), and **commands** like send, approve and close are accepted **only with this token**. Any website can send requests to localhost from your browser, so this stops a malicious page from sneaking commands in.
  - Don't share or commit it (it's in `.gitignore`). If it leaks, delete the file and restart to get a new one.
- Attachments outside `~/.agent-dashboard/uploads/` are rejected.
- Permission modes follow your own Claude settings. The dashboard never uses permission-skipping flags.

## How it works

It doesn't touch hooks or global settings — it **only reads** (except for one status line, if you turn on usage limits).

| Reads | To learn |
|---|---|
| `~/.claude/sessions/*.json` (falls back to `claude agents --json`) | live sessions and their exact state |
| `~/.claude/projects/**.jsonl` · `~/.codex/sessions/**.jsonl` | prompts · answers · tools · changed files · model · context · subagents · messages between sessions |
| `ps` · `lsof` · `tmux` | running processes, working folders, prompts on screen (detected by the `Enter to …` / `Esc to cancel` line at the bottom) |

- Updates use **SSE** — the server builds the state every 2 seconds and sends it **only when something changed**.
- Transcript files over 100MB are read **incrementally** (only the new part). Building the state usually takes about 20ms (see `/api/perf`).
- The screen redraws only what changed, the history tab renders 80 items at a time, and the flowing dashed lines update 8 times a second and pause when the tab is hidden.

```
agent-dashboard/
├─ server.mjs          # HTTP/SSE server, state, commands (chat · approve · close · new session)
├─ adapters/           # per-tool differences only — claude.mjs · codex.mjs · index.mjs
├─ lib/                # tmux control · file utils · demo data
├─ bin/                # run.sh (auto-restart) · statusline.mjs (usage-limit bridge)
└─ public/index.html   # the whole UI (vanilla HTML/CSS/JS, SVG org chart)
```

### Adding another agent

Add a file with the same shape to `adapters/` and one line to `adapters/index.mjs`. See the comments in `adapters/index.mjs` for the shape.

### Demo mode (screenshots, talks)

```bash
DEMO=1 PORT=4646 npm start
```

Shows the UI with fake data (Project1, Lead Manager, …). No commands are executed. The images in this README were taken in demo mode.

## Known limitations

- File diffs come from the Edit/Write tools. Files changed by shell commands only show up under "commands".
- If several sessions start in the same folder without `--resume`, they're matched by process start time. After `/clear` in a long-running session they can occasionally get mixed up.
- If Claude Code changes its transcript format, some details may be wrong (only the adapter needs fixing).
- Prompts are detected from Claude Code's English hint lines. If that wording changes, "needs approval" may show late or not at all.

## License

[MIT](LICENSE)
