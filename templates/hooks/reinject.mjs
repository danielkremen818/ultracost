#!/usr/bin/env node
// ultracost SessionStart hook. Injects the model-routing policy as context at the
// start of every session (and after compaction), so workflow authoring sees it
// without relying on the model choosing to open a skill.
//
// The injected text is COMPILED from the active policy via src/rules.js — the single
// source of truth. It is no longer a hand-maintained copy, so it cannot drift from
// policy.json (or from the CLAUDE.md block and the routing skill). Pure node, reads
// the hook JSON from stdin, emits SessionStart additionalContext. No npm dependency.

import { loadPolicy } from '../../src/policy.js';
import { routingGuidance } from '../../src/rules.js';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// Parsing stdin is best-effort; a missing/invalid payload still injects the policy.
try { await readStdin(); } catch {}

let context;
try {
  const { policy } = loadPolicy();
  context = routingGuidance(policy);
} catch {
  // Fail open with a minimal reminder rather than injecting nothing.
  context =
    'ultracost: route every agent() stage explicitly — pin a per-stage model (opus for ' +
    'coding/reasoning, sonnet for pre-planned mechanical and search work; never haiku) and ' +
    'an effort level. Verify with /ultracost:check before launching a dynamic workflow.';
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context
    }
  })
);
