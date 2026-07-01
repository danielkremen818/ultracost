import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep, basename } from 'node:path';
import { homedir } from 'node:os';
import { sumUsage } from './cost.js';

// Read Claude Code's local session transcripts (offline) so ultracost can reconcile
// its estimate against real token usage and learn from it. Clean-room reimplementation
// of the well-known parse+dedup contract: assistant lines carry message.usage; the
// same message can recur across files (resumed sessions, sidechain replays) so we dedup
// on message.id + requestId; dynamic-workflow agent() stages live in their own
// subagents/workflows/wf_<id>/agent-<aid>.jsonl files next to a journal.jsonl.

const expandTilde = (p) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);

// All Claude Code `projects/` directories: CLAUDE_CONFIG_DIR (comma-separated, each
// entry a config dir OR a projects dir), else ~/.config/claude and ~/.claude.
export function projectsDirs(env = process.env) {
  const out = [];
  const add = (dir) => {
    if (existsSync(join(dir, 'projects'))) out.push(join(dir, 'projects'));
    else if (basename(dir) === 'projects' && existsSync(dir)) out.push(dir);
  };
  if (env.CLAUDE_CONFIG_DIR) {
    env.CLAUDE_CONFIG_DIR.split(',').map((s) => s.trim()).filter(Boolean).forEach((p) => add(expandTilde(p)));
  } else {
    add(env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'claude') : join(homedir(), '.config', 'claude'));
    add(join(homedir(), '.claude'));
  }
  return [...new Set(out)];
}

function walk(dir, test, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

// One transcript line -> a normalized usage record, or null if it isn't an assistant
// message that reports usage.
export function parseUsageLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || obj.isApiErrorMessage) return null;
  const m = obj.message;
  if (!m || !m.usage) return null;
  if (m.role && m.role !== 'assistant' && obj.type !== 'assistant') return null;
  return {
    id: m.id || null,
    requestId: obj.requestId || null,
    model: m.model || null,
    usage: m.usage,
    ts: obj.timestamp || null,
    isSidechain: !!obj.isSidechain
  };
}

function readUsage(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const e = parseUsageLine(line);
    if (e) out.push(e);
  }
  return out;
}

// Dedup on message.id + requestId; lines without an id are always kept; on a collision
// keep the copy with the most output tokens (a sidechain/replay tie-break).
export function dedupe(entries) {
  const seen = new Map();
  const kept = [];
  for (const e of entries) {
    if (!e.id) { kept.push(e); continue; }
    const key = `${e.id}:${e.requestId || ''}`;
    const idx = seen.get(key);
    if (idx === undefined) { seen.set(key, kept.length); kept.push(e); }
    else if ((e.usage.output_tokens || 0) > (kept[idx].usage.output_tokens || 0)) kept[idx] = e;
  }
  return kept;
}

// Classify a transcript file by its path: 'main', 'subagent', or 'workflow-stage'
// (the ultracode dynamic-workflow agent() stage). Separation is by PATH, never by
// sessionId (subagent files inherit the parent's sessionId).
export function classifyTranscriptFile(file, projectsDir) {
  const rel = projectsDir && file.startsWith(projectsDir) ? file.slice(projectsDir.length + 1) : file;
  const parts = rel.split(sep);
  const project = parts[0];
  const sub = parts.indexOf('subagents');
  if (sub !== -1) {
    const parentSessionId = parts[sub - 1];
    const agentId = basename(file, '.jsonl').replace(/^agent-/, '');
    if (parts[sub + 1] === 'workflows' && (parts[sub + 2] || '').startsWith('wf_')) {
      return { kind: 'workflow-stage', project, parentSessionId, wfId: parts[sub + 2], agentId, file };
    }
    return { kind: 'subagent', project, parentSessionId, agentId, file };
  }
  return { kind: 'main', project, sessionId: basename(file, '.jsonl'), file };
}

// All usage records across every transcript, classified and globally deduped.
export function readTranscripts({ env = process.env, root = null } = {}) {
  const dirs = root ? [root] : projectsDirs(env);
  const all = [];
  for (const dir of dirs) {
    for (const file of walk(dir, (f) => f.endsWith('.jsonl'))) {
      const cls = classifyTranscriptFile(file, dir);
      for (const e of readUsage(file)) all.push({ ...e, ...cls });
    }
  }
  return dedupe(all);
}

function readJournal(file) {
  const map = {};
  if (!existsSync(file)) return map;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return map; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j && j.agentId && (j.key || !(j.agentId in map))) map[j.agentId] = j.key || map[j.agentId] || null;
  }
  return map;
}

// Cheap: locate every dynamic-workflow run directory and its mtime WITHOUT reading any
// stage jsonl. This is the fast-path signature the Stop autorun hook uses to skip the
// expensive per-stage parse on the vast majority of turns (when no new run appeared).
export function workflowRunDirs({ env = process.env, root = null } = {}) {
  const dirs = root ? [root] : projectsDirs(env);
  const found = [];
  for (const dir of dirs) {
    const wfDirs = new Set();
    walk(dir, (f) => {
      const p = f.split(sep);
      const sub = p.indexOf('subagents');
      if (sub !== -1 && p[sub + 1] === 'workflows' && (p[sub + 2] || '').startsWith('wf_')) {
        wfDirs.add(p.slice(0, sub + 3).join(sep));
      }
      return false;
    });
    for (const wfDir of wfDirs) {
      let mtime = 0;
      try { mtime = statSync(wfDir).mtimeMs; } catch { /* ignore */ }
      found.push({ wfId: basename(wfDir), dir: wfDir, mtime });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

// Every dynamic-workflow run on disk, newest first, with per-stage token sums. This is
// what `reconcile` / the savings ledger compare against the estimate.
export function locateWorkflowRuns(opts = {}) {
  const runs = [];
  for (const { wfId, dir: wfDir, mtime } of workflowRunDirs(opts)) {
    let names;
    try { names = readdirSync(wfDir); } catch { continue; }
    const journal = readJournal(join(wfDir, 'journal.jsonl'));
    const stages = names
      .filter((f) => /^agent-.*\.jsonl$/.test(f))
      .map((f) => {
        const agentId = f.slice('agent-'.length, -'.jsonl'.length);
        const entries = dedupe(readUsage(join(wfDir, f)));
        return {
          agentId,
          stageKey: journal[agentId] || null,
          model: entries.length ? entries[entries.length - 1].model : null,
          usage: sumUsage(entries.map((e) => e.usage)),
          lines: entries.length
        };
      })
      .filter((s) => s.lines > 0);
    if (!stages.length) continue;
    const parts = wfDir.split(sep);
    runs.push({
      wfId,
      dir: wfDir,
      project: parts[parts.indexOf('projects') + 1],
      parentSessionId: parts[parts.indexOf('subagents') - 1],
      stages,
      mtime
    });
  }
  return runs.sort((a, b) => b.mtime - a.mtime);
}
