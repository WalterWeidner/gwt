import { select, checkbox, confirm } from '@inquirer/prompts';
import { discoverWorktrees } from './worktrees.js';
import { openInCursor, openInCursorAgent, openInClaudeCode, switchToDirectory, deleteWorktree, removeWorktreeNoConfirm } from './actions.js';
import { worktreePicker } from './worktree-picker.js';

/**
 * Bulk delete flow: checkbox picker → branch choice → sequential removal.
 */
async function runBulkDelete(worktrees) {
  let selected;
  try {
    selected = await checkbox({
      message: 'Select worktrees to delete (space to toggle, enter to confirm)',
      choices: worktrees.map((wt) => ({ name: wt.label, value: wt })),
      pageSize: 15,
    });
  } catch (err) {
    if (err.name === 'ExitPromptError') return;
    throw err;
  }

  if (selected.length === 0) {
    console.log('No worktrees selected.');
    return;
  }

  // Single upfront confirmation
  let ok;
  try {
    ok = await confirm({
      message: `Delete ${selected.length} worktree${selected.length > 1 ? 's' : ''}?`,
      default: false,
    });
  } catch (err) {
    if (err.name === 'ExitPromptError') return;
    throw err;
  }

  if (!ok) return;

  // Ask once about branches for all selected worktrees that have one
  const withBranches = selected.filter(
    (wt) => wt.branch && wt.branch !== 'unknown' && wt.branch !== 'HEAD'
  );
  let deleteBranches;
  if (withBranches.length > 0) {
    try {
      deleteBranches = await confirm({
        message: `Also delete the associated branch${withBranches.length > 1 ? 'es' : ''} (${withBranches.map((wt) => wt.branch).join(', ')})?`,
        default: false,
      });
    } catch (err) {
      if (err.name === 'ExitPromptError') return;
      throw err;
    }
  }

  let deleted = 0;
  for (const wt of selected) {
    const ok = await removeWorktreeNoConfirm(wt, { deleteBranch: deleteBranches ?? false });
    if (ok) deleted++;
  }

  console.log(`\nDeleted ${deleted} of ${selected.length} worktree${selected.length > 1 ? 's' : ''}.`);
}

/**
 * Main interactive loop.
 * @param {{ root?: string|null }} options
 */
export async function runInteractive({ root = null } = {}) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const worktrees = discoverWorktrees(root);

    if (worktrees.length === 0) {
      const rootLabel =
        root ?? process.env.GWT_WORKTREES_ROOT ?? `${process.env.HOME}/worktrees`;
      console.log(`No worktrees found under ${rootLabel}`);
      process.exit(0);
    }

    // --- Worktree picker ---
    let pickerResult;
    try {
      pickerResult = await worktreePicker({ worktrees });
    } catch (err) {
      if (err.name === 'ExitPromptError') {
        process.exit(0);
      }
      throw err;
    }

    // --- Bulk delete mode (ctrl+d) ---
    if (pickerResult.action === 'bulk') {
      await runBulkDelete(worktrees);
      continue;
    }

    const selected = pickerResult.value;

    // --- Action submenu ---
    let action;
    try {
      action = await select({
        message: `${selected.label}`,
        choices: [
          { name: 'Open in Cursor (editor)', value: 'open' },
          { name: 'Open in Cursor (agent chat)', value: 'open-agent' },
          { name: 'Open in Claude Code', value: 'open-claude' },
          { name: 'Switch to directory', value: 'switch' },
          { name: 'Delete Worktree', value: 'delete' },
          { name: 'Back', value: 'back' },
          { name: 'Quit', value: 'quit' },
        ],
      });
    } catch (err) {
      if (err.name === 'ExitPromptError') {
        process.exit(0);
      }
      throw err;
    }

    if (action === 'open') {
      openInCursor(selected);
      process.exit(0);
    }

    if (action === 'open-agent') {
      openInCursorAgent(selected);
      process.exit(0);
    }

    if (action === 'open-claude') {
      openInClaudeCode(selected);
      process.exit(0);
    }

    if (action === 'switch') {
      switchToDirectory(selected);
      process.exit(0);
    }

    if (action === 'delete') {
      await deleteWorktree(selected);
      continue;
    }

    if (action === 'back') {
      continue;
    }

    if (action === 'quit') {
      process.exit(0);
    }
  }
}
