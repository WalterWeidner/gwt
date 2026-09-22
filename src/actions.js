import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { accessSync, constants, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { confirm } from '@inquirer/prompts';

const COMMANDS = {
  cursor: {
    envVar: 'GWT_CURSOR_BIN',
    fallbacks: [
      join(homedir(), '.local', 'bin', 'cursor'),
      '/usr/local/bin/cursor',
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    ],
    install: `Open Cursor and run "Shell Command: Install 'cursor' command" from the Command Palette.`,
  },
  claude: {
    envVar: 'GWT_CLAUDE_BIN',
    fallbacks: [join(homedir(), '.local', 'bin', 'claude')],
    install: 'Install Claude Code and make sure `claude` is on your PATH.',
  },
};

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate a CLI via its override env var, then PATH, then known install
 * locations. Throws with install instructions when it can't be found, since
 * a detached spawn of a missing binary fails silently after gwt exits.
 */
function findCommand(name) {
  const { envVar, fallbacks, install } = COMMANDS[name];
  const override = process.env[envVar];
  if (override) {
    if (isExecutable(override)) return override;
    throw new Error(`${envVar} is set to "${override}", but that file is not executable.`);
  }

  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const found = [...pathDirs.map((dir) => join(dir, name)), ...fallbacks].find(isExecutable);
  if (found) return found;

  throw new Error(`Could not find the \`${name}\` command. ${install}`);
}

/**
 * Open a worktree in Cursor's classic editor view (no Glass/agent mode).
 */
export function openInCursor(worktree) {
  const child = spawn(findCommand('cursor'), ['--classic', worktree.path], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Open a worktree in Cursor's agent/Glass view (default cursor behaviour).
 */
export function openInCursorAgent(worktree) {
  const child = spawn(findCommand('cursor'), [worktree.path], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Open a worktree in Claude Code (interactive TUI).
 * Blocks until the user exits Claude Code, then returns control to gwt.
 */
export function openInClaudeCode(worktree) {
  spawnSync(findCommand('claude'), [], {
    cwd: worktree.path,
    stdio: 'inherit',
  });
}

/**
 * Signal the shell function wrapper to cd into the worktree directory.
 *
 * When gwt is invoked via the shell function, GWT_CD_FILE is set to a temp
 * file path. Writing the directory there lets the wrapper eval the cd after
 * this process exits. Falls back to printing the path when run standalone.
 */
export function switchToDirectory(worktree) {
  const cdFile = process.env.GWT_CD_FILE;
  if (cdFile) {
    writeFileSync(cdFile, worktree.path, 'utf8');
  } else {
    console.log(worktree.path);
  }
}

/**
 * Resolve the main repo root from an arbitrary path inside (or at) a worktree.
 * git rev-parse --git-common-dir returns the .git dir of the main repo.
 */
function resolveRepoRoot(worktreePath) {
  const gitCommonDir = execFileSync(
    'git',
    ['-C', worktreePath, 'rev-parse', '--git-common-dir'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();

  // --git-common-dir returns an absolute path or a relative path from cwd.
  // Resolve relative to worktreePath to be safe.
  const abs = resolve(worktreePath, gitCommonDir);

  // Strip trailing /.git to get the repo root
  return abs.endsWith('/.git') ? abs.slice(0, -5) : abs;
}

/**
 * Delete a worktree and optionally its branch.
 *
 * Flow:
 *   1. Confirm deletion.
 *   2. Resolve repo root.
 *   3. git worktree remove <path>; on failure offer --force.
 *   4. Ask whether to also delete the branch.
 *   5. git worktree prune.
 *
 * @returns {boolean} true if the worktree was deleted, false if the user cancelled.
 */
export async function deleteWorktree(worktree) {
  const confirmed = await confirm({
    message: `Delete worktree "${worktree.label}"?`,
    default: false,
  });

  if (!confirmed) {
    return false;
  }

  return _removeWorktree(worktree, { askBranch: true });
}

/**
 * Remove a worktree without an upfront confirm prompt — used by bulk delete.
 * @param {object} worktree
 * @param {{ deleteBranch?: boolean }} opts
 *   deleteBranch: true = always delete branch, false = never, undefined = ask
 * @returns {boolean}
 */
export async function removeWorktreeNoConfirm(worktree, { deleteBranch } = {}) {
  return _removeWorktree(worktree, { askBranch: deleteBranch === undefined, deleteBranch });
}

async function _removeWorktree(worktree, { askBranch = true, deleteBranch: deleteBranchOverride } = {}) {
  let repoRoot;
  try {
    repoRoot = resolveRepoRoot(worktree.path);
  } catch {
    console.error(`Could not resolve repo root for ${worktree.path}`);
    return false;
  }

  // Attempt normal removal first
  let removed = false;
  try {
    execFileSync(
      'git',
      ['-C', repoRoot, 'worktree', 'remove', worktree.path],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    removed = true;
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    console.error(`\nCould not remove worktree: ${stderr.trim() || err.message}`);

    const force = await confirm({
      message: 'Force remove (discards uncommitted changes)?',
      default: false,
    });

    if (!force) {
      return false;
    }

    try {
      execFileSync(
        'git',
        ['-C', repoRoot, 'worktree', 'remove', '--force', worktree.path],
        { stdio: 'ignore' }
      );
      removed = true;
    } catch (forceErr) {
      console.error(`Force removal failed: ${forceErr.message}`);
      return false;
    }
  }

  if (!removed) return false;

  // Delete the branch: respect override, or ask if askBranch is true
  const canDeleteBranch =
    worktree.branch && worktree.branch !== 'unknown' && worktree.branch !== 'HEAD';

  if (canDeleteBranch) {
    const shouldDelete =
      deleteBranchOverride !== undefined
        ? deleteBranchOverride
        : askBranch
          ? await confirm({ message: `Also delete branch "${worktree.branch}"?`, default: false })
          : false;

    if (shouldDelete) {
      try {
        execFileSync(
          'git',
          ['-C', repoRoot, 'branch', '-D', worktree.branch],
          { stdio: ['ignore', 'ignore', 'pipe'] }
        );
        console.log(`Branch "${worktree.branch}" deleted.`);
      } catch (branchErr) {
        const stderr = branchErr.stderr?.toString() ?? '';
        console.error(`Could not delete branch: ${stderr.trim() || branchErr.message}`);
      }
    }
  }

  // Always prune stale worktree metadata
  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'prune'], { stdio: 'ignore' });
  } catch {
    // Non-fatal
  }

  console.log(`Worktree "${worktree.name}" removed.`);
  return true;
}
