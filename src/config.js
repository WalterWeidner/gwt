import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.gwt', 'config.json');

let _config = null;

/**
 * Load config from (in ascending priority):
 *   1. ~/.gwt/config.json
 *   2. GWT_* environment variables
 *   3. CLI overrides passed directly (highest — handled at call site)
 *
 * Supported config.json keys:
 *   jiraUrl  — base Jira URL, e.g. "https://bamboohr.atlassian.net"
 */
export function loadConfig() {
  if (_config) return _config;

  _config = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      Object.assign(_config, JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
    } catch {
      // Ignore malformed config — fail silently
    }
  }

  if (process.env.GWT_JIRA_URL) {
    _config.jiraUrl = process.env.GWT_JIRA_URL;
  }

  return _config;
}
