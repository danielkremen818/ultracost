# Contributing to ultracost

Thanks for your interest. ultracost is small, dependency-free, and deliberately
scoped to Claude Code's `ultracode` dynamic-workflow path. Contributions that
keep it that way are very welcome.

## Prerequisites

- **Node.js ≥ 24** (CI runs the test matrix on 24 and 26).
- No install step for runtime: ultracost has **zero npm dependencies**
  (runtime *and* dev). `git clone`, then run the commands below directly.

## Project layout

One shared core, two delivery surfaces compiled from the same `policy.json`:

```
src/            shared core — policy loader, rule compiler, guard, estimate, pricing
bin/cli.js      npm CLI surface (init · check · audit · estimate · pricing · status · doctor · uninstall)
skills/         plugin surface — routing-policy skill
commands/       plugin surface — /ultracost:check
hooks/          plugin surface — hooks.json (SessionStart)
templates/      installed artifacts (reinject.mjs, workflow-gate.mjs, policy.default.json)
.claude-plugin/ plugin + marketplace manifests
tests/          node:test suites
examples/       workflow.good.js — the dogfood fixture the guard must keep passing
docs/           architecture, policy, estimates, publishing, testing
```

`policy.json` is the **source of truth**. The CLAUDE.md routing block and the
in-repo rules are *compiled* from it (`src/rules.js`).

## Development workflow

```bash
npm test                                  # run the full node:test suite
node bin/cli.js check examples/workflow.good.js   # the dogfood guard run
```

### The green-bar invariant

Every change must keep **both** of these green:

1. `npm test` passes.
2. `node bin/cli.js check examples/workflow.good.js` exits clean (exit 0).

CI enforces both. PRs that break either won't be merged.

### Never hand-edit the generated block

The rules are **compiled from `policy.json`**. Never hand-edit the generated
`<!-- ultracost:start -->` … `<!-- ultracost:end -->` block (in a user's
`~/.claude/CLAUDE.md` or anywhere it's emitted). Change `policy.json` /
`src/rules.js` and let it recompile instead.

### Testing the installer safely

`ultracost init` writes into your real `~/.claude/`. To try it without touching
your config, point it at a throwaway dir:

```bash
CLAUDE_CONFIG_DIR=$(mktemp -d) node bin/cli.js init
```

All paths honor `CLAUDE_CONFIG_DIR`, so the sandbox install is fully isolated.

## Scope

ultracost targets **Claude Code only** — specifically the `ultracode` /
dynamic-workflow / `agent()` model. It is **not** a multi-harness tool. Please
don't add packaging or docs for other agent harnesses; that would imply support
that doesn't exist. See the `## About` section of the README for the boundary.

## Pull requests

- Fork the repo and open a PR against `main`. **PRs from forks are welcome.**
- Only the maintainer (**@danielkremen818**) merges to `main`.
- Keep the PR focused; update `CHANGELOG.md` (`## [Unreleased]`) and any docs
  your change affects.
- Make sure the green-bar invariant above holds before requesting review.
