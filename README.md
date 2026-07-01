<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/banner.png" alt="ultracost — per-stage model routing for Claude Code dynamic workflows" width="880">

Stop a single `ultracode` fan-out from running dozens of subagents on Opus by accident.

[![npm](https://img.shields.io/npm/v/ultracost.svg)](https://www.npmjs.com/package/ultracost)
[![CI](https://github.com/danielkremen818/ultracost/actions/workflows/ci.yml/badge.svg)](https://github.com/danielkremen818/ultracost/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/danielkremen818/ultracost/branch/main/graph/badge.svg)](https://codecov.io/gh/danielkremen818/ultracost)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/danielkremen818/ultracost/badge)](https://scorecard.dev/viewer/?uri=github.com/danielkremen818/ultracost)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13239/badge)](https://www.bestpractices.dev/projects/13239)
[![Known Vulnerabilities](https://snyk.io/test/npm/ultracost/badge.svg)](https://snyk.io/test/npm/ultracost)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![Cite this repository](https://img.shields.io/badge/Cite-CITATION.cff-1f6feb.svg)](./CITATION.cff)
[![Listed on ClaudePluginHub](https://www.claudepluginhub.com/badge/danielkremen818-ultracost)](https://www.claudepluginhub.com/plugins/danielkremen818-ultracost?ref=badge)

</div>

---

When `ultracode` is on, the session is pinned to **Opus @ `xhigh`** and a single dynamic
workflow fans out to dozens of subagents that **inherit that session model** unless every
stage is pinned. ultracost makes per-stage routing **explicit, policy-driven, and
verifiable** — quality-first, so coding and reasoning stay on Opus while pre-planned
mechanical work drops to Sonnet. No telemetry. No network on the hot path. MIT.

> Built for `ultracode` (Opus @ `xhigh` dynamic workflows) — the only place this fan-out
> happens. ultracost routes by **tier** (`opus`/`sonnet`), not a pinned version, so it
> tracks whatever Opus your session runs.

**Security & trust.** ultracost has **zero runtime and dev dependencies**, so there is no
supply chain to compromise — Snyk Open Source and `npm audit` report **0 vulnerabilities**.
Releases publish to npm with **OIDC Trusted Publishing and signed provenance**, every
GitHub Action is **pinned to a commit SHA**, and **CodeQL + OpenSSF Scorecard** run in CI.
The installer touches only its own files and is fully reversible. See [`SECURITY.md`](./SECURITY.md).

## Install

**Claude Code plugin** (recommended):

```text
/plugin marketplace add danielkremen818/ultracost
/plugin install ultracost@ultracost
```

**npm CLI** (CI / scripting):

```bash
npx ultracost init
```

**Via [ClaudePluginHub](https://www.claudepluginhub.com/plugins/danielkremen818-ultracost?ref=badge)** (one command — adds the marketplace and installs the plugin):

```bash
npx claudepluginhub danielkremen818/ultracost --plugin ultracost
```

First command, in Claude Code: `/ultracost:check ./path/to/workflow.js` — flag any
`agent()` stage that would silently inherit Opus. Every verb is also a slash command, so
plugin users need nothing on `PATH`.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/demo.svg" alt="ultracost estimate on a real workflow (67% under all-opus) and a clean guard check" width="820">

</div>

## The problem

When `ultracode` is on, Claude Code runs the session on **Opus @ xhigh** (the only model that supports `xhigh`) and auto-orchestrates **dynamic workflows** that fan out to dozens — up to 1,000 — subagents. Two defaults compound:

1. **Subagents inherit the session model.** No per-stage override → every stage runs on the session's Opus.
2. **The built-in workflow guidance tells Claude to _omit_ the per-agent model.** So inheritance wins.

The documented result: [one prompt spawning 46 Opus subagents and ~3M tokens with no warning](https://github.com/anthropics/claude-code/issues/66023). A grep sweep and a per-file verifier do not need Opus. ([Why `ultracode` makes this worse →](./docs/ultracode.md))

## The evidence: nobody pins a stage

This is the default behavior, not user error. In a scan of ~22 real `ultracode` workflow scripts, **almost none pinned `model:` on any stage** — even Anthropic's own bundled `deep-research` workflow pins **zero**. Reproduce it on your own history in one command:

```bash
npx ultracost audit ~/.claude/projects
```

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/term-audit.svg" alt="ultracost audit showing a 95% unpinned ratio across workflow scripts" width="720">

</div>

## What ultracost does

- **A quality-first policy.** Coding and reasoning stay on **Opus @ xhigh**; pre-planned mechanical work and search/collection drop to **Sonnet**; **Haiku is never used**. You own it in one JSON file.
- **Always-on routing guidance.** A `SessionStart` hook injects the policy as context at the start of every session (and after compaction) — present when Claude authors a workflow, no reliance on the model opening a skill.
- **The Workflow Guard.** A static analyzer that flags any `agent()` stage missing a `model:` pin. Run it by hand, via `/ultracost:check`, or in CI. **No other tool does this.**
- **A pre-flight cost gate.** A default-on `PreToolUse` hook estimates every workflow launch and pauses (or denies) it before a single subagent runs.
- **A closed loop.** It reads its own runs back from local transcripts to reconcile, calibrate, and tally savings — offline.

## Architecture

One shared core in `src/`, two delivery surfaces (a Claude Code **plugin** and an **npm CLI**), a runtime verification layer (the guard + cost gate), and a closed loop — all compiled from the same `policy.json`.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/architecture.svg" alt="ultracost architecture — policy.json compiles through the src/ core into a plugin and an npm CLI; the guard and a PreToolUse cost gate verify every workflow stage; a closed loop reconciles and calibrates from real transcripts" width="960">

</div>

The plan lives in **data** (`policy.json`), not prose buried in a prompt. The guard is the layer the model can't talk its way out of. Full picture: [`docs/architecture.md`](./docs/architecture.md).

## The Workflow Guard

```bash
ultracost check ./wf.js      # or /ultracost:check in Claude Code
```

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/term-guard.svg" alt="ultracost check catching unpinned, banned, inherit, dynamic, and wrong-tier stages" width="900">

</div>

| Code | Meaning | Severity |
|------|---------|----------|
| `UC001` | `agent(x)` with no options object | error |
| `UC002` | options object present, no `model` | error |
| `UC003` | model resolves to a banned model (e.g. haiku) | error |
| `UC004` | `model: 'inherit'` while `allowInherit` is false | error |
| `UC005` | model/options is a dynamic expression — can't verify | warning |
| `UC006` | the pin mismatches the work the prompt describes | warning |
| `UC007` | `effort` exceeds the model's cap (e.g. `sonnet` @ `xhigh`) | warning |
| `UC008` | an `alwaysOpus` role (orchestrator, …) pins a cheaper tier | warning |

The scanner runs on a hand-rolled, zero-dependency JS tokenizer — robust to template literals, spreads, optional-call `agent?.()`, and dynamic values; an `agent(` inside a prompt or comment is prose, never a call. Fan-out detection covers `.map`/`.flatMap`/`forEach`/`for…of`/`Promise.all`/`Array.from`/`pipeline`. `--json` for CI, `--fix` to auto-pin the unambiguous cases (`UC001`/`UC002`), `--quiet` for problems only. Only `UC001`–`UC004` fail the build.

## Cost estimate, effort, and the pre-flight gate

```bash
ultracost estimate ./wf.js   # agents, model mix, tiered vs all-opus
ultracost simulate ./wf.js   # all-opus vs your tiered pins vs all-sonnet
```

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/term-simulate.svg" alt="ultracost simulate comparing all-opus, tiered, and all-sonnet costs" width="820">

</div>

- **Official-sourced pricing.** Prices live in `policy.json` with a `_source` URL and `_asOf` date; `ultracost pricing refresh` re-fetches Anthropic's official page. The estimate itself runs offline.
- **Dynamic effort.** Each stage gets the lowest effort that fits (`low`→`xhigh`), bounded by model (`sonnet` up to `high`, `opus` up to `xhigh`), and effort feeds the estimate.
- **Pre-flight gate (on by default, hard in every mode).** A deterministic `PreToolUse` hook on the `Workflow` tool runs the guard + estimate and leads with `⚠ N/M stage(s) NOT pinned → will inherit Opus` when stages are unpinned. It **asks** (with the estimate) in `default`/`acceptEdits`/`auto` and **auto-denies** an unpinned or over-budget launch in `bypassPermissions`/`dontAsk`. `ULTRACOST_GATE=strict|ask|off` overrides it.

Estimates are relative (tiered vs all-opus), not a bill; fan-outs are ranges. Full detail and the gate's [#52343](https://github.com/anthropics/claude-code/issues/52343) limitation: [`docs/ESTIMATES.md`](./docs/ESTIMATES.md).

## The closed loop: measure, reconcile, calibrate

ultracost reads its own results back — parsing your **local** transcripts (offline, no telemetry) and attributing tokens **per workflow stage** via the `subagents/workflows/wf_*/agent-*.jsonl` files Claude Code writes. No other router does this.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/term-reconcile.svg" alt="ultracost reconcile — estimate vs actual per stage for a real run" width="720">
<br><br>
<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/term-ledger.svg" alt="ultracost ledger — cumulative savings vs an all-opus baseline" width="620">

</div>

```bash
ultracost usage          # real cost: main loop vs subagents vs workflow stages
ultracost reconcile --last   # estimate vs ACTUAL, per stage, for your latest run
ultracost calibrate      # learn a token prior from your runs (the estimate uses it)
ultracost ledger         # cumulative $ saved vs all-opus, persisted
```

- **Self-calibrating.** `calibrate` learns real per-stage token sizes (outlier-filtered); `estimate`, `explain`, `simulate`, and the gate use it automatically — closer to your reality every run.
- **Automatic on Stop.** A `Stop` hook runs this loop (reconcile + calibrate + ledger) when the session ends, so you never have to remember the commands. It no-ops unless a new workflow finished; disable with `ULTRACOST_AUTORUN=off`.
- **Budget guard.** Set `budget.perRun` / `budget.perDay` and the gate **denies** a launch whose estimate blows the cap, before it runs.

## Live HUD statusline

Turn ultracost into your Claude Code **statusline** — a live, themed HUD that shows session
cost, running subagents, context usage, and an animated pixel logo, refreshed ~once a second.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/hud-statusline.png" alt="ultracost HUD statusline — live session cost, model @ effort, context usage, running subagents, and an animated pixel logo" width="820">

</div>

**It sets itself up automatically.** On the first session after you install the plugin, a
`SessionStart` hook sets ultracost as your `statusLine` — no command to run. It does this
**once** (so if you later remove it, it won't fight you), **backs up any statusline you
already had** (restored on uninstall), and can be turned off with `ULTRACOST_HUD=off`.
`ultracost init` does the same on the CLI path. Drive it directly with:

```text
/ultracost:hud            # or: ultracost hud   (reads the statusline JSON on stdin)
```

It reads Claude Code's statusline payload on stdin and renders offline — no telemetry, no
network. Don't want it? It's removed cleanly by `ultracost uninstall` / `/plugin uninstall`.

## How routing is decided

| Tier | Model | Use for |
|------|-------|---------|
| **opus** | `claude-opus-4-8` @ `xhigh` | writing/refactoring/debugging, design & architecture, security/perf, tests needing judgment, planning, synthesis |
| **sonnet** | `claude-sonnet-4-6` @ `high` | applying a *decided* edit across files, search/grep, running tests, git ops, docs, gathering context |

**Decision rule:** if the stage must *decide how* to change code → opus. If the *how* is already planned and it just executes → sonnet. When in doubt → opus. **Never haiku.** This is opinionated and quality-first; edit the policy for a cost-first split.

## Commands

Every verb is a plugin slash command (`/ultracost:<verb>`, runs the bundled CLI via `${CLAUDE_PLUGIN_ROOT}` — nothing on `PATH`) **and** an npm CLI command.

| Command | What it does |
|---------|--------------|
| `check [path]` | Flag `agent()` stages that don't pin a model (or pin the wrong tier); `--fix` the safe ones. |
| `estimate <script>` | Agent count, model mix, tiered cost vs all-opus. |
| `explain <script>` | Per-stage rationale: model, effort, reads-like tier, est cost, check flags. |
| `simulate <script>` | Cost under all-opus vs tiered vs all-sonnet. |
| `diff <a> <b>` | Cost delta between two versions (`--ci` → PR-comment table). |
| `audit [dir]` | Pin stats across your real workflow scripts. |
| `hud` | Live cost HUD statusline (set as your `statusLine` on install; restores the prior one on uninstall). |
| `usage [dir]` | Real token cost from local transcripts. |
| `reconcile [--last\|<id>]` | Estimate vs **actual** per stage for a finished run. |
| `calibrate` | Tune the estimator from your real token usage. |
| `ledger` | Cumulative savings vs all-opus across recorded runs. |
| `pricing [refresh]` | Show pricing, or refresh from Anthropic's official page. |
| `status` · `doctor` · `init` · `uninstall` | Delivery/policy state, diagnostics, install, reverse it. |

> `init`, `pricing refresh`, `doctor`, and `uninstall` are CLI-only. The plugin bundles the `SessionStart` hook, the `PreToolUse` gate, the routing skill, and the slash commands; nothing in your config is mutated.

## Usage examples

Common workflows, end to end. Inside Claude Code, use the **slash commands** (the plugin
path — nothing on `PATH`); the `ultracost <verb>` CLI equivalents are for shells and CI.

**1. Check a workflow script before you launch it**

```text
/ultracost:check ./deep-audit.workflow.js
```

```text
check · 1 file(s)
✗ UC002  stage "scan repo" has options but no model  (line 12)
✗ UC001  agent("summarize") pins no model            (line 27)
2 error(s) — these stages would inherit the session's Opus @ xhigh
```

`/ultracost:check` proposes the correct per-stage pins and offers to apply them for you.
CLI equivalent: `ultracost check ./deep-audit.workflow.js --fix`.

**2. Estimate cost and compare tiers before launching**

```text
/ultracost:estimate ./deep-audit.workflow.js   # tiered vs all-opus
/ultracost:simulate ./deep-audit.workflow.js   # all-opus vs tiered vs all-sonnet
/ultracost:explain  ./deep-audit.workflow.js   # per-stage rationale + flags
```

**3. Audit every workflow script you've already run**

```text
/ultracost:audit
```

Prints the share of `agent()` stages that pin no model (and would silently inherit Opus).
CLI: `ultracost audit ~/.claude/projects`.

**4. Pin a stage correctly when authoring a workflow**

```javascript
// search/collection → cheap tier, low effort
agent("grep the repo for callers", { model: 'sonnet', effort: 'low' });

// design/refactor decision → opus
agent("redesign the auth module", { model: 'opus', effort: 'xhigh' });
```

**5. Reconcile an estimate against what a run actually cost**

```text
/ultracost:reconcile   # estimate vs ACTUAL per stage, for your latest run
/ultracost:ledger      # cumulative $ saved vs all-opus
```

**6. Gate every launch in CI** (no plugin — CLI only)

```yaml
- run: npx ultracost check . --json
```

## Uninstall

```text
/plugin uninstall ultracost@ultracost     # plugin (removes everything it added)
/plugin marketplace remove ultracost
```

```bash
ultracost uninstall                        # npm CLI (reverses init; invalid settings.json is reported, never overwritten)
```

## Customizing the policy

Edit `~/.claude/ultracost/policy.json`, then re-run `ultracost init` to recompile the rules:

```json
{
  "neverUse": ["haiku"],
  "allowInherit": false,
  "default": "opus",
  "tiers": {
    "opus": { "model": "opus", "effort": "xhigh" },
    "sonnet": { "model": "sonnet", "effort": "high" }
  },
  "alwaysOpus": ["orchestrator", "planner", "final-synthesis"]
}
```

Full reference: [`docs/policy.md`](./docs/policy.md).

## Use in CI

```yaml
- run: npx ultracost check . --json
```

Fails the build if any committed workflow script has a stage that would inherit the session model.

## How it compares

ultracost is intentionally narrow. General-purpose routers ([claude-router](https://github.com/0xrdan/claude-router), [claude-smart-router](https://github.com/gacabartosz/claude-smart-router), [claude-model-changer](https://github.com/R4CK/claude-model-changer), [model-matchmaker](https://github.com/coyvalyss1/model-matchmaker)) score every prompt and route the *main loop*. Linters like [claudelint](https://github.com/pdugan20/claudelint) validate a *file-based* agent's `model:`. ultracost targets the **dynamic-workflow / ultracode** path and is, as far as we can tell, the only tool that **statically detects an unpinned inline `agent()`/`pipeline()` stage, flags a pin that mismatches the prompt, and reconciles its own estimate against real per-stage token usage**. Cost tools ([ccusage](https://github.com/ryoppippi/ccusage), [tokencast](https://github.com/krulewis/tokencast), [tokentoll](https://github.com/Jwrede/tokentoll)) informed the transcript-parsing and calibration approaches (reimplemented clean-room). Credits: [`NOTICE`](./NOTICE).

## Documentation

- [Showcase — a live `ultracode` run](./docs/SHOWCASE.md) — policy injection → guard → cost gate → confirm, end to end, unprompted
- [Architecture](./docs/architecture.md) · [Policy reference](./docs/policy.md) · [Cost & estimates](./docs/ESTIMATES.md)
- [Why ultracode needs this](./docs/ultracode.md) · [Testing guide](./docs/TESTING.md) · [Publishing & recognition](./docs/PUBLISHING.md)

## Versioning & releases

Semantic versioning; see [`CHANGELOG.md`](./CHANGELOG.md). Tagged releases (`vX.Y.Z`) publish to npm and GitHub Releases via CI.

> Configured for GitHub `danielkremen818/ultracost`. Forking? Update the handle in the install commands, badges, `package.json`, `CHANGELOG.md`, and `.claude-plugin/plugin.json` — see [`docs/PUBLISHING.md`](./docs/PUBLISHING.md).

## License

MIT © Daniel Kremen. Clean-room implementation; prior art credited in [`NOTICE`](./NOTICE).
