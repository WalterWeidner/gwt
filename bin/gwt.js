#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runInteractive } from '../src/interactive.js';

const argv = yargs(hideBin(process.argv))
  .scriptName('gwt')
  .usage('$0 [options]', 'Interactively browse and manage git worktrees')
  .option('root', {
    type: 'string',
    description: 'Root directory containing worktrees (default: ~/worktrees)',
  })
  .help()
  .version()
  .parse();

const root = argv.root ?? null;

runInteractive({ root }).catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
