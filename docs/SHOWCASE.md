# Showcase: ultracost on a real `ultracode` run

A live, unscripted end-to-end run — captured to show every layer firing **without the
user mentioning workflows, subagents, or ultracost**. The only input was a natural audit
request while `ultracode` (Opus @ `xhigh` + dynamic workflows) was on.

> Dogfood: ultracost auditing ultracost, while obeying ultracost.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/diagram-showcase.svg" alt="ultracost on a live ultracode run: (1) SessionStart injects the policy, Claude authors a fully-pinned workflow, (2) the guard confirms every stage pins a model, (3) the PreToolUse gate hard-stops with the estimate and Approve / Modify / Cancel via AskUserQuestion, then (4) reconcile · calibrate · ledger after the run." width="900">

</div>

## The prompt

No mention of "workflow", "pin a model", "estimate", or "ultracost":

```text
Scan each file in ~/projects/ultracost/src for missing error handling only —
one quick pass per file, no deep analysis — and give me a single combined list
of gaps with file:line.
```

## 1. Policy injection (unprompted)

ultracost's `SessionStart` hook had already injected the routing policy as context, so
when Claude authored the dynamic workflow it **pinned a model on every `agent()` stage on
its own** and even reasoned about the gate and budget caps *before* launching:

> "ultracost's own PreToolUse gate will evaluate this Workflow launch (it fires even under
> bypassPermissions) … so I must pin a model on every `agent()` call and stay under the
> budget caps. Let me check the policy's budget before authoring."

It checked `policy.budget` (null caps → no over-budget risk), then wrote a fully pinned
per-file scan workflow. No instruction from the user produced any of that.

## 2. The Workflow Guard (deterministic)

Before launch, the guard confirmed every stage was pinned — and Claude noticed the
estimator's fan-out assumption was conservative for a 16-file run and **self-corrected the
number out loud**:

> "Check passes — every stage pinned (opus @ medium). Estimator assumes ~5 fan-out items;
> real run is 16 files (one agent each), so scale up ~3.2×."

## 3. The pre-flight cost gate + native confirmation

The `PreToolUse` hook hard-stopped the `Workflow` launch with the estimate, and the policy
drove the **Approve / Modify / Cancel** menu through the native `AskUserQuestion` picker —
before a single subagent ran:

![ultracost's pre-flight cost gate: estimate + Approve / Modify / Cancel](https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/showcase-cost-gate.png)

```text
Cost gate — 16-file scan:
- Agents: 16 × opus @ medium (per-file judgment; "quick pass, no deep analysis")
- Model mix: 16× opus (no haiku; sonnet caps below the judgment this needs)
- Est. tiered ≈ $0.64 vs all-opus-xhigh baseline ≈ $1.60 (~60% saved, from effort tier)

Launch the 16-file error-handling scan workflow (~$0.64, 16× opus@medium)?
 1. Approve   — launch as drafted
 2. Modify    — cut cost first (drop to sonnet@high per file, or batch files to reduce
                fan-out), then re-estimate
 3. Cancel    — do not launch; do a single inline pass instead
```

The earlier attempts *looked* like nothing happened because the session was in `auto` /
`bypassPermissions`, where an `ask` is auto-approved. The gate's `ask` only pauses in
`default` / `acceptEdits`; its **hard-deny** of unpinned/over-budget workflows holds in
every mode.

## A larger run: the deep audit

The same setup, given a broader prompt ("thorough deep audit … cover every source file"),
produced a ~100-stage workflow that still passed the gate clean:

![Claude Code monitoring the ultracost-deep-audit dynamic workflow](https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/showcase-workflow.png)

```text
ultracost estimate:
  agents     ~26 (1 fixed + 5 fan-out x ~5)
  model mix  15x sonnet, 11x opus
  tiered     $1.6760   vs all-opus $2.6000   (save $0.9240, 36%)
```

Structure Claude chose: 1 reviewer per source file (18 opus, 4 sonnet), 4 opus cross-cut
specialists (security / performance / test-coverage / completeness), an adversarial sonnet
verifier per finding, and an opus synthesis into one P0–P3 report.

## Closing the loop

The gate estimate is a floor (fan-out size is a runtime value). After a run completes:

```bash
ultracost reconcile --last   # real per-stage cost vs the estimate
ultracost calibrate          # fold the real fan-out sizes into the estimator's prior
ultracost ledger             # cumulative savings vs an all-opus baseline
```

`calibrate` is exactly what makes the "scale up ~3.2×" correction automatic next time.

## Reproduce it

The committed [`examples/deep-audit.workflow.js`](../examples/deep-audit.workflow.js) is a
guard-clean version of this audit shape:

```bash
ultracost check    examples/deep-audit.workflow.js   # zero findings — every stage pinned
ultracost estimate examples/deep-audit.workflow.js   # ~17 agents, 67% under all-opus
```

In Claude Code with `ultracode` on, give the natural prompt above (in `default` or
`acceptEdits` mode so the gate pauses) and watch the same four layers fire.
