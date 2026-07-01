# Policy reference

The policy lives at `~/.claude/ultracost/policy.json` after install. Edit it, then run
`ultracost init` to recompile the `~/.claude/CLAUDE.md` rules from it.

**Resolution order** (`src/policy.js`): an explicit path argument → the installed
`<config>/ultracost/policy.json` → the bundled `templates/policy.default.json`. `<config>`
is `~/.claude`, or `$CLAUDE_CONFIG_DIR` when set.

## How a stage's tier is chosen

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/diagram-policy-decision.svg" alt="How a stage's tier is chosen: an agent() stage hits the question 'must it DECIDE how to write or change code?' — yes routes to the opus tier; no asks 'search / collection / formatting, or a pre-planned mechanical edit?' — yes routes to the sonnet tier, unsure routes to the tieBreaker (default opus). All three then pick the lowest effort that fits, capped by the model." width="640">

</div>

This is the rule the compiled CLAUDE.md block, the SessionStart-injected context, and the
routing skill all carry — and the same logic `classify.js` scores when the guard raises
`UC006`.

```json
{
  "version": 2,
  "neverUse": ["haiku"],
  "allowInherit": false,
  "default": "opus",
  "tieBreaker": "opus",
  "tiers": {
    "opus": { "model": "opus", "effort": "xhigh" },
    "sonnet": { "model": "sonnet", "effort": "high" }
  },
  "alwaysOpus": ["orchestrator", "planner", "final-synthesis", "consolidation"],
  "rules": [
    { "tier": "opus",   "label": "Coding & reasoning",  "when": "..." },
    { "tier": "sonnet", "label": "Mechanical & support", "when": "..." }
  ]
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `version` | number | Policy schema version. |
| `neverUse` | string[] | Models that must never be used. Matched by alias or substring, so `haiku` also bans `claude-haiku-4-5`. The guard raises `UC003` on these. |
| `allowInherit` | boolean | If `false`, `model: 'inherit'` is an error (`UC004`). |
| `default` | string | Tier used by `--fix` and recommended as the fallback. Must exist in `tiers`. |
| `tieBreaker` | string | Tier the rules tell Claude to use "when in doubt". |
| `tiers` | object | Named tiers. Each has `model` (alias or full id) and optional `effort`. A tier whose `model` is in `neverUse` is rejected at load time. |
| `alwaysOpus` | string[] | Stage roles that must always use the default tier (orchestrator, final synthesis, …). Rendered into the rules **and** enforced by the guard: a stage whose prompt reads like one of these roles but pins a cheaper tier raises `UC008`. |
| `rules` | object[] | Human/LLM-facing routing guidance. Each has `tier`, optional `label`, and `when` (the natural-language criteria). |
| `classify.keywords` | object | Optional extra `opus`/`sonnet` keyword signals, merged with the built-in rubric, used by the `UC006` wrong-tier check and `ultracost explain`. The opening imperative verb of a prompt is weighted most. |
| `budget.perRun` | number\|null | Pre-flight cap (USD) on a single workflow launch. When the estimate exceeds it, the cost gate **denies** the launch. `null` = no cap. |
| `budget.perDay` | number\|null | Pre-flight cap (USD) on a day's spend; the gate sums today's recorded ledger spend plus the new estimate. `null` = no cap. |
| `estimation.cacheMultipliers` | object | `cacheRead` / `cacheWrite` factors applied to cached input tokens when pricing real transcript usage (`usage`/`reconcile`/`ledger`). Defaults `0.1` / `1.25`. |

## New guard codes (v2)

| Code | Severity | Meaning |
|------|----------|---------|
| `UC006` | warning | The pinned model disagrees with the work the prompt describes (e.g. a `refactor` stage on `sonnet`, or a `grep` stage on `opus`). Heuristic; only fires on a confident, literal prompt. |
| `UC007` | warning | The pinned `effort` exceeds the model's `effort.maxByModel` cap (e.g. `sonnet` @ `xhigh`). |
| `UC008` | warning | A stage that reads like an `alwaysOpus` role pins a non-default tier. |

`UC006`–`UC008` are warnings — they never change the exit code on their own (only the
pin-presence errors `UC001`–`UC004` do). The wrong-tier scoring is deterministic and offline.

## The closed loop

`ultracost calibrate` writes a token prior learned from your real runs to
`~/.claude/ultracost/calibration.json`; `estimate`, `explain`, `simulate`, and the cost gate
use it automatically when present. `ultracost ledger` persists per-run savings to
`~/.claude/ultracost/ledger.jsonl`. Both are local and offline. See
[ESTIMATES.md](./ESTIMATES.md) for the cost model and reconciliation details.

## Notes on effort

`xhigh` is Opus-only. Sonnet tiers should use `high` (or `max`) — ultracost never downgrades the *model* to obtain more thinking; it keeps the model and uses that model's top effort. ultracost routes by tier alias (`opus`/`sonnet`), so it isn't tied to a specific model version.

## Switching to a cost-first policy

Edit the tiers/rules — for example, add a `haiku` tier, remove it from `neverUse`, and route search/format stages to it. ultracost is unopinionated about the contents; it only guarantees that whatever you decide is pinned explicitly on every stage.
