import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tierOfModel } from './classify.js';

// Live running-subagent parser scoped to ONE session (the statusline's stdin
// transcript_path). Deliberately does NOT call readTranscripts()/locateWorkflowRuns()
// from transcript.js — those walk every project dir on disk and would blow the
// statusline's <300ms budget. We touch only this session's sibling subagents/ dir
// and parse the parent transcript at most once. All fs is try/caught; any failure
// returns [] so the HUD never throws.

// Above this size we skip the (linear) parent-transcript tool_result scan and fall
// back to the age-only running signal — a multi-MB transcript would be too slow to
// read per statusline invocation.
const MAX_PARENT_BYTES = 8 * 1024 * 1024;

// Start timestamp, the model, and the FIRST user prompt (the task), in one pass. Files are
// small (a single stage/subagent), so reading the whole file is fine. The first user prompt
// is the only human-readable signal on disk for a workflow stage — its meta carries no
// description and the journal key is a hash — so we surface it for the label.
function readAgentFile(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  let startTs = null;
  let model = null;
  let firstPrompt = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (startTs === null && obj && obj.timestamp) startTs = Date.parse(obj.timestamp);
    const m = obj && obj.message;
    if (m && m.model && (m.role === 'assistant' || obj.type === 'assistant')) model = m.model;
    if (firstPrompt === null && m && m.role === 'user') {
      const t = promptText(m.content);
      if (t) firstPrompt = t;
    }
  }
  return { startTs, model, firstPrompt };
}

// A user message's content as plain text: a bare string, or the joined text blocks of a
// content array (skipping tool_result/image blocks). Anything else → ''.
function promptText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const parts = [];
    for (const b of content) {
      if (typeof b === 'string') parts.push(b);
      else if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
    return parts.join('\n').trim();
  }
  return '';
}

// Longest common prefix length (in chars) of two strings.
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// Parallel workflow stages typically share a long preamble (e.g. a frozen contract block),
// so labeling them by their first words yields N identical "CONTRACT —" labels. Strip a
// prefix this long only when it's clearly shared boilerplate, not a couple coincidental chars.
const MIN_SHARED_PREFIX = 40;

// Turn a raw prompt (optionally with a shared-preamble prefix stripped) into a short, human
// label. Prefer a leading file/path token's basename (so "services/secrets.ts TASK: …" →
// "secrets.ts"), then a "<verb> <file>" shape (so "Rework …/CustomerReleases.jsx" →
// "Rework CustomerReleases.jsx"), else the first few words. Pure string ops; never throws.
const LABEL_VERB = /^(read|edit|update|rework|refactor|add|write|create|fix|extend|implement|register|delete|remove|audit|wire|migrate|port|build|patch)s?$/i;
function labelFromPrompt(prompt, stripLen = 0) {
  let s = String(prompt || '');
  if (stripLen > 0) s = s.slice(stripLen);
  s = s.replace(/^[\s:–—\-•*>]+/, '');
  const firstLine = s.split('\n').map((l) => l.trim()).find((l) => l.length) || '';
  if (!firstLine) return '';
  const tokens = firstLine.split(/\s+/);
  const isPath = (t) => !!t && (/[\\/]/.test(t) || /\.[a-z0-9]{1,6}$/i.test(t));
  const base = (t) => t.split(/[\\/]/).pop().replace(/[)\].,:;]+$/, '');
  if (isPath(tokens[0])) {
    const b = base(tokens[0]);
    if (b) return clipLabel(b);
  }
  if (LABEL_VERB.test(tokens[0])) {
    const p = tokens.slice(1, 6).find(isPath);
    if (p) return clipLabel(tokens[0] + ' ' + base(p));
  }
  return clipLabel(tokens.slice(0, 4).join(' '));
}

function clipLabel(s) {
  return s.length > 26 ? s.slice(0, 25) + '…' : s;
}

// Parent transcript -> Set of tool_use_ids that have a matching tool_result (i.e. the
// Agent/Task subagent has completed). tool_result blocks live in message.content[] of
// user lines. Returns null when the scan is skipped (huge transcript) so the caller can
// fall back to age-only.
function completedToolUseIds(transcriptPath) {
  let st;
  try { st = statSync(transcriptPath); } catch { return new Set(); }
  if (st.size > MAX_PARENT_BYTES) return null;
  let text;
  try { text = readFileSync(transcriptPath, 'utf8'); } catch { return new Set(); }
  const done = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('tool_result')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const c = obj && obj.message && obj.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === 'tool_result' && b.tool_use_id) done.add(b.tool_use_id);
    }
  }
  return done;
}

// journal.jsonl -> Set of agentIds that have a 'started' but no 'result' record.
function runningStageIds(journalFile) {
  const started = new Set();
  const resulted = new Set();
  let text;
  try { text = readFileSync(journalFile, 'utf8'); } catch { return started; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || !j.agentId) continue;
    if (j.type === 'started') started.add(j.agentId);
    else if (j.type === 'result') resulted.add(j.agentId);
  }
  for (const id of resulted) started.delete(id);
  return started;
}

// Shorten a meta.description to a compact human tag; fall back to the journal stage key
// or the agentType. Stage keys look like 'v2:<hash>' — strip the hash, keep nothing
// useful, so prefer agentType for workflow stages without a description.
function shortLabel(description, stageKey, agentType) {
  if (description) {
    const first = String(description).trim().split(/\s+/).slice(0, 2).join(' ');
    return first.length > 24 ? first.slice(0, 23) + '…' : first;
  }
  if (stageKey && !/^v\d+:/.test(stageKey)) return stageKey;
  return agentType;
}

// Running subagents + workflow stages for the session that owns transcriptPath, newest
// first. Each entry: { agentType, label, model, tier, elapsedMs, status:'running',
// kind:'subagent'|'workflow-stage' }.
export function runningAgents(transcriptPath, { now = Date.now(), maxAgeMs = 120000 } = {}) {
  if (!transcriptPath) return [];
  const subDir = join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents');
  if (!existsSync(subDir)) return [];

  let names;
  try { names = readdirSync(subDir); } catch { return []; }

  const out = [];
  const fresh = (startTs) => startTs !== null && now - startTs < maxAgeMs;

  // Regular Task/Agent subagents: agent-<id>.jsonl + agent-<id>.meta.json directly in
  // subagents/. Running iff its meta.toolUseId has no tool_result in the parent AND it's
  // recent. completed === null means the parent scan was skipped -> age-only.
  const completed = completedToolUseIds(transcriptPath);
  for (const name of names) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const meta = readMeta(join(subDir, name.replace(/\.jsonl$/, '.meta.json')));
    const { startTs, model, firstPrompt } = readAgentFile(join(subDir, name)) || {};
    if (!fresh(startTs)) continue;
    const toolUseId = meta && meta.toolUseId;
    const done = completed && toolUseId && completed.has(toolUseId);
    if (done) continue;
    const agentType = (meta && meta.agentType) || 'subagent';
    out.push({
      agentType,
      label: (meta && meta.description)
        ? shortLabel(meta.description, null, agentType)
        : (firstPrompt ? labelFromPrompt(firstPrompt) : agentType),
      model,
      tier: tierOfModel(model),
      elapsedMs: now - startTs,
      status: 'running',
      kind: 'subagent',
      startTs
    });
  }

  // Workflow agent() stages: subagents/workflows/wf_*/agent-*.jsonl + a shared
  // journal.jsonl. Running iff the journal has a started-without-result for the agentId
  // AND it's recent.
  const wfRoot = join(subDir, 'workflows');
  let wfNames;
  try { wfNames = readdirSync(wfRoot); } catch { wfNames = []; }
  for (const wf of wfNames) {
    if (!wf.startsWith('wf_')) continue;
    const wfDir = join(wfRoot, wf);
    let stageNames;
    try { stageNames = readdirSync(wfDir); } catch { continue; }
    const running = runningStageIds(join(wfDir, 'journal.jsonl'));
    const journal = readStageKeys(join(wfDir, 'journal.jsonl'));

    // Collect the running stages first so labels can be made DISTINCT across the batch. A
    // workflow stage's meta has no description and the journal key is a hash, so the only
    // human signal is each stage's first prompt — and parallel stages often share a long
    // preamble (a frozen contract). We strip the prefix a stage shares with a sibling, then
    // label from what's left (which starts with the per-stage specifics, often the target file).
    const stages = [];
    for (const name of stageNames) {
      if (!/^agent-.*\.jsonl$/.test(name)) continue;
      const agentId = name.slice('agent-'.length, -'.jsonl'.length);
      if (!running.has(agentId)) continue;
      const info = readAgentFile(join(wfDir, name)) || {};
      if (!fresh(info.startTs)) continue;
      const meta = readMeta(join(wfDir, name.replace(/\.jsonl$/, '.meta.json')));
      stages.push({ agentId, meta, startTs: info.startTs, model: info.model, firstPrompt: info.firstPrompt });
    }

    const prompts = stages.map((s) => s.firstPrompt || '');
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const agentType = (s.meta && s.meta.agentType) || 'workflow-subagent';
      let label;
      if (s.meta && s.meta.description) {
        label = shortLabel(s.meta.description, journal[s.agentId], agentType);
      } else if (s.firstPrompt) {
        let strip = 0;
        for (let j = 0; j < prompts.length; j++) {
          if (j === i) continue;
          const c = commonPrefixLen(prompts[i], prompts[j]);
          if (c > strip) strip = c;
        }
        label = labelFromPrompt(s.firstPrompt, strip >= MIN_SHARED_PREFIX ? strip : 0)
          || shortLabel(null, journal[s.agentId], agentType);
      } else {
        label = shortLabel(null, journal[s.agentId], agentType);
      }
      out.push({
        agentType,
        label,
        model: s.model,
        tier: tierOfModel(s.model),
        elapsedMs: now - s.startTs,
        status: 'running',
        kind: 'workflow-stage',
        startTs: s.startTs
      });
    }
  }

  out.sort((a, b) => b.startTs - a.startTs);
  for (const a of out) delete a.startTs; // startTs was only for sorting
  return out;
}

function readMeta(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// journal.jsonl -> { agentId: stageKey } (last key wins), for the label fallback.
function readStageKeys(journalFile) {
  const keys = {};
  let text;
  try { text = readFileSync(journalFile, 'utf8'); } catch { return keys; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j && j.agentId && j.key) keys[j.agentId] = j.key;
  }
  return keys;
}
