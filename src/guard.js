import { existsSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { classifyModel, tierModel } from './policy.js';
import { tokenize, TT, lineColAt } from './lexer.js';
import { semanticFindings } from './classify.js';

export const CODES = {
  NOOPTS: 'UC001', // agent(x) with no options object
  MISSING: 'UC002', // options object present but no model key
  BANNED: 'UC003', // model resolves to a neverUse model (e.g. haiku)
  INHERIT: 'UC004', // model: 'inherit' while allowInherit is false
  DYNAMIC: 'UC005', // model/options is a non-literal expression; can't verify statically
  WRONGTIER: 'UC006', // pinned model disagrees with the work the prompt describes
  OVEREFFORT: 'UC007', // effort exceeds the model's cap (or the work's complexity)
  ALWAYSOPUS: 'UC008' // a policy.alwaysOpus role is pinned to a non-default tier
};

const CLOSERS = new Set([')', ']', '}']);
const isPunct = (t, v) => t && t.type === TT.PUNCT && (v === undefined || t.value === v);

// Every real `agent` call site: a NAME 'agent' that is not a member access
// (`obj.agent`) and is immediately called — directly or through optional chaining
// (`agent?.(`). Yields { nameIdx, openIdx } where openIdx is the '(' token.
function* agentCalls(tokens) {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== TT.NAME || t.value !== 'agent') continue;
    const before = tokens[k - 1];
    if (isPunct(before, '.') || isPunct(before, '?.')) continue; // member access
    let p = k + 1;
    if (isPunct(tokens[p], '?.')) p++;
    if (!isPunct(tokens[p], '(')) continue;
    yield { nameIdx: k, openIdx: p };
  }
}

// From the call's '(' token, split the argument list into per-argument token arrays
// (top-level commas only) and return the index of the matching ')'.
function readArgs(tokens, openIdx) {
  const args = [];
  let cur = [];
  let depth = 0;
  for (let j = openIdx; j < tokens.length; j++) {
    const t = tokens[j];
    if (isPunct(t, '(') || isPunct(t, '[') || isPunct(t, '{')) {
      depth++;
      if (depth > 1) cur.push(t);
    } else if (t.type === TT.PUNCT && CLOSERS.has(t.value)) {
      depth--;
      if (depth === 0) { if (cur.length) args.push(cur); return { args, closeIdx: j }; }
      cur.push(t);
    } else if (isPunct(t, ',') && depth === 1) {
      args.push(cur); cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) args.push(cur);
  return { args, closeIdx: tokens.length - 1 };
}

// The literal text of a (possibly concatenated) prompt argument, or null if it has
// no string/template-literal part (a fully dynamic prompt).
function literalText(argTokens) {
  if (!argTokens) return null;
  let text = '';
  let found = false;
  for (const t of argTokens) {
    if (t.type === TT.STRING || (t.type === TT.TEMPLATE && t.value !== null)) {
      text += (found ? ' ' : '') + t.value;
      found = true;
    }
  }
  return found ? text : null;
}

function classifyValue(valTokens) {
  if (valTokens.length === 1) {
    const v = valTokens[0];
    if (v.type === TT.STRING) return { kind: 'literal', value: v.value };
    if (v.type === TT.TEMPLATE && v.value !== null) return { kind: 'literal', value: v.value };
  }
  return { kind: 'dynamic' };
}

// Parse the options argument: is it an object literal, does it spread, and what are
// the model/effort property values (literal vs dynamic)?
function parseOptions(argTokens) {
  if (!argTokens || !argTokens.length) return { isObject: false };
  if (!isPunct(argTokens[0], '{')) return { isObject: false, dynamic: true };

  let depth = 0;
  let hasSpread = false;
  const props = {};
  for (let j = 0; j < argTokens.length; j++) {
    const t = argTokens[j];
    if (isPunct(t, '{') || isPunct(t, '[') || isPunct(t, '(')) { depth++; continue; }
    if (t.type === TT.PUNCT && CLOSERS.has(t.value)) { depth--; continue; }
    if (depth !== 1) continue;
    if (isPunct(t, '...')) { hasSpread = true; continue; }
    if (t.type !== TT.NAME && t.type !== TT.STRING) continue;
    const key = t.value;
    if (key !== 'model' && key !== 'effort') continue;
    const colon = argTokens[j + 1];
    if (!isPunct(colon, ':')) { // shorthand { model } -> a variable
      if (!(key in props)) props[key] = { kind: 'dynamic' };
      continue;
    }
    const valTokens = [];
    let d2 = 1;
    let m = j + 2;
    for (; m < argTokens.length; m++) {
      const v = argTokens[m];
      if (isPunct(v, '{') || isPunct(v, '[') || isPunct(v, '(')) { d2++; valTokens.push(v); continue; }
      if (v.type === TT.PUNCT && CLOSERS.has(v.value)) { d2--; if (d2 === 0) break; valTokens.push(v); continue; }
      if (isPunct(v, ',') && d2 === 1) break;
      valTokens.push(v);
    }
    if (!(key in props)) props[key] = classifyValue(valTokens);
    j = m - 1;
  }
  return { isObject: true, hasSpread, model: props.model, effort: props.effort };
}

function snippetAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end).trim();
}

const FANOUT_CALLEE = /(?:^|\.)(?:map|flatMap|forEach)$/;
const isFanoutCallee = (name) =>
  FANOUT_CALLEE.test(name) || name === 'Array.from' || name === 'pipeline' || name === 'Promise.all';

// The member chain (e.g. "files.map", "Promise.all") that owns the '(' at openIdx, or null.
function calleeBefore(tokens, openIdx) {
  let j = openIdx - 1;
  if (j < 0 || tokens[j].type !== TT.NAME) return null;
  const parts = [tokens[j].value];
  j--;
  while (j - 1 >= 0 && isPunct(tokens[j]) && (tokens[j].value === '.' || tokens[j].value === '?.') && tokens[j - 1].type === TT.NAME) {
    parts.unshift(tokens[j - 1].value);
    j -= 2;
  }
  return parts.join('.');
}

// Names of call expressions whose bracket is still open at uptoIdx.
function enclosingCallees(tokens, uptoIdx) {
  const stack = [];
  for (let i = 0; i < uptoIdx; i++) {
    const t = tokens[i];
    if (isPunct(t, '(')) stack.push(calleeBefore(tokens, i));
    else if (isPunct(t, '[') || isPunct(t, '{')) stack.push(null);
    else if (t.type === TT.PUNCT && CLOSERS.has(t.value)) stack.pop();
  }
  return stack.filter(Boolean);
}

// Token-index ranges that are the body of a for/while loop (each agent() inside one
// runs once per iteration — a fan-out of unknown size).
function loopBodyRanges(tokens) {
  const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== TT.NAME || (t.value !== 'for' && t.value !== 'while')) continue;
    let p = i + 1;
    if (isPunct(tokens[p], '?.')) p++;
    if (tokens[p] && tokens[p].type === TT.NAME && tokens[p].value === 'await') p++; // for await
    if (!isPunct(tokens[p], '(')) continue;
    let depth = 0;
    let q = p;
    for (; q < tokens.length; q++) {
      const v = tokens[q];
      if (isPunct(v, '(') || isPunct(v, '[') || isPunct(v, '{')) depth++;
      else if (v.type === TT.PUNCT && CLOSERS.has(v.value)) { depth--; if (depth === 0) break; }
    }
    const b = q + 1;
    if (isPunct(tokens[b], '{')) {
      let d2 = 0;
      for (let r = b; r < tokens.length; r++) {
        const v = tokens[r];
        if (isPunct(v, '(') || isPunct(v, '[') || isPunct(v, '{')) d2++;
        else if (v.type === TT.PUNCT && CLOSERS.has(v.value)) { d2--; if (d2 === 0) { ranges.push([b, r]); break; } }
      }
    } else {
      for (let r = b; r < tokens.length; r++) {
        if (isPunct(tokens[r], ';') || r === tokens.length - 1) { ranges.push([b, r]); break; }
      }
    }
  }
  return ranges;
}

// Count every real agent() stage and collect the subset that are problems.
export function analyze(text, policy, file = '<text>') {
  const tokens = tokenize(text);
  const loops = loopBodyRanges(tokens);
  const findings = [];
  let stages = 0;

  for (const { nameIdx, openIdx } of agentCalls(tokens)) {
    stages++;
    const start = tokens[nameIdx].start;
    const { line, column } = lineColAt(text, start);
    const base = { file, line, column, snippet: snippetAt(text, start) };
    const { args } = readArgs(tokens, openIdx);
    const o = parseOptions(args[1]);

    if (o.isObject) {
      const model = o.model;
      if (model && model.kind === 'literal') {
        const verdict = classifyModel(model.value, policy);
        if (verdict === 'banned') {
          findings.push({ ...base, code: CODES.BANNED, severity: 'error', model: model.value, message: `stage pins banned model "${model.value}" (policy.neverUse)` });
          continue;
        }
        if (verdict === 'inherit') {
          findings.push({ ...base, code: CODES.INHERIT, severity: 'error', model: model.value, message: `stage uses model: 'inherit' (allowInherit is false)` });
          continue;
        }
      } else if (model && model.kind === 'dynamic') {
        findings.push({ ...base, code: CODES.DYNAMIC, severity: 'warn', message: 'stage model is a dynamic expression — cannot statically verify a valid model is pinned' });
        continue;
      } else if (o.hasSpread) {
        findings.push({ ...base, code: CODES.DYNAMIC, severity: 'warn', message: 'stage options spread a variable and pin no literal model — cannot verify a model is pinned' });
        continue;
      } else {
        findings.push({ ...base, code: CODES.MISSING, severity: 'error', message: 'stage options object has no model — will inherit the session model' });
        continue;
      }
    } else if (o.dynamic) {
      findings.push({ ...base, code: CODES.DYNAMIC, severity: 'warn', message: 'stage options passed as a variable — cannot verify a model is pinned' });
      continue;
    } else {
      findings.push({ ...base, code: CODES.NOOPTS, severity: 'error', message: 'stage has no options object — add { model: ... } so it does not inherit the session model' });
      continue;
    }

    // The model is a valid literal pin: run the semantic (advisory) checks.
    const prompt = literalText(args[0]);
    const effort = o.effort && o.effort.kind === 'literal' ? o.effort.value : null;
    for (const f of semanticFindings({ model: o.model.value, effort, prompt }, policy, CODES)) {
      findings.push({ ...base, ...f });
    }
  }
  return { stages, findings };
}

export function scanText(text, policy, file = '<text>') {
  return analyze(text, policy, file).findings;
}

// Per-stage descriptors for cost estimation: pinned model (or null = inherits the
// session model), pinned effort (or null), whether it is a fan-out, and the literal
// prompt text (for calibration / explain).
export function stageList(text) {
  const tokens = tokenize(text);
  const loops = loopBodyRanges(tokens);
  const out = [];
  for (const { nameIdx, openIdx } of agentCalls(tokens)) {
    const { line } = lineColAt(text, tokens[nameIdx].start);
    const { args } = readArgs(tokens, openIdx);
    const o = parseOptions(args[1]);
    let model = null;
    let dynamicModel = false;
    let effort = null;
    if (o.isObject) {
      if (o.model?.kind === 'literal') model = o.model.value;
      else if (o.model?.kind === 'dynamic' || o.hasSpread) dynamicModel = true;
      if (o.effort?.kind === 'literal') effort = o.effort.value;
    } else if (o.dynamic) {
      dynamicModel = true;
    }
    const fanout =
      enclosingCallees(tokens, nameIdx).some(isFanoutCallee) ||
      loops.some(([a, b]) => nameIdx >= a && nameIdx <= b);
    out.push({ line, model, dynamicModel, effort, fanout, prompt: literalText(args[0]) });
  }
  return out;
}

const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts']);

export function collectFiles(target) {
  if (!existsSync(target)) return [];
  // lstat (not stat) so a symlink is reported as a symlink rather than its target —
  // never follow/recurse one (avoids symlink loops blowing the stack, and stops --fix
  // writing through a link to a file outside the scanned tree).
  const st = lstatSync(target);
  if (st.isSymbolicLink()) return [];
  if (st.isFile()) return [target];
  if (!st.isDirectory()) return [];
  const out = [];
  for (const name of readdirSync(target)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(target, name);
    const s = lstatSync(full);
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) out.push(...collectFiles(full));
    else if (SCAN_EXTS.has(extname(full))) out.push(full);
  }
  return out;
}

// **/workflows/scripts/*.js under base — the ultracode script layout.
export function collectWorkflowScripts(base) {
  return collectFiles(base).filter((f) => {
    const parts = f.split(sep);
    const n = parts.length;
    return n >= 3 && parts[n - 2] === 'scripts' && parts[n - 3] === 'workflows';
  });
}

export function scan(target, policy) {
  const files = collectFiles(target);
  const findings = [];
  for (const f of files) {
    findings.push(...scanText(readFileSync(f, 'utf8'), policy, f));
  }
  return { findings, files };
}

export function auditScripts(base, policy) {
  const files = collectWorkflowScripts(base);
  const totals = { scripts: files.length, stages: 0, pinned: 0, unpinned: 0, banned: 0, inherit: 0, dynamic: 0, wrongTier: 0, overEffort: 0 };
  for (const f of files) {
    const { stages, findings } = analyze(readFileSync(f, 'utf8'), policy, f);
    totals.stages += stages;
    for (const x of findings) {
      if (x.code === CODES.NOOPTS || x.code === CODES.MISSING) totals.unpinned++;
      else if (x.code === CODES.BANNED) totals.banned++;
      else if (x.code === CODES.INHERIT) totals.inherit++;
      else if (x.code === CODES.DYNAMIC) totals.dynamic++;
      else if (x.code === CODES.WRONGTIER || x.code === CODES.ALWAYSOPUS) totals.wrongTier++;
      else if (x.code === CODES.OVEREFFORT) totals.overEffort++;
    }
  }
  // pinned = stages that produced no pin-related finding (semantic warnings don't unpin).
  totals.pinned = totals.stages - totals.unpinned - totals.banned - totals.inherit - totals.dynamic;
  totals.unpinnedRatio = totals.stages ? totals.unpinned / totals.stages : 0;
  return { base, files, totals };
}

// Insert the default model on the unambiguous cases (UC001 no-options, UC002 object
// without a model), back-to-front so earlier edits don't shift later offsets.
export function fixText(text, policy) {
  const model = tierModel(policy.default, policy);
  const tokens = tokenize(text);
  const sites = [];
  for (const { openIdx } of agentCalls(tokens)) {
    const { args, closeIdx } = readArgs(tokens, openIdx);
    const o = parseOptions(args[1]);
    if (o.isObject) {
      const fixable = !o.model && !o.hasSpread; // UC002 only; never touch dynamic/spread/banned
      if (!fixable) continue;
      const brace = args[1].find((t) => isPunct(t, '{'));
      sites.push({ type: 'insert', at: brace.end });
    } else if (!o.dynamic) {
      sites.push({ type: 'append', at: tokens[closeIdx].start });
    }
  }
  let out = text;
  let count = 0;
  for (const s of sites.sort((a, b) => b.at - a.at)) {
    if (s.type === 'insert') out = out.slice(0, s.at) + ` model: '${model}',` + out.slice(s.at);
    else out = out.slice(0, s.at) + `, { model: '${model}' }` + out.slice(s.at);
    count++;
  }
  return { text: out, count };
}

export function fixFile(file, policy) {
  const { text, count } = fixText(readFileSync(file, 'utf8'), policy);
  if (count) writeFileSync(file, text);
  return count;
}
