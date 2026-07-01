import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPolicy } from '../src/policy.js';
import { compileRules, routingGuidance } from '../src/rules.js';
import { COMMANDS, renderCommand } from '../scripts/generate-commands.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { policy } = loadPolicy(join(ROOT, 'templates', 'policy.default.json'));

// The three policy surfaces (CLAUDE.md block, SessionStart hook, routing skill) all
// compile from src/rules.js. The skill is the only one written to disk, so guard it.
test('SKILL.md embeds the compiled routing block (no drift from rules.js)', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'ultracost', 'SKILL.md'), 'utf8');
  assert.ok(
    skill.includes(compileRules(policy)),
    'skills/ultracost/SKILL.md is stale — run: node scripts/generate-surfaces.mjs'
  );
});

test('routingGuidance is the marker-free routing block (used by the SessionStart hook)', () => {
  const g = routingGuidance(policy);
  assert.ok(!g.includes('ultracost:start'));
  assert.ok(!g.includes('ultracost:end'));
  assert.match(g, /Decision rule/);
  assert.match(g, /never|Never/);
});

// The injected prose must not assume a global `ultracost` binary (plugin users have none).
test('compiled block references the plugin command, not only a global bin', () => {
  const block = compileRules(policy);
  assert.match(block, /\/ultracost:check/);
  assert.match(block, /CLAUDE_PLUGIN_ROOT/);
});

// Fan-out orchestration guidance ships in every surface so ultracode defaults to parallel
// agent() stages instead of inline file-by-file edits.
test('compiled block carries the fan-out orchestration guidance', () => {
  const block = compileRules(policy);
  assert.match(block, /Orchestration \(when to fan out\)/);
  assert.match(block, /fan/i);
});

// Every plugin slash command file must match the generator (no drift) and invoke the
// CLI via ${CLAUDE_PLUGIN_ROOT} rather than a global `ultracost` binary.
for (const [name, c] of Object.entries(COMMANDS)) {
  test(`commands/${name}.md is generated and plugin-rooted`, () => {
    const onDisk = readFileSync(join(ROOT, 'commands', `${name}.md`), 'utf8');
    assert.equal(onDisk, renderCommand(name, c), `commands/${name}.md is stale — run: node scripts/generate-commands.mjs`);
    assert.match(onDisk, /CLAUDE_PLUGIN_ROOT/);
    assert.ok(!/\n\s*ultracost /.test(onDisk), 'should not call a bare global ultracost binary');
  });
}
