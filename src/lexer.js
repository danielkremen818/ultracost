// Minimal zero-dependency JavaScript tokenizer. NOT a full parser: it emits a flat
// token stream rich enough to (a) locate real `agent(...)` / `agent?.(...)` call sites
// (never inside strings, template literals, or comments), (b) read an options object
// literal's `model`/`effort` values and detect spreads, and (c) recover the literal
// text of a possibly-concatenated prompt argument. It resolves the regex-vs-divide
// ambiguity, optional chaining, and nested template substitutions.

export const TT = {
  NAME: 'name', // identifier or keyword
  PUNCT: 'punct', // operator / punctuation
  STRING: 'string', // '...' or "..."
  TEMPLATE: 'template', // `...` — value is the cooked text, or null when it has a ${} substitution
  NUMBER: 'number',
  REGEX: 'regex'
};

const isIdStart = (ch) =>
  ch === '_' || ch === '$' ||
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
  ch.charCodeAt(0) > 127;
const isIdPart = (ch) => isIdStart(ch) || (ch >= '0' && ch <= '9');
const isDigit = (ch) => ch >= '0' && ch <= '9';
const isWS = (ch) =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' ||
  ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff';

// Keywords after which a `/` starts a REGEX (they expect an expression next). After
// any other name (identifier, this/true/null/...) a `/` is DIVISION.
const KEYWORD_PREFIX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'do', 'else', 'yield', 'await', 'case'
]);

const PUNCT3 = new Set(['...', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '>>>']);
const PUNCT2 = new Set([
  '?.', '=>', '==', '!=', '<=', '>=', '&&', '||', '??',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--', '**', '<<', '>>'
]);

function decodeEscapes(inner) {
  if (inner.indexOf('\\') === -1) return inner;
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\') { out += inner[i]; continue; }
    const c = inner[++i];
    if (c === 'n') out += '\n';
    else if (c === 't') out += '\t';
    else if (c === 'r') out += '\r';
    else if (c === 'b') out += '\b';
    else if (c === 'f') out += '\f';
    else if (c === 'v') out += '\v';
    else if (c === '0') out += '\0';
    else if (c === 'x') { out += String.fromCharCode(parseInt(inner.substr(i + 1, 2), 16) || 0); i += 2; }
    else if (c === 'u') {
      if (inner[i + 1] === '{') {
        const e = inner.indexOf('}', i);
        out += String.fromCodePoint(parseInt(inner.slice(i + 2, e), 16) || 0);
        i = e;
      } else { out += String.fromCharCode(parseInt(inner.substr(i + 1, 4), 16) || 0); i += 4; }
    } else if (c === '\n') { /* line continuation: drop */ }
    else if (c !== undefined) out += c;
  }
  return out;
}

export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let prev = null;
  const push = (t) => { tokens.push(t); prev = t; };

  const regexAllowed = () => {
    if (!prev) return true;
    if (prev.type === TT.NUMBER || prev.type === TT.STRING || prev.type === TT.TEMPLATE || prev.type === TT.REGEX) return false;
    if (prev.type === TT.NAME) return KEYWORD_PREFIX.has(prev.value);
    // prev is necessarily PUNCT here — every other token type is handled above. After a
    // closing bracket `/` is division; otherwise a regex may begin.
    return !(prev.value === ')' || prev.value === ']' || prev.value === '}');
  };

  while (i < n) {
    const ch = src[i];
    if (isWS(ch)) { i++; continue; }

    if (ch === '/' && src[i + 1] === '/') {
      i += 2; while (i < n && src[i] !== '\n') i++; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i = Math.min(n, i + 2); continue;
    }

    if (ch === "'" || ch === '"') {
      const start = i; const q = ch; i++;
      let inner = '';
      while (i < n) {
        const c = src[i];
        if (c === '\\') { inner += c + (src[i + 1] ?? ''); i += 2; continue; }
        if (c === q) { i++; break; }
        if (c === '\n') break; // unterminated
        inner += c; i++;
      }
      push({ type: TT.STRING, value: decodeEscapes(inner), quote: q, start, end: i });
      continue;
    }

    if (ch === '`') {
      const start = i; i++;
      let hasSub = false;
      let cooked = '';
      while (i < n) {
        const c = src[i];
        if (c === '\\') { cooked += c + (src[i + 1] ?? ''); i += 2; continue; }
        if (c === '`') { i++; break; }
        if (c === '$' && src[i + 1] === '{') {
          hasSub = true; i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const d = src[i];
            if (d === '{') { depth++; i++; }
            else if (d === '}') { depth--; i++; }
            else if (d === '`') { i = skipTemplate(src, i, n); }
            else if (d === "'" || d === '"') { i = skipString(src, i, n); }
            else i++;
          }
          continue;
        }
        cooked += c; i++;
      }
      push({ type: TT.TEMPLATE, value: hasSub ? null : decodeEscapes(cooked), hasSub, start, end: i });
      continue;
    }

    if (ch === '/') {
      if (regexAllowed()) {
        const start = i; i++;
        let inClass = false;
        while (i < n) {
          const c = src[i];
          if (c === '\\') { i += 2; continue; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) { i++; break; }
          else if (c === '\n') break;
          i++;
        }
        while (i < n && isIdPart(src[i])) i++; // flags
        push({ type: TT.REGEX, value: src.slice(start, i), start, end: i });
        continue;
      }
      // otherwise fall through: `/` or `/=` is a division/assignment punctuator
    }

    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      const start = i; i++;
      while (i < n) {
        const c = src[i];
        if ((c === '+' || c === '-')) { if (src[i - 1] === 'e' || src[i - 1] === 'E') { i++; continue; } break; }
        if (isIdPart(c) || c === '.') { i++; continue; }
        break;
      }
      push({ type: TT.NUMBER, value: src.slice(start, i), start, end: i });
      continue;
    }

    if (isIdStart(ch)) {
      const start = i; i++;
      while (i < n && isIdPart(src[i])) i++;
      push({ type: TT.NAME, value: src.slice(start, i), start, end: i });
      continue;
    }

    const three = src.slice(i, i + 3);
    if (PUNCT3.has(three)) { push({ type: TT.PUNCT, value: three, start: i, end: i + 3 }); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (PUNCT2.has(two)) { push({ type: TT.PUNCT, value: two, start: i, end: i + 2 }); i += 2; continue; }
    push({ type: TT.PUNCT, value: ch, start: i, end: i + 1 }); i += 1;
  }
  return tokens;
}

// Skip a single- or double-quoted string starting at `from` (the quote). Returns the
// index just past the closing quote.
function skipString(src, from, n) {
  const q = src[from];
  let i = from + 1;
  while (i < n) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q || src[i] === '\n') { return i + 1; }
    i++;
  }
  return i;
}

// Skip a template literal starting at `from` (the backtick), including any nested
// ${...} substitutions and nested templates. Returns the index past the closing tick.
function skipTemplate(src, from, n) {
  let i = from + 1;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      i += 2; let depth = 1;
      while (i < n && depth > 0) {
        const d = src[i];
        if (d === '{') { depth++; i++; }
        else if (d === '}') { depth--; i++; }
        else if (d === '`') { i = skipTemplate(src, i, n); }
        else if (d === "'" || d === '"') { i = skipString(src, i, n); }
        else i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

// 1-based line and column for a source index (for findings).
export function lineColAt(src, index) {
  let line = 1;
  let last = 0;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') { line++; last = i + 1; }
  }
  return { line, column: index - last + 1 };
}
