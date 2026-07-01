// Fills the remaining lexer branches: escape decoding (\x, \u{...}, \uXXXX, named,
// line-continuation), and the string/template skippers used inside ${} substitutions
// (including unterminated EOF fallbacks and nested templates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, TT } from '../src/lexer.js';

test('decodeEscapes handles \\x, \\u{...}, \\uXXXX, named escapes, and line continuation', () => {
  const src = "'\\x41\\u0042\\u{1F600}\\n\\t\\q\\\n done'";
  const str = tokenize(src).find((t) => t.type === TT.STRING);
  assert.ok(str, 'a string token is produced');
  assert.ok(str.value.includes('A'));            // \x41
  assert.ok(str.value.includes('B'));            // \u0042
  assert.ok(str.value.includes('\u{1F600}'));    // \u{...}
  assert.ok(str.value.includes('\n'));           // \n
  assert.ok(str.value.includes('q'));            // \q → q (unknown escape)
  assert.ok(str.value.includes('done'));         // line continuation dropped
});

test('nested template literals + substitutions (object, nested template, string) are skipped', () => {
  const src = "`${`A${ {k:1} }B${`C`}${'D'}E`}`";
  const tpl = tokenize(src).find((t) => t.type === TT.TEMPLATE);
  assert.ok(tpl);
  assert.equal(tpl.value, null);   // has a substitution → cooked value is null
  assert.equal(tpl.hasSub, true);
});

test('unterminated string inside a substitution returns at EOF', () => {
  // exercises skipString's EOF fallback (no closing quote before end of input)
  const toks = tokenize('`${"abc');
  assert.ok(toks.length >= 1);
});

test('unterminated nested template inside a substitution returns at EOF', () => {
  // exercises skipTemplate's EOF fallback
  const toks = tokenize('`${`abc');
  assert.ok(toks.length >= 1);
});
