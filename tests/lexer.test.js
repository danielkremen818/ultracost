import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, TT } from '../src/lexer.js';

const types = (s) => tokenize(s).map((t) => t.type);
const vals = (s) => tokenize(s).map((t) => t.value);

test('skips comments, keeps code tokens', () => {
  assert.deepEqual(vals('// a comment\nx'), ['x']);
  assert.deepEqual(vals('/* block */ y'), ['y']);
});

test('strings and plain templates carry a cooked value', () => {
  const t = tokenize("'he\\'llo'");
  assert.equal(t[0].type, TT.STRING);
  assert.equal(t[0].value, "he'llo");
  const tpl = tokenize('`plain`');
  assert.equal(tpl[0].type, TT.TEMPLATE);
  assert.equal(tpl[0].value, 'plain');
  assert.equal(tpl[0].hasSub, false);
});

test('template with a substitution is a single opaque token (value null)', () => {
  const t = tokenize('`hi ${agent("x")} bye`');
  assert.equal(t.length, 1);
  assert.equal(t[0].type, TT.TEMPLATE);
  assert.equal(t[0].value, null);
  assert.equal(t[0].hasSub, true);
});

test('disambiguates regex from division', () => {
  // after an identifier, `/` is division
  assert.ok(tokenize('a / b').some((t) => t.type === TT.PUNCT && t.value === '/'));
  assert.equal(tokenize('a / b').filter((t) => t.type === TT.REGEX).length, 0);
  // after `=`, `/` starts a regex
  assert.ok(tokenize('const r = /ab+/g').some((t) => t.type === TT.REGEX));
});

test('optional chaining is its own punctuator', () => {
  assert.deepEqual(types('a?.b'), [TT.NAME, TT.PUNCT, TT.NAME]);
  assert.ok(tokenize('a?.b')[1].value === '?.');
});

test('spread and arrow tokens are recognized', () => {
  assert.ok(tokenize('{ ...opts }').some((t) => t.value === '...'));
  assert.ok(tokenize('(x) => x').some((t) => t.value === '=>'));
});
