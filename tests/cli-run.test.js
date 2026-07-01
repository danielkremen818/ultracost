// In-process tests for the CLI logic (src/cli.js run()). The bin shim is exercised by
// tests/cli.test.js (spawn); here we import run() directly so every command handler,
// flag, and error/usage branch is covered without spawning. Sandbox CLAUDE_CONFIG_DIR
// so init/uninstall/pricing/transcripts never touch the real ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SB = mkdtempSync(join(tmpdir(), 'uc-cli-'));
process.env.CLAUDE_CONFIG_DIR = SB;
process.env.NO_COLOR = '1';
delete process.env.ULTRACOST_GATE;

const { run, CliExit } = await import('../src/cli.js');

// Capture everything the CLI logs (it all flows through console.log via src/log.js).
async function cap(args, opts) {
  const orig = console.log;
  let out = '';
  console.log = (m = '') => { out += m + '\n'; };
  let code;
  try { code = await run(args, opts); } finally { console.log = orig; }
  return { code, out };
}

function fresh() {
  rmSync(SB, { recursive: true, force: true });
  mkdirSync(SB, { recursive: true });
}

const asst = (id, req, out, model = 'claude-opus-4-8') => JSON.stringify({
  type: 'assistant', requestId: req, isSidechain: false, timestamp: '2026-06-14T10:00:00Z',
  message: { role: 'assistant', id, model, usage: { input_tokens: 100, output_tokens: out } }
});

function makeWfRun(sid = 's1', wfId = 'wf_demo') {
  const wf = join(SB, 'projects', 'proj', sid, 'subagents', 'workflows', wfId);
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'agent-aaa.jsonl'), asst('msg_a', 'rA', 200, 'claude-sonnet-4-6') + '\n');
  writeFileSync(join(wf, 'agent-bbb.jsonl'), asst('msg_b', 'rB', 300, 'claude-opus-4-8') + '\n');
  writeFileSync(join(wf, 'journal.jsonl'),
    [JSON.stringify({ key: 'v2:h1', agentId: 'aaa' }), JSON.stringify({ key: 'v2:h2', agentId: 'bbb' })].join('\n') + '\n');
}

function makeUsageData() {
  const proj = join(SB, 'projects', 'proj');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'sess1.jsonl'), asst('m1', 'r1', 50, 'claude-opus-4-8') + '\n');
  writeFileSync(join(proj, 'sess2.jsonl'), asst('m3', 'r3', 30, 'claude-haiku-4-5') + '\n');
  const sub = join(proj, 'sessX', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-z.jsonl'), asst('m2', 'r2', 80, 'claude-sonnet-4-6') + '\n');
  makeWfRun('s1', 'wf_demo');
}

// A plugin-delivered config: enabledPlugins + a cached hooks.json with both hooks.
function makePlugin({ version = '0.3.0', enabled = true } = {}) {
  if (enabled) writeFileSync(join(SB, 'settings.json'), JSON.stringify({ enabledPlugins: { 'ultracost@ultracost': true } }));
  const cache = join(SB, 'plugins', 'cache', 'ultracost', 'ultracost', version, 'hooks');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{}], PreToolUse: [{}] } }));
}

// ---- workflow script fixtures (live outside the sandbox) ----
const FIX = mkdtempSync(join(tmpdir(), 'uc-fix-'));
const goodScript = join(FIX, 'good.js');
writeFileSync(goodScript, "export default async ({ agent }) => { await agent('plan the refactor', { model: 'opus', effort: 'xhigh' }); return agent('list files', { model: 'sonnet', effort: 'low' }); };");
const badScript = join(FIX, 'bad.js');
writeFileSync(badScript, "export default async ({ agent }) => { await agent('do thing'); return agent('x', { model: 'haiku' }); };");
const warnScript = join(FIX, 'warn.js');
// pinned but wrong-tier (UC006 warning, no error): a 'design/architect' prompt pinned to sonnet
writeFileSync(warnScript, "export default async ({ agent }) => agent('design and architect the whole system carefully', { model: 'sonnet' });");
const allOpusScript = join(FIX, 'allopus.js');
writeFileSync(allOpusScript, "export default async ({ agent }) => agent('plan', { model: 'opus' });");
const fanoutScript = join(FIX, 'fanout.js');
writeFileSync(fanoutScript, "export default async ({ agent }) => files.map((f) => agent('format ' + f, { model: 'sonnet', effort: 'low' }));");

// ---------------------------------------------------------------------------
// help / version / unknown / dispatch aliases
// ---------------------------------------------------------------------------
test('help renders and returns 0', async () => {
  const { code, out } = await cap(['help']);
  assert.equal(code, 0);
  assert.match(out, /ultracost/);
  assert.match(out, /Routing & guard/);
  assert.match(out, /Cost/);
  const dash = await cap(['-h']);
  assert.equal(dash.code, 0);
  const long = await cap(['--help']);
  assert.equal(long.code, 0);
  const none = await cap([]); // default cmd = help
  assert.match(none.out, /ultracost/);
});

test('version (all aliases)', async () => {
  for (const a of ['version', '-v', '--version']) {
    const { code, out } = await cap([a]);
    assert.equal(code, 0);
    assert.match(out, /\d+\.\d+\.\d+/);
  }
});

test('unknown command prints error + help and returns 1', async () => {
  const { code, out } = await cap(['frobnicate']);
  assert.equal(code, 1);
  assert.match(out, /Unknown command: frobnicate/);
  assert.match(out, /Routing & guard/);
});

test('run() returns 1 and reports the message on a thrown (non-exit) error', async () => {
  const { code, out } = await cap(['check', '\u0000bad']); // safePath rejects NUL
  assert.equal(code, 1);
  assert.match(out, /invalid path argument/);
});

test('npx invocation switches the SELF hint prefix', async () => {
  const { code, out } = await cap(['estimate'], { argv1: '/x/_npx/abcd/node_modules/.bin/cli.js' });
  assert.equal(code, 1);
  assert.match(out, /npx ultracost estimate/);
});

// ---------------------------------------------------------------------------
// check / guard
// ---------------------------------------------------------------------------
test('check: clean file → exit 0, "every agent() stage pins a model"', async () => {
  const { code, out } = await cap(['check', goodScript]);
  assert.equal(code, 0);
  assert.match(out, /every agent\(\) stage pins a model/);
});

test('check: errors → grouped findings + exit 1', async () => {
  const { code, out } = await cap(['check', badScript]);
  assert.equal(code, 1);
  assert.match(out, /UC001|UC002/);
  assert.match(out, /UC003/);
  assert.match(out, /error/);
  assert.match(out, /--fix/);
});

test('check: warnings only → exit 0 (no error path)', async () => {
  const { code, out } = await cap(['check', warnScript]);
  assert.equal(code, 0);
  assert.match(out, /UC006/);
  assert.match(out, /warning/);
});

test('check --quiet suppresses the snippet line', async () => {
  const { code, out } = await cap(['check', '--quiet', badScript]);
  assert.equal(code, 1);
  assert.ok(!/do thing/.test(out), 'snippet should be hidden under --quiet');
});

test('check --json: errors → exit 1, clean → exit 0', async () => {
  const bad = await cap(['check', '--json', badScript]);
  assert.equal(bad.code, 1);
  const parsed = JSON.parse(bad.out);
  assert.ok(parsed.findings.length > 0);
  const clean = await cap(['check', '--json', goodScript]);
  assert.equal(clean.code, 0);
});

test('check --fix applies fixes and reports a count', async () => {
  const f = join(FIX, 'fixme.js');
  writeFileSync(f, "export default async ({ agent }) => agent('do work');");
  const { code, out } = await cap(['check', '--fix', f]);
  assert.equal(code, 0);
  assert.match(out, /applied \d+ fix/);
});

test('check with no path uses the injected cwd', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-cwd-'));
  writeFileSync(join(dir, 'wf.js'), "export default async ({ agent }) => agent('plan', { model: 'opus' });");
  const { code, out } = await cap(['check'], { cwd: dir });
  assert.equal(code, 0);
  assert.match(out, /pins a model/);
});

// ---------------------------------------------------------------------------
// estimate
// ---------------------------------------------------------------------------
test('estimate: missing arg → usage + exit 1', async () => {
  const { code, out } = await cap(['estimate']);
  assert.equal(code, 1);
  assert.match(out, /usage: ultracost estimate/);
});

test('estimate: non-existent file → exit 1', async () => {
  const { code, out } = await cap(['estimate', join(FIX, 'nope.js')]);
  assert.equal(code, 1);
  assert.match(out, /not found/);
});

test('estimate: fan-out script → human output with fan-out math', async () => {
  fresh();
  const { code, out } = await cap(['estimate', fanoutScript]);
  assert.equal(code, 0);
  assert.match(out, /fan-out/);
  assert.match(out, /savings/);
});

test('estimate --json includes calibrated flag', async () => {
  fresh();
  const { code, out } = await cap(['estimate', '--json', goodScript]);
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.equal(j.calibrated, false);
  assert.ok(j.cost);
});

test('estimate: all-opus script → 0% savings tip', async () => {
  fresh();
  const { code, out } = await cap(['estimate', allOpusScript]);
  assert.equal(code, 0);
  assert.match(out, /tip:/);
});

test('estimate: uses the calibration prior when present', async () => {
  fresh();
  mkdirSync(join(SB, 'ultracost'), { recursive: true });
  writeFileSync(join(SB, 'ultracost', 'calibration.json'),
    JSON.stringify({ tokensPerStage: { input: 1000, output: 500 }, samples: 7 }));
  const { code, out } = await cap(['estimate', goodScript]);
  assert.equal(code, 0);
  assert.match(out, /calibrated from your real runs/);
});

// ---------------------------------------------------------------------------
// explain / simulate / diff
// ---------------------------------------------------------------------------
test('explain: missing arg & missing file → exit 1', async () => {
  assert.equal((await cap(['explain'])).code, 1);
  assert.equal((await cap(['explain', join(FIX, 'nope.js')])).code, 1);
});

test('explain: per-stage table + flags', async () => {
  fresh();
  const { code, out } = await cap(['explain', warnScript]);
  assert.equal(code, 0);
  assert.match(out, /reads-like/);
  assert.match(out, /UC006/);
});

test('explain --json', async () => {
  const { code, out } = await cap(['explain', '--json', goodScript]);
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.ok(Array.isArray(j.stages));
});

test('simulate: missing arg & missing file → exit 1', async () => {
  assert.equal((await cap(['simulate'])).code, 1);
  assert.equal((await cap(['simulate', join(FIX, 'nope.js')])).code, 1);
});

test('simulate: three scenarios + --json', async () => {
  fresh();
  const human = await cap(['simulate', goodScript]);
  assert.equal(human.code, 0);
  assert.match(human.out, /all-opus/);
  assert.match(human.out, /all-sonnet/);
  const j = await cap(['simulate', '--json', goodScript]);
  assert.ok(JSON.parse(j.out).allOpus >= 0);
});

test('diff: missing args & missing files → exit 1', async () => {
  assert.equal((await cap(['diff'])).code, 1);
  assert.equal((await cap(['diff', goodScript])).code, 1);
  assert.equal((await cap(['diff', join(FIX, 'no1.js'), join(FIX, 'no2.js')])).code, 1);
});

test('diff: human (cost up = red), --ci table, --json', async () => {
  fresh();
  // a (cheap, 1 sonnet stage) vs b (expensive, 2 opus stages) → cost up
  const human = await cap(['diff', fanoutScript, allOpusScript]);
  assert.equal(human.code, 0);
  assert.match(human.out, /Δ/);
  const ci = await cap(['diff', goodScript, allOpusScript, '--ci']);
  assert.match(ci.out, /## ultracost cost diff/);
  assert.match(ci.out, /Δ tiered cost/);
  const j = await cap(['diff', '--json', goodScript, allOpusScript]);
  assert.ok(JSON.parse(j.out).old);
});

test('diff: cost down renders the green delta path', async () => {
  fresh();
  const down = await cap(['diff', allOpusScript, fanoutScript]);
  assert.equal(down.code, 0);
  assert.match(down.out, /Δ/);
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------
test('audit: empty projects dir → "no workflow scripts found"', async () => {
  fresh();
  const { code, out } = await cap(['audit']);
  assert.equal(code, 0);
  assert.match(out, /no workflow scripts found/);
});

test('audit: populated → totals table + bars, and --json', async () => {
  fresh();
  const scripts = join(SB, 'projects', 'proj', 'workflows', 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'wf.js'),
    "export default async ({ agent }) => { await agent('plan', { model: 'opus' }); return agent('list'); };");
  const human = await cap(['audit']);
  assert.equal(human.code, 0);
  assert.match(human.out, /agent\(\) stages/);
  assert.match(human.out, /pinned/);
  const j = await cap(['audit', '--json']);
  assert.ok(JSON.parse(j.out).stages >= 1);
});

test('audit: explicit dir argument', async () => {
  fresh();
  const { code, out } = await cap(['audit', join(SB, 'projects')]);
  assert.equal(code, 0);
  assert.match(out, /no workflow scripts found|agent\(\) stages/);
});

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------
test('usage: empty → warn', async () => {
  fresh();
  const { code, out } = await cap(['usage']);
  assert.equal(code, 0);
  assert.match(out, /no transcripts found/);
});

test('usage: populated → cost panel + by-kind + by-model, and --json', async () => {
  fresh();
  makeUsageData();
  const human = await cap(['usage']);
  assert.equal(human.code, 0);
  assert.match(human.out, /total cost/);
  assert.match(human.out, /main/);
  const j = await cap(['usage', '--json']);
  assert.ok(JSON.parse(j.out).records >= 1);
});

test('usage: explicit projects dir argument', async () => {
  fresh();
  makeUsageData();
  const { code, out } = await cap(['usage', join(SB, 'projects')]);
  assert.equal(code, 0);
  assert.match(out, /total cost/);
});

// ---------------------------------------------------------------------------
// reconcile / calibrate / ledger
// ---------------------------------------------------------------------------
test('reconcile: no runs → warn', async () => {
  fresh();
  const { code, out } = await cap(['reconcile']);
  assert.equal(code, 0);
  assert.match(out, /no dynamic-workflow runs/);
});

test('reconcile: --last, default, id match, --json', async () => {
  fresh();
  makeWfRun();
  const last = await cap(['reconcile', '--last']);
  assert.equal(last.code, 0);
  assert.match(last.out, /reconcile/);
  assert.match(last.out, /saved/);
  const def = await cap(['reconcile']);
  assert.equal(def.code, 0);
  const byId = await cap(['reconcile', 'wf_demo']);
  assert.equal(byId.code, 0);
  const j = await cap(['reconcile', '--json']);
  assert.ok(JSON.parse(j.out).totals);
});

test('reconcile: id with no match → exit 1', async () => {
  fresh();
  makeWfRun();
  const { code, out } = await cap(['reconcile', 'wf_nomatch']);
  assert.equal(code, 1);
  assert.match(out, /no workflow run matching/);
});

test('calibrate: not enough data → warn', async () => {
  fresh();
  const { code, out } = await cap(['calibrate']);
  assert.equal(code, 0);
  assert.match(out, /not enough real workflow-stage data/);
});

test('calibrate: writes a prior (human + --json)', async () => {
  fresh();
  makeWfRun();
  const human = await cap(['calibrate']);
  assert.equal(human.code, 0);
  assert.match(human.out, /calibrated token prior/);
  assert.ok(existsSync(join(SB, 'ultracost', 'calibration.json')));
  const j = await cap(['calibrate', '--json']);
  assert.ok(JSON.parse(j.out).tokensPerStage);
});

test('ledger: no runs → warn', async () => {
  fresh();
  const { code, out } = await cap(['ledger']);
  assert.equal(code, 0);
  assert.match(out, /no recorded workflow runs/);
});

test('ledger / savings alias: populated → savings panel + sparkline + --json', async () => {
  fresh();
  makeWfRun();
  const human = await cap(['ledger']);
  assert.equal(human.code, 0);
  assert.match(human.out, /savings ledger/);
  const alias = await cap(['savings']);
  assert.equal(alias.code, 0);
  const j = await cap(['ledger', '--json']);
  assert.ok(Array.isArray(JSON.parse(j.out).entries));
});

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------
test('pricing: show the current table (with source line)', async () => {
  fresh();
  const { code, out } = await cap(['pricing']);
  assert.equal(code, 0);
  assert.match(out, /ultracost pricing/);
  assert.match(out, /opus/);
});

test('pricing refresh: parses an injected page and writes the policy', async () => {
  fresh();
  await cap(['init']); // creates POLICY_PATH so writePricingToPolicy can persist
  const page = [
    '| Claude Opus 4.8 | $5 | $6.25 | $0.50 | $25 |',
    '| Claude Sonnet 4.6 | $3 | $3.75 | $0.30 | $15 |',
    '| Claude Haiku 4.5 | $1 | $1.25 | $0.10 | $5 |'
  ].join('\n');
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => page });
  try {
    const noUrl = await cap(['pricing', 'refresh']);
    assert.equal(noUrl.code, 0);
    assert.match(noUrl.out, /pricing updated/);
    const withUrl = await cap(['pricing', 'refresh', '--url', 'https://example.test/p.md']);
    assert.equal(withUrl.code, 0);
    assert.match(withUrl.out, /as of/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
test('status: none verdict', async () => {
  fresh();
  const { code, out } = await cap(['status']);
  assert.equal(code, 0);
  assert.match(out, /delivery · none/);
  assert.match(out, /not active/);
});

test('status: cli verdict (after init)', async () => {
  fresh();
  await cap(['init']);
  const { code, out } = await cap(['status']);
  assert.equal(code, 0);
  assert.match(out, /delivery · cli/);
});

test('status: plugin verdict', async () => {
  fresh();
  makePlugin();
  const { code, out } = await cap(['status']);
  assert.equal(code, 0);
  assert.match(out, /delivery · plugin/);
});

test('status: both verdict warns about dual delivery', async () => {
  fresh();
  makePlugin();
  await cap(['init', '--force']);
  const { code, out } = await cap(['status']);
  assert.equal(code, 0);
  assert.match(out, /delivery · both/);
  assert.match(out, /dual delivery/);
});

test('status: bypass mode + ULTRACOST_GATE env surface caveats', async () => {
  fresh();
  writeFileSync(join(SB, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  process.env.ULTRACOST_GATE = 'ask';
  try {
    const { code, out } = await cap(['status']);
    assert.equal(code, 0);
    assert.match(out, /permission mode is bypassPermissions/);
    assert.match(out, /ULTRACOST_GATE=ask/);
  } finally {
    delete process.env.ULTRACOST_GATE;
  }
});

test('status: invalid settings.json surfaces the error line', async () => {
  fresh();
  writeFileSync(join(SB, 'settings.json'), '{ not valid json');
  const { code, out } = await cap(['status']);
  assert.equal(code, 0);
  assert.match(out, /invalid JSON/);
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
test('doctor: none verdict → issues + exit 1', async () => {
  fresh();
  const { code, out } = await cap(['doctor']);
  assert.equal(code, 1);
  assert.match(out, /not active/);
  assert.match(out, /issue/);
});

test('doctor: cli verdict (after init) → all clear, exit 0', async () => {
  fresh();
  await cap(['init']);
  const { code, out } = await cap(['doctor']);
  assert.equal(code, 0);
  assert.match(out, /all clear/);
});

test('doctor: plugin verdict checks plugin hooks', async () => {
  fresh();
  makePlugin();
  const { code, out } = await cap(['doctor']);
  assert.equal(code, 0);
  assert.match(out, /plugin SessionStart/);
  assert.match(out, /plugin PreToolUse/);
});

test('doctor: both verdict → dual delivery issue', async () => {
  fresh();
  makePlugin();
  await cap(['init', '--force']);
  const { code, out } = await cap(['doctor']);
  assert.equal(code, 1);
  assert.match(out, /dual delivery/);
});

test('doctor: invalid policy + invalid settings + bypass note', async () => {
  fresh();
  mkdirSync(join(SB, 'ultracost'), { recursive: true });
  writeFileSync(join(SB, 'ultracost', 'policy.json'), '{ broken json');
  writeFileSync(join(SB, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'dontAsk' } }));
  // make settings.local.json invalid to trip settingsInvalid too
  writeFileSync(join(SB, 'settings.local.json'), '{ nope');
  const { code, out } = await cap(['doctor']);
  assert.equal(code, 1);
  assert.match(out, /policy invalid/);
  assert.match(out, /invalid JSON/);
  assert.match(out, /mode auto-approves/);
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
test('init: clean dir installs CLI path (register created)', async () => {
  fresh();
  const { code, out } = await cap(['init']);
  assert.equal(code, 0);
  assert.match(out, /ultracost init/);
  assert.ok(existsSync(join(SB, 'CLAUDE.md')));
  assert.match(out, /hook created/);
});

test('init: second run is idempotent (policy kept, rules updated, hook present)', async () => {
  fresh();
  await cap(['init']);
  const { code, out } = await cap(['init']);
  assert.equal(code, 0);
  assert.match(out, /kept/);
  assert.match(out, /present/);
});

test('init: settings present (valid, no hook) → register registered', async () => {
  fresh();
  writeFileSync(join(SB, 'settings.json'), JSON.stringify({ some: 'thing' }));
  const { code, out } = await cap(['init']);
  assert.equal(code, 0);
  assert.match(out, /hook registered/);
});

test('init: invalid settings.json → manual-register warning', async () => {
  fresh();
  writeFileSync(join(SB, 'settings.json'), '{ invalid');
  const { code, out } = await cap(['init']);
  assert.equal(code, 0);
  assert.match(out, /register the hook manually/);
});

test('init: plugin active (no --force) → skipped, no CLAUDE.md written', async () => {
  fresh();
  makePlugin({ version: '0.3.0' });
  const { code, out } = await cap(['init']);
  assert.equal(code, 0);
  assert.match(out, /init skipped|already delivered/);
  assert.ok(!existsSync(join(SB, 'CLAUDE.md')));
});

test('init --force with plugin active → installs + dual delivery warning', async () => {
  fresh();
  makePlugin();
  const { code, out } = await cap(['init', '--force']);
  assert.equal(code, 0);
  assert.match(out, /dual delivery/);
  assert.ok(existsSync(join(SB, 'CLAUDE.md')));
});

test('install alias maps to init', async () => {
  fresh();
  const { code, out } = await cap(['install']);
  assert.equal(code, 0);
  assert.match(out, /ultracost init/);
});

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------
test('uninstall: reverses an init', async () => {
  fresh();
  await cap(['init']);
  const { code, out } = await cap(['uninstall']);
  assert.equal(code, 0);
  assert.match(out, /ultracost uninstall/);
  assert.match(out, /done/);
});

test('uninstall: plugin still installed → note', async () => {
  fresh();
  makePlugin();
  const { code, out } = await cap(['uninstall']);
  assert.equal(code, 0);
  assert.match(out, /plugin is still installed/);
});

test('CliExit carries the exit code', () => {
  const e = new CliExit(3);
  assert.equal(e.code, 3);
  assert.ok(e instanceof Error);
});
