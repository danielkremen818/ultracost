# Why ultracode needs per-stage routing

`ultracode` (Claude Code v2.1.154+, shipped May 2026) combines two things: **`xhigh`
reasoning effort** and **automatic dynamic-workflow orchestration**. Both interact
badly with model defaults.

## The three compounding defaults

1. **`xhigh` is Opus-only.** Turning on ultracode forces the *session* onto Opus —
   you cannot run an ultracode session on Sonnet.
2. **Subagents inherit the session model.** With no per-stage override, every spawned
   stage runs on the session's Opus model.
3. **Workflow-authoring guidance says to omit the per-agent model.** So inheritance is
   the path of least resistance, and the whole fan-out lands on Opus.

The result is documented in
[anthropics/claude-code#66023](https://github.com/anthropics/claude-code/issues/66023):
a single prompt spawned **46 Opus subagents (~3M tokens)** with no cost warning.

<div align="center">

<img src="https://raw.githubusercontent.com/danielkremen818/ultracost/main/assets/diagram-ultracode.svg" alt="The ultracode cost trap: ultracode on forces the session to Opus (xhigh is Opus-only), the workflow fans out to dozens of subagents, and because the built-in guidance omits the per-agent model the stages inherit the session model — so the whole fan-out runs on Opus by accident. ultracost pins a model per stage, then verifies it." width="900">

</div>

## Why the usual levers don't fit

- **`/model sonnet` on the session** cascades a cheap model to the fan-out — but it's
  incompatible with ultracode, because ultracode requires Opus for `xhigh`.
- **`CLAUDE_CODE_SUBAGENT_MODEL`** is a global override that beats per-invocation and
  per-agent settings — so it *defeats* a mixed, per-stage policy.

That leaves exactly one correct lever: **pin the model per stage inside the workflow
script** (`agent(task, { model: 'sonnet' })`). ultracost makes that the default behavior
(via a `SessionStart` hook that injects the policy as context — plus the CLAUDE.md rule on
the CLI path) and **verifies it** (via the guard).

## ultracost's stance

Quality-first, not cost-first: coding and reasoning stay on Opus @ `xhigh`; only
pre-planned mechanical execution and search/collection drop to Sonnet; Haiku is never
used. The biggest win isn't shaving Sonnet off a few stages — it's stopping a 40-agent
fan-out from running Opus *by accident* on work that was already planned.

The same injected policy also carries fan-out orchestration guidance, so ultracode
*uses* a workflow instead of hand-editing file-by-file: scout the structure inline, then
fan out the moment you cross into implementing; when stages are coupled, pin the shared
contract first and fan the consumers out against it (coupling shapes the fan-out, it
doesn't justify going solo).
