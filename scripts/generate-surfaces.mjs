#!/usr/bin/env node
// Regenerate the routing skill (skills/ultracost/SKILL.md) from the single source of
// truth: compileRules(policy) in src/rules.js. The SessionStart hook
// (templates/hooks/reinject.mjs) already compiles the same block at runtime, so all
// three surfaces — CLAUDE.md, the hook, and this skill — stay in lockstep with
// policy.json. tests/surfaces.test.js fails if SKILL.md drifts from this output.
//
// Run after changing policy.default.json or src/rules.js:  node scripts/generate-surfaces.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicy } from '../src/policy.js';
import { compileRules } from '../src/rules.js';
import { ROOT } from '../src/paths.js';

const { policy } = loadPolicy(join(ROOT, 'templates', 'policy.default.json'));
const block = compileRules(policy);

const FRONTMATTER = `---
name: ultracost
description: Quality-first per-stage model routing AND a pre-flight cost gate for Claude Code dynamic workflows. Use when authoring or running ultracode / dynamic-workflow scripts, spawning subagents, or writing agent() stages — pin the right model and effort on every stage, then estimate cost and confirm with the user before launching. Verify scripts with /ultracost:check.
---`;

const INTRO = `When \`ultracode\` is on, or whenever you author a dynamic-workflow script, apply the
routing policy below to **every** \`agent()\` stage. The block is compiled from
\`policy.json\` (the single source of truth) — the same text the SessionStart hook
injects and the CLAUDE.md block carries.`;

const ENFORCEMENT = `## Enforcement (plugin)

The cost gate is **on by default**: the plugin ships a deterministic \`PreToolUse\` hook
on the \`Workflow\` tool (\`templates/hooks/workflow-gate.mjs\`) that pauses every
dynamic-workflow launch with the estimate — it does not rely on the model choosing to
ask, and it leads with a warning when any stage is unpinned. Set \`ULTRACOST_GATE=off\`
to disable it for headless/CI runs; \`bypassPermissions\`/\`dontAsk\` modes auto-approve
the ask path (unpinned workflows are still hard-denied).`;

const skill = `${FRONTMATTER}

${INTRO}

${block}

${ENFORCEMENT}
`;

const target = join(ROOT, 'skills', 'ultracost', 'SKILL.md');
writeFileSync(target, skill);
console.log('wrote ' + target);
