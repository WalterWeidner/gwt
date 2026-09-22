/**
 * Custom worktree picker built on @inquirer/core.
 *
 * Renders a type-to-filter list with two resolved actions:
 *   { action: 'select', value: <worktree> }
 *   { action: 'bulk' }
 *
 * Footer always shows:
 *   ↑↓ navigate  enter select  ctrl+d bulk delete
 */

import {
  createPrompt,
  useState,
  useKeypress,
  useMemo,
  usePagination,
  usePrefix,
  isEnterKey,
  isUpKey,
  isDownKey,
  isBackspaceKey,
} from '@inquirer/core';
import chalk from 'chalk';

const PAGE_SIZE = 12;

export const worktreePicker = createPrompt((config, done) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState('pending');
  const prefix = usePrefix({ status });

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return config.worktrees.filter((wt) => wt.label.toLowerCase().includes(q));
  }, [query]);

  // Reset cursor to 0 whenever the filtered list changes length
  // (tracked via query so cursor never points past end of list)
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  useKeypress((key) => {
    if (status !== 'pending') return;

    if (key.sequence === '\x1f') {
      setStatus('done');
      done({ action: 'bulk' });
      return;
    }

    if (isEnterKey(key)) {
      if (filtered.length === 0) return;
      setStatus('done');
      done({ action: 'select', value: filtered[safeCursor] });
      return;
    }

    if (isUpKey(key)) {
      setCursor(Math.max(0, safeCursor - 1));
      return;
    }

    if (isDownKey(key)) {
      setCursor(Math.min(filtered.length - 1, safeCursor + 1));
      return;
    }

    if (isBackspaceKey(key)) {
      const next = query.slice(0, -1);
      setQuery(next);
      setCursor(0);
      return;
    }

    // Printable character — append to query
    if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
      setQuery(query + key.sequence);
      setCursor(0);
    }
  });

  const page = usePagination({
    items: filtered,
    active: safeCursor,
    renderItem: ({ item, isActive }) => {
      const line = isActive
        ? `${chalk.cyan('❯')} ${chalk.cyan(item.label)}`
        : `  ${item.label}`;
      return line;
    },
    pageSize: PAGE_SIZE,
    loop: false,
  });

  const searchLine = `${prefix} Select a worktree: ${chalk.dim(query)}${chalk.white('█')}`;

  const emptyLine =
    filtered.length === 0 ? chalk.dim('  (no matches)') : null;

  const sep = chalk.gray('+');
  const footer = chalk.dim(
    `  ↑↓ navigate  enter select  ctrl${sep}- selection mode`
  );

  const lines = [searchLine, emptyLine ?? page, footer];

  return lines.filter(Boolean).join('\n');
});
