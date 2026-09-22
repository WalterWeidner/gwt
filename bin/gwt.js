#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runInteractive } from '../src/interactive.js';
import { saveBackup, restoreBackup, BACKUP_FILE } from '../src/backup.js';

yargs(hideBin(process.argv))
  .scriptName('gwt')
  .option('root', {
    type: 'string',
    description: 'Root directory containing worktrees (default: ~/worktrees)',
    global: true,
  })

  // Default command — interactive picker
  .command(
    '$0',
    'Interactively browse and manage git worktrees',
    () => {},
    (argv) => {
      runInteractive({ root: argv.root ?? null }).catch((err) => {
        console.error(err.message ?? err);
        process.exit(1);
      });
    }
  )

  // gwt backup
  .command(
    'backup',
    `Snapshot all worktrees to ${BACKUP_FILE}`,
    (y) =>
      y.option('root', {
        type: 'string',
        description: 'Override worktrees root',
      }),
    (argv) => {
      try {
        const backup = saveBackup(argv.root ?? null);
        console.log(`Backed up ${backup.entries.length} worktree${backup.entries.length !== 1 ? 's' : ''} to ${BACKUP_FILE}`);
        for (const e of backup.entries) {
          console.log(`  ${e.repo ? `${e.repo} / ` : ''}${e.name}  (${e.branch})`);
        }
      } catch (err) {
        console.error(`Backup failed: ${err.message}`);
        process.exit(1);
      }
    }
  )

  // gwt restore
  .command(
    'restore',
    `Recreate missing worktrees from ${BACKUP_FILE}`,
    (y) =>
      y.option('file', {
        type: 'string',
        description: 'Path to backup file',
        default: BACKUP_FILE,
      }),
    (argv) => {
      try {
        const { restored, skipped, failed, log, backup } = restoreBackup(argv.file);
        console.log(`Backup from ${backup.created}`);
        console.log(`${backup.entries.length} entries — ${restored} restored, ${skipped} skipped, ${failed} failed\n`);
        for (const item of log) {
          const label = `${item.entry.repo ? `${item.entry.repo} / ` : ''}${item.entry.name}`;
          if (item.status === 'restored') {
            console.log(`  ✓ ${label}${item.branchExisted ? '' : ' (branch recreated from origin/master)'}`);
          } else if (item.status === 'skipped') {
            console.log(`  – ${label}  (${item.reason})`);
          } else {
            console.error(`  ✗ ${label}  ${item.reason}`);
          }
        }
        if (failed > 0) process.exit(1);
      } catch (err) {
        console.error(`Restore failed: ${err.message}`);
        process.exit(1);
      }
    }
  )

  .help()
  .version()
  .parse();
