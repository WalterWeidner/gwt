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
export function saveBackup(root = null, outputFile = BACKUP_FILE) {
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

  writeFileSync(outputFile, JSON.stringify(backup, null, 2), 'utf8');
  return backup;
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function refExists(repoRoot, ref) {
  try {
    git(repoRoot, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

function defaultRemoteBranch(repoRoot) {
  try {
    return git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  } catch {
    for (const candidate of ['main', 'master']) {
      if (refExists(repoRoot, `refs/remotes/origin/${candidate}`)) return `origin/${candidate}`;
    }
    return null;
  }
}

function gitErrorMessage(err) {
  const lines = (err.stderr?.toString().trim() || err.message).split('\n');
  return lines.find((line) => line.startsWith('fatal:')) ?? lines[0];
}

/**
 * Read the backup file and attempt to recreate any missing worktrees.
 *
 * Each repo is fetched once, then for each entry in the backup:
 *   - Skip if the worktree directory already exists.
 *   - Local branch exists:      git worktree add <path> <branch>
 *   - Only origin has it:       git worktree add --track -b <branch> <path> origin/<branch>
 *   - Branch exists nowhere:    git worktree add --no-track -b <branch> <path> <origin default branch>
 *
 * New branches are never created for a repo whose fetch failed, since the
 * branch may exist on origin and would otherwise be shadowed by an empty one.
 *
 * Returns { restored, skipped, failed } counts and a log of actions.
 */
export function restoreBackup(backupFile = BACKUP_FILE) {
  if (!existsSync(backupFile)) {
    throw new Error(`No backup found at ${backupFile}`);
  }

  const backup = JSON.parse(readFileSync(backupFile, 'utf8'));
  const log = [];
  const fetchErrors = new Map();
  let restored = 0;
  let skipped = 0;
  let failed = 0;

  const fail = (entry, reason) => {
    log.push({ status: 'failed', entry, reason });
    failed++;
  };

  for (const entry of backup.entries) {
    if (existsSync(entry.path)) {
      log.push({ status: 'skipped', entry, reason: 'directory already exists' });
      skipped++;
      continue;
    }

    if (!entry.repoRoot || !existsSync(entry.repoRoot)) {
      fail(entry, `repo root not found: ${entry.repoRoot}`);
      continue;
    }

    if (!entry.branch || entry.branch === 'unknown' || entry.branch === 'HEAD') {
      fail(entry, 'no branch recorded in backup');
      continue;
    }

    if (!fetchErrors.has(entry.repoRoot)) {
      try {
        git(entry.repoRoot, ['fetch', '--quiet', 'origin']);
        fetchErrors.set(entry.repoRoot, null);
      } catch (err) {
        fetchErrors.set(entry.repoRoot, gitErrorMessage(err));
      }
    }
    const fetchError = fetchErrors.get(entry.repoRoot);

    let args;
    let source;
    if (refExists(entry.repoRoot, `refs/heads/${entry.branch}`)) {
      args = ['worktree', 'add', entry.path, entry.branch];
      source = 'local';
    } else if (refExists(entry.repoRoot, `refs/remotes/origin/${entry.branch}`)) {
      args = ['worktree', 'add', '--track', '-b', entry.branch, entry.path, `origin/${entry.branch}`];
      source = 'remote';
    } else if (fetchError) {
      fail(entry, `could not fetch origin, refusing to create a new branch: ${fetchError}`);
      continue;
    } else {
      const base = defaultRemoteBranch(entry.repoRoot);
      if (!base) {
        fail(entry, 'branch not found locally or on origin, and no origin default branch to start from');
        continue;
      }
      args = ['worktree', 'add', '--no-track', '-b', entry.branch, entry.path, base];
      source = base;
    }

    mkdirSync(join(entry.path, '..'), { recursive: true });

    try {
      git(entry.repoRoot, args);
      log.push({ status: 'restored', entry, source });
      restored++;
    } catch (err) {
      fail(entry, gitErrorMessage(err));
    }
  }

  return { restored, skipped, failed, log, backup };
}
