import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_ROOT = join(homedir(), 'worktrees');

/**
 * Resolve the current branch name for a worktree path.
 * Returns "HEAD" for detached HEAD, "unknown" on any error.
 */
function resolveBranch(worktreePath) {
  try {
    return execFileSync(
      'git',
      ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Check whether a path looks like a git worktree (has .git file or dir).
 */
function isWorktree(p) {
  return existsSync(join(p, '.git'));
}

/**
 * Scan a single worktree path and return a descriptor.
 * @param {string} worktreePath
 * @param {string} repo  Display repo label (empty string for legacy flat entries)
 */
function describeWorktree(worktreePath, repo) {
  const name = basename(worktreePath);
  const branch = resolveBranch(worktreePath);
  const branchDiffers = branch !== name && branch !== 'unknown';

  const label = repo
    ? `${repo} / ${name}${branchDiffers ? ` (branch: ${branch})` : ''}`
    : `${name}${branchDiffers ? ` (branch: ${branch})` : ''}`;

  return { repo, name, path: worktreePath, branch, branchDiffers, label };
}

/**
 * Discover all worktrees under `root`.
 *
 * Layout handled:
 *   ~/worktrees/<repo>/<name>   → grouped (repo = directory name)
 *   ~/worktrees/<name>          → legacy flat (repo = '')
 *
 * @param {string|null} root  Override root; defaults to ~/worktrees
 * @returns {Array<{repo,name,path,branch,branchDiffers,label}>}
 */
export function discoverWorktrees(root = null) {
  const rootDir = root ?? process.env.GWT_WORKTREES_ROOT ?? DEFAULT_ROOT;

  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: join(rootDir, e.name) }));

  const worktrees = [];

  for (const entry of entries) {
    if (isWorktree(entry.full)) {
      // Legacy flat entry directly under root
      worktrees.push(describeWorktree(entry.full, ''));
    } else {
      // Treat as repo group — scan its children
      let children;
      try {
        children = readdirSync(entry.full, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(entry.full, e.name));
      } catch {
        continue;
      }
      for (const child of children) {
        if (isWorktree(child)) {
          worktrees.push(describeWorktree(child, entry.name));
        }
      }
    }
  }

  return worktrees;
}
