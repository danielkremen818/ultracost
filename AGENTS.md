# AGENTS.md

Onboarding for an AI agent (or human) working **on the ultracost repository**.

> This file is about *developing ultracost*. It is **distinct** from the routing
> block ultracost injects into a *user's* `~/.claude/CLAUDE.md` (the generated
> `<!-- ultracost:start -->` … `<!-- ultracost:end -->` section compiled from
> `policy.json`). Do not confuse the two.

## Purpose

ultracost keeps Claude Code's `ultracode` dynamic workflows from silently
running every `agent()` subagent on Opus: it injects an explicit per-stage
routing policy each session and ships a static guard that fails any unpinned
stage.

## Structure map

One shared core, two delivery surfaces, both compiled from the same
`policy.json`:

```
src/            shared core
  policy.js     load + normalize policy.json, classify/resolve models
  rules.js      compile the policy into the CLAUDE.md routing block
  guard.js      static analysis of agent() stages (UC001–UC005), --fix
  estimate.js   static cost estimate (model mix, tiered vs all-opus)
  pricing.js    parse + refresh the official rate table
  install.js    init/uninstall (writes under ~/.claude, honors CLAUDE_CONFIG_DIR)
  paths.js, log.js, index.js
bin/cli.js      npm CLI surface — init · check · audit · estimate · pricing · status · doctor · uninstall
skills/         plugin surface — routing-policy skill
commands/       plugin surface — /ultracost:check
hooks/          plugin surface — hooks.json (SessionStart injection)
templates/      installed artifacts: reinject.mjs, workflow-gate.mjs, policy.default.json
.claude-plugin/ plugin.json + marketplace.json
tests/          node:test suites (guard, estimate, hook)
examples/       workflow.good.js — dogfood fixture the guard must keep passing
docs/           architecture, policy, estimates, ultracode, testing, publishing
```

## Where the policy lives

`policy.json` is the **source of truth**. The default ships as
`templates/policy.default.json`; `src/policy.js` loads/normalizes it and
`src/rules.js` compiles it into the injected CLAUDE.md block. Change the policy
or the compiler — **never hand-edit a generated `ultracost:start` block.**

## Commands

```bash
npm test                                          # full node:test suite
node bin/cli.js check examples/workflow.good.js   # the dogfood guard run
CLAUDE_CONFIG_DIR=$(mktemp -d) node bin/cli.js init   # sandboxed install test
```

## Invariants (keep green)

1. `npm test` passes (CI matrix: Node 24 / 26).
2. `node bin/cli.js check examples/workflow.good.js` exits 0 (the guard stays
   green on the dogfood fixture).

Both are enforced in CI; a change that breaks either is not merge-ready.

## Live verification (every new feature)

`npm test` and the dogfood guard are necessary but **not sufficient**. They exercise the
code in isolation; they do not prove the feature actually fires inside a real Claude Code
session. So for **every new feature**, before claiming it works, you MUST install the
plugin **from this local working copy** into Claude Code, turn on ultracode, and verify the
behavior with prompts to Claude Code. Testing via the npm CLI (`node bin/cli.js init`) does
**not** satisfy this — it exercises a different delivery surface than what users install.

1. **Load the plugin from local code** (see [docs/TESTING.md](docs/TESTING.md) Step 3):

```bash
claude plugin marketplace add ~/projects/ultracost   # register the working copy
claude plugin install ultracost@ultracost
# or, session-scoped (nothing left behind): claude --plugin-dir ~/projects/ultracost
```

   After editing plugin code, reload in-session with `/reload-plugins` (no restart needed).
   Confirm it loaded: `/help` lists the `ultracost` plugin and `/ultracost:*` commands.

2. **Turn on ultracode** in the session, then drive the feature with a prompt:

```text
/effort ultracode
```

3. **Verify with prompts** — pick a prompt that makes the feature observable, e.g.:

- **Fan-out / routing prose (SessionStart injection + skill)** — give it a multi-file task
  in ultracode and confirm it *fans out into parallel `agent()` stages* (scout inline, then
  fan out; pin the contract first) instead of hand-editing file-by-file, and that each stage
  pins `model:`/`effort:`. Or ask directly: "What model-routing and orchestration rules are
  in effect?" and confirm the injected `Orchestration (when to fan out)` text is present.
- **PreToolUse cost gate** — let it launch a dynamic workflow and confirm the gate pauses
  with the estimate (and denies an unpinned script under `ULTRACOST_GATE=strict`).
- **Slash command** (`/ultracost:*`) — invoke it and confirm the expected output.
- **Stop autorun / HUD** — confirm the closed-loop summary / statusline renders.

If the live ultracode run doesn't show the behavior, it is **not** done — fix it, don't
claim it. Clean up with `claude plugin uninstall ultracost@ultracost` +
`claude plugin marketplace remove ultracost` (Step 3 Option A); `--plugin-dir` leaves
nothing behind.

## Scope

Claude Code **only** — the `ultracode` / dynamic-workflow / `agent()` model and
Opus `@ xhigh` don't exist on other harnesses. Do **not** add multi-harness
packaging (`.codex-plugin/`, `.cursor-plugin/`, `.opencode/`, `GEMINI.md`,
etc.); zero runtime dependencies is a hard constraint.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow and
[docs/architecture.md](docs/architecture.md) for the full design.
