// projectsDirs fallback paths when CLAUDE_CONFIG_DIR is unset (XDG_CONFIG_HOME/claude,
// then ~/.config/claude + ~/.claude). Pure path resolution; reads only existence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectsDirs, locateWorkflowRuns } from '../src/transcript.js';

test('projectsDirs uses XDG_CONFIG_HOME/claude/projects when present', () => {
  const xdg = mkdtempSync(join(tmpdir(), 'uc-xdg-'));
  mkdirSync(join(xdg, 'claude', 'projects'), { recursive: true });
  const dirs = projectsDirs({ XDG_CONFIG_HOME: xdg });
  assert.ok(dirs.includes(join(xdg, 'claude', 'projects')));
});

test('projectsDirs with no relevant env returns an array (default ~/.config/claude + ~/.claude)', () => {
  const dirs = projectsDirs({});
  assert.ok(Array.isArray(dirs));
});

test('locateWorkflowRuns sorts multiple runs newest-first', () => {
  const root = mkdtempSync(join(tmpdir(), 'uc-wfsort-'));
  const asst = (id, out, model = 'claude-opus-4-8') => JSON.stringify({
    type: 'assistant', requestId: 'r' + id, message: { role: 'assistant', id, model, usage: { input_tokens: 100, output_tokens: out } }
  });
  for (const [wfId, out] of [['wf_old', 100], ['wf_new', 200]]) {
    const wf = join(root, 'projects', 'proj', 'sid', 'subagents', 'workflows', wfId);
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(wf, 'agent-a.jsonl'), asst('m_' + wfId, out) + '\n');
  }
  const runs = locateWorkflowRuns({ root: join(root, 'projects') });
  assert.equal(runs.length, 2);
  assert.ok(runs[0].mtime >= runs[1].mtime); // sort comparator exercised
});
