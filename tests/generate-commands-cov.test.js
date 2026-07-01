// Runs the generator as a script (covers its entrypoint block via the inherited
// NODE_V8_COVERAGE) into a temp dir — never mutating the repo's commands/ — and
// asserts each generated file matches renderCommand exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMANDS, renderCommand } from '../scripts/generate-commands.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'generate-commands.mjs');

test('the generator writes every command into the given output dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-gen-'));
  const out = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(out, /wrote /);
  for (const name of Object.keys(COMMANDS)) {
    const file = join(dir, `${name}.md`);
    assert.ok(existsSync(file), `${name}.md written`);
    assert.equal(readFileSync(file, 'utf8'), renderCommand(name, COMMANDS[name]));
  }
});
