/**
 * Custom worktree picker built on @inquirer/core.
 *
 * Renders a grouped (by repo), type-to-filter list with two resolved actions:
 *   { action: 'select', value: <worktree> }
 *   { action: 'bulk' }
 *
 * Footer always shows:
 *   ↑↓ navigate  enter select  ctrl+- selection mode
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
import { loadConfig } from './config.js';

const PAGE_SIZE = 30;

// ── Relative time ────────────────────────────────────────────────────────────

/**
 * Format a Date as a compact relative time string ("3d", "2w", "1mo", "1y").
 * Returns empty string for null/undefined.
 */
function reltime(date) {
  if (!date) return '';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

// ── Jira hyperlink (OSC 8) ───────────────────────────────────────────────────

/**
 * Render a ticket ID with an icon, optionally as an OSC 8 terminal hyperlink.
 *
 * IMPORTANT: chalk styling is embedded INSIDE the OSC 8 boundaries, not wrapped
 * around the whole sequence.  Wrapping outside (`chalk.dim(osc8string)`) causes
 * some terminals to misparse the escape sequence, which is why the links appear
 * as plain text.  Putting the ANSI codes inside works correctly:
 *   ESC ] 8 ;; URL BEL  <ANSI dim> ⬡ TICKET <ANSI reset>  ESC ] 8 ;; BEL
 */
function jiraHyperlink(ticketId, jiraUrl) {
  if (!ticketId) return '';
  const display = ticketId;
  const styledDisplay = chalk.dim(display);
  if (!jiraUrl) return styledDisplay;
  const url = `${jiraUrl.replace(/\/$/, '')}/browse/${ticketId}`;
  // OSC 8: ESC ] 8 ;; URL BEL  styledText  ESC ] 8 ;; BEL
  return `\u001B]8;;${url}\u0007${styledDisplay}\u001B]8;;\u0007`;
}

// ── Item formatting ──────────────────────────────────────────────────────────

/**
 * Parse a worktree name into { ticketId, description }.
 * "FAB-5200_TranslationGuidelinesAndLintRules" →
 *   ticketId = "FAB-5200", description = "Translation Guidelines And Lint Rules"
 */
function parseName(name) {
  const match = name.match(/^([A-Za-z]+-\d+)[_-](.+)$/);
  if (match) {
    return {
      ticketId: match[1],
      description: match[2].replace(/([A-Z])/g, ' $1').trim(),
    };
  }
  return { ticketId: null, description: name };
}

/**
 * Render one worktree item as a multi-line string.
 *
 * Line 1:  (bold) description  ·  dim last-commit age
 * Line 2:  ⎇  branch  ·  ⬡ FAB-XXXX (OSC 8 hyperlink when jiraUrl set)
 *
 * @param {object} wt         Worktree descriptor from worktrees.js
 * @param {boolean} isActive  Whether this row has focus
 * @param {string|null} jiraUrl  Base Jira URL for OSC 8 hyperlinks
 */
function renderWorktreeItem(wt, isActive, jiraUrl) {
  const { ticketId, description } = parseName(wt.name);

  // Date on title line
  const updated = reltime(wt.lastCommitAt);
  const dateSuffix = updated ? chalk.dim(`  ${updated}`) : '';

  const titleLine = isActive
    ? `  ${chalk.cyan('❯')} ${chalk.cyan.bold(description)}${dateSuffix}`
    : `    ${chalk.bold(description)}${dateSuffix}`;

  // Second line: branch · ticket-link
  const parts = [chalk.dim(wt.branch)];

  if (ticketId) {
    // jiraHyperlink already applies chalk.dim internally — do NOT wrap again
    parts.push(jiraHyperlink(ticketId, jiraUrl));
  }

  const detailLine = `      ${parts.join(chalk.dim('  ·  '))}`;

  return `${titleLine}\n${detailLine}\n`;
}

// ── Grouped display list ──────────────────────────────────────────────────────

/**
 * Build a flat display list interleaving repo header items and worktree items.
 * wtIndex is the position in the source `worktrees` array (for cursor tracking).
 */
function buildGroupedList(worktrees) {
  const groups = new Map();
  for (const wt of worktrees) {
    const repo = wt.repo || '(ungrouped)';
    if (!groups.has(repo)) groups.set(repo, []);
    groups.get(repo).push(wt);
  }

  const display = [];
  let wtIndex = 0;
  for (const [repo, wts] of groups) {
    display.push({ type: 'header', repo });
    for (const wt of wts) {
      display.push({ type: 'item', wt, wtIndex: wtIndex++ });
    }
  }
  return display;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

export const worktreePicker = createPrompt((config, done) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState('pending');
  const prefix = usePrefix({ status });

  // Resolve jiraUrl: CLI arg > env var / config file
  const cfg = loadConfig();
  const jiraUrl = config.jiraUrl ?? cfg.jiraUrl ?? null;

  // Filtered flat worktree list (no headers)
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return config.worktrees.filter((wt) => wt.label.toLowerCase().includes(q));
  }, [query]);

  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  // Display list with repo headers interleaved
  const grouped = useMemo(() => buildGroupedList(filtered), [filtered]);

  // Index into `grouped` for the currently active worktree
  const activeDisplayIndex = grouped.findIndex(
    (g) => g.type === 'item' && g.wtIndex === safeCursor
  );

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
      setQuery(query.slice(0, -1));
      setCursor(0);
      return;
    }

    if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
      setQuery(query + key.sequence);
      setCursor(0);
    }
  });

  const page = usePagination({
    items: grouped,
    active: activeDisplayIndex === -1 ? 0 : activeDisplayIndex,
    renderItem: ({ item, isActive }) => {
      if (item.type === 'header') {
        return chalk.dim.bold(`\n  ${item.repo}`);
      }
      return renderWorktreeItem(item.wt, isActive, jiraUrl);
    },
    pageSize: PAGE_SIZE,
    loop: false,
  });

  const searchLine = `${prefix} Select a worktree: ${chalk.dim(query)}${chalk.white('█')}`;
  const emptyLine = filtered.length === 0 ? chalk.dim('  (no matches)') : null;
  const sep = chalk.gray('+');
  const footer = chalk.dim(`  ↑↓ navigate  enter select  ctrl${sep}- selection mode`);

  return [searchLine, emptyLine ?? page, footer].filter(Boolean).join('\n');
});
