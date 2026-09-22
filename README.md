# gwt

Interactive git worktree manager. Browse, open, and delete git worktrees across
all your repos from a single filterable picker.

## Install

```zsh
curl -fsSL https://raw.githubusercontent.com/wweidner/gwt/main/install.sh | bash
source ~/.zshrc
```

## Usage

```
gwt [--root <path>]
```

Type to filter, arrow keys to navigate, enter to select.

| Key | Action |
|-----|--------|
| `↑↓` | Navigate |
| type | Filter list |
| `enter` | Select worktree |
| `ctrl+-` | Selection mode (bulk delete) |

### Submenu actions

- **Open in Cursor (editor)** — opens `--classic` mode (no agent view)
- **Open in Cursor (agent chat)** — opens Cursor's Glass/agent view
- **Open in Claude Code** — launches `claude` in the worktree directory
- **Switch to directory** — `cd`s your shell into the worktree
- **Delete Worktree** — confirm → remove → optional branch delete

The Cursor actions need the `cursor` command (in Cursor, run **Shell Command: Install 'cursor' command** from the Command Palette), and the Claude Code action needs `claude`. gwt looks for each on your `PATH` and in its usual install location, and tells you how to install it if it's missing. Set `GWT_CURSOR_BIN` or `GWT_CLAUDE_BIN` to point at a specific binary.

### Options

| Flag | Description |
|------|-------------|
| `--root <path>` | Override worktrees root (default: `~/worktrees`) |
| `--help` | Show help |
| `--version` | Show version |

Environment variable: `GWT_WORKTREES_ROOT` overrides the default root.

## Worktree layout expected

```
~/worktrees/
  fabric/
    FAB-123_MyFeature/
    FAB-456_AnotherOne/
  other-repo/
    TICKET-1_Something/
```

## Updating

```zsh
git -C ~/tools/gwt pull --ff-only
source ~/.zshrc
```

## Building from source

```zsh
npm install
npm run build
```
