#!/usr/bin/env node
// ultracost HUD auto-setup — SessionStart hook. Claude Code plugins have no "on install"
// event, so the plugin can't write the `statusLine` at install time. Instead this runs on
// the first session after the plugin is installed and sets ultracost as your statusLine
// (the live cost HUD), so the HUD "just works" without the user running anything.
//
// Respectful + idempotent:
//   - ONE-TIME: a marker (~/.claude/ultracost/.hud-autosetup) means we only ever auto-set
//     once. If you later remove the statusLine yourself, we do NOT fight you and re-add it.
//   - OPT-OUT: ULTRACOST_HUD=off skips it entirely.
//   - SAFE: setStatusLine() backs up any statusLine you already had (restored on uninstall),
//     and any failure is swallowed — a SessionStart hook must never wedge the session.
//
// CLI users get the same behavior directly: `ultracost init` already calls setStatusLine().

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ULTRACOST_DIR } from '../../src/paths.js';
import { setStatusLine } from '../../src/install.js';

const MARKER = join(ULTRACOST_DIR, '.hud-autosetup');

async function drainStdin() {
  if (process.stdin.isTTY) return;
  try {
    process.stdin.setEncoding('utf8');
    for await (const _ of process.stdin) { /* discard */ }
  } catch { /* ignore */ }
}

async function main() {
  await drainStdin();
  if (process.env.ULTRACOST_HUD === 'off') return;
  if (existsSync(MARKER)) return; // already did the one-time setup

  try {
    mkdirSync(ULTRACOST_DIR, { recursive: true });
    const verdict = setStatusLine({ plugin: true });
    // Only mark done if we actually got to write (invalid settings.json => retry next time).
    if (verdict !== 'invalid') {
      writeFileSync(MARKER, new Date().toISOString() + '\n');
    }
  } catch { /* never break SessionStart */ }
}

main().catch(() => {}).finally(() => process.exit(0));
