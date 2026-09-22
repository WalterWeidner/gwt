import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { discoverWorktrees } from './worktrees.js';

const BACKUP_DIR = join(homedir(), '.gwt');
export const BACKUP_FILE = join(BACKUP_DIR, 'backup.json');

function resolveRepoRoot(worktreePath) {
  const gitCommonDir = execFileSync(
    'git',
    ['-C', worktreePath, 'rev-parse', '--git-common-dir'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();
  const abs = resolve(worktreePath, gitCommonDir);
  return abs.endsWith('/.git') ? abs.slice(0, -5) : abs;
}

/**
 * Snapshot all current worktrees to ~/.gwt/backup.json.
 * Returns the saved backup object.
 */
export function saveBackup(root = null) {
  const worktrees = discoverWorktrees(root);

  const entries = worktrees.map((wt) => {
    let repoRoot = null;
    try {
      repoRoot = resolveRepoRoot(wt.path);
    } catch {
      // best-effort
    }
    return {
      repo: wt.repo,
      name: wt.name,
      branch: wt.branch,
      path: wt.path,
      repoRoot,
    };
  });

  mkdirSync(BACKUP_DIR, { recursive: true });

  const backup = {
    created: new Date().toISOString(),
    worktreesRoot: root ?? process.env.GWT_WORKTREES_ROOT ?? join(homedir(), 'worktrees'),
    entries,
  };

  writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2), 'utf8');
  return backup;
}

/**
 * Read the backup file and attempt to recreate any missing worktrees.
 *
 * For each entry in the backup:
 *   - Skip if the worktree directory already exists.
 *   - If the branch exists in the repo: git worktree add <path> <branch>
 *   - If the branch is gone:            git worktree add -b <branch> <path> origin/master
 *
 * Returns { restored, skipped, failed } counts and a log of actions.
 */
export function restoreBackup(backupFile = BACKUP_FILE) {
  if (!existsSync(backupFile)) {
    throw new Error(`No backup found at ${backupFile}`);
  }

  const backup = JSON.parse(readFileSync(backupFile, 'utf8'));
  const log = [];
  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of backup.entries) {
    if (existsSync(entry.path)) {
      log.push({ status: 'skipped', entry, reason: 'directory already exists' });
      skipped++;
      continue;
    }

    if (!entry.repoRoot || !existsSync(entry.repoRoot)) {
      log.push({ status: 'failed', entry, reason: `repo root not found: ${entry.repoRoot}` });
      failed++;
      continue;
    }

    // Ensure the parent worktrees/<repo>/ directory exists
    mkdirSync(join(entry.path, '..'), { recursive: true });

    // Check if the branch still exists in the repo
    const branchExists = (() => {
      try {
        execFileSync(
          'git',
          ['-C', entry.repoRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${entry.branch}`],
          { stdio: 'ignore' }
        );
        return true;
      } catch {
        return false;
      }
    })();

    try {
      if (branchExists) {
        execFileSync(
          'git',
          ['-C', entry.repoRoot, 'worktree', 'add', entry.path, entry.branch],
          { stdio: 'ignore' }
        );
      } else {
        execFileSync(
          'git',
          ['-C', entry.repoRoot, 'worktree', 'add', '-b', entry.branch, entry.path, 'origin/master'],
          { stdio: 'ignore' }
        );
      }
      log.push({ status: 'restored', entry, branchExisted: branchExists });
      restored++;
    } catch (err) {
      log.push({ status: 'failed', entry, reason: err.message });
      failed++;
    }
  }

  return { restored, skipped, failed, log, backup };
}
