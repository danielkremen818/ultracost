# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.5] - 2026-06-17

### Changed
- **Smarter model-decision logic (not just keywords).** The deterministic tier classifier
  (`src/classify.js`, behind `explain` / `check` / UC006) now reasons about prompt *structure*,
  not a flat bag-of-words: (1) the **leading imperative verb** is weighted as the strongest
  signal; (2) **multiword phrase signals** catch context a bag misses (`edge cases`,
  `tests pass`, `type-check`, `root cause`, `is correct`); and (3) **ambiguous verbs**
  — `verify` / `validate` / `check` / `ensure` / `confirm` / `test` — are disambiguated by the
  mechanical-vs-reasoning balance of the surrounding words. So `verify the tests pass /
  typecheck` reads **sonnet** (mechanical) while `verify the logic is correct / handles edge
  cases` reads **opus** (reasoning); a context-free `verify` stays low-confidence so the guard
  never warns on a coin-flip. UC006 now catches verify stages pinned both too high (opus where
  sonnet suffices) and too low (sonnet where opus is needed). The injected policy prose gained
  matching `verify` guidance so the live model routes the same way.

## [0.4.4] - 2026-06-17

### Changed
- **HUD shows real workflow-stage names instead of `workflow-subagent`.** A workflow stage
  carries no description on disk and its journal key is a hash, so the HUD now derives each
  label from the stage's first prompt. Parallel stages usually share a long preamble (a frozen
  contract), so the prefix a stage shares with a sibling is stripped first — what's left starts
  with the per-stage specifics (often the target file), yielding distinct labels like
  `clusters.ts`, `secrets.ts`, `bom.ts` rather than N identical `workflow-subagent` rows.
  Regular subagents with no description fall back to a prompt-derived label too.
- **HUD uses the available vertical space instead of `+K more`.** The running-agent list (and
  the pipeline band beside it) now grows to a terminal-height budget (`LINES` − panel chrome,
  clamped 4–24; a generous default when the height is unknown) before collapsing the overflow,
  so a big fan-out fills the space the tall logo already occupies. The logo is padded to its
  true max width so the band stays column-stable as the panel grows.
- **Stronger fan-out directive.** The compiled routing block now *leads* with an imperative
  `Orchestration (when to fan out)` section: when `ultracode` is on, a multi-file or multi-part
  task MUST run as parallel `agent()` stages — solo inline file-by-file execution is treated as
  a bug, not a shortcut. Propagates to the `SessionStart` injection, the `~/.claude/CLAUDE.md`
  block, and the routing skill via `compileRules()`.

## [0.4.3] - 2026-06-16

### Added
- **Fan-out orchestration guidance in every surface.** The compiled routing block now
  carries an `Orchestration (when to fan out)` section, so `ultracode` defaults to fanning
  work out into parallel `agent()` stages instead of hand-editing file-by-file: scout the
  structure inline, then fan out the moment you cross into implementing; when stages are
  coupled, pin the shared contract first and fan the consumers out against it. Because it
  lives in `compileRules()` (the single source of truth), it propagates automatically to the
  `SessionStart` injection, the `~/.claude/CLAUDE.md` block, and the routing skill — no user
  action beyond updating.
- **HUD subagent-pipeline band.** The statusline HUD gains a third column to the right of the
  pixel logo: a live, per-agent swimlane view of the subagents running right now. Each lane is
  a tier-colored particle stream (opus=violet, sonnet=cyan, …) whose span is proportional to
  elapsed time (auto-scaled so the longest-running agent fills the band), with full agent
  labels and a `+K more` overflow. The HUD height is now content-driven (idle ≈ 8 rows, no
  blank padding; grows as agents run), the logo resamples to match, and the band reserves a
  1-column right margin so the statusline never clips. The band appears only while subagents
  are working; idle shows panel + logo only. Truecolor → 256 → 16 → mono (ASCII) degradation,
  and a width ladder (band → logo → panel → compact) for narrow terminals. New
  `scripts/hud-preview.mjs` renders an animated local preview.

## [0.4.2] - 2026-06-16

### Added
- **HUD sets itself up on install.** Claude Code plugins have no install hook, so a new
  `SessionStart` hook (`templates/hooks/hud-setup.mjs`) sets ultracost as your `statusLine`
  on the first session after the plugin is installed — the live cost HUD now "just works"
  with nothing to run. It's **one-time** (a `.hud-autosetup` marker means it won't re-add a
  statusLine you later removed), backs up any statusline you already had, and is opt-out via
  `ULTRACOST_HUD=off`. `ultracost init` already did this on the CLI path.

### Changed
- **The plugin HUD statusLine command is now uninstall-safe.** It guards the plugin-cache
  lookup with `[ -n "$f" ]`, so if the plugin is removed the statusLine prints nothing
  instead of erroring.

## [0.4.1] - 2026-06-16

### Fixed
- **Release publishing.** `0.4.0` was tagged but never published to npm because
  `package.json` wasn't bumped alongside `plugin.json`/`marketplace.json` (npm refuses to
  re-publish `0.3.7`). All three versions are now synced and enforced by
  `tests/version-sync.test.js`. **`0.4.1` is the first published `0.4.x`** and carries all the
  `0.4.0` features below (HUD statusline + closed-loop autorun).

## [0.4.0] - 2026-06-16

### Added
- **Themed HUD statusline.** A live Claude Code statusline (`ultracost hud` / `/ultracost:hud`)
  that shows session cost, running subagents, context usage, and an animated pixel logo,
  refreshed ~1×/sec. `ultracost init` and the plugin set it as your `statusLine`, back up any
  prior statusline, and restore it exactly on uninstall. Renders offline from the statusline
  JSON on stdin; truecolor with graceful degradation. (#29)
- **Closed-loop autorun on `Stop`.** A new `Stop` hook (`templates/hooks/loop-autorun.mjs`)
  runs the closed loop automatically when the main agent finishes — `reconcile` +
  `calibrate` + `ledger` — so the user no longer has to remember the slash commands after a
  dynamic workflow. It is idempotent and cheap: a fast dir+mtime scan (`workflowRunDirs`)
  short-circuits before any transcript parsing unless a new workflow id appeared since the
  last turn. On a fresh run it upserts the savings ledger, refreshes the calibration prior,
  and surfaces an estimate-vs-actual summary via `systemMessage`. It never blocks `Stop` and
  always exits 0. Disable with `ULTRACOST_AUTORUN=off`.
- **CLI parity for the autorun hook.** `ultracost init` now registers the `Stop` hook in
  `settings.json` (pointing at the package's `loop-autorun.mjs`), and `ultracost uninstall`
  removes it — matching the plugin's `hooks.json` delivery.
- **`workflowRunDirs()`** in `src/transcript.js` — a cheap dir+mtime scan (no transcript
  parsing) that backs the autorun hook's fast-path; `locateWorkflowRuns()` is refactored to
  build on it (behavior unchanged).

## [0.3.7] - 2026-06-15

### Fixed
- **HTML/SVG attribute escaping.** The terminal-panel SVG generator now escapes `"` and
  `'` in addition to `&`/`<`/`>`, so generated `aria-label`/text attributes can't be
  broken out of (CodeQL `js/incomplete-html-attribute-sanitization`).
- **Release signatures use a recognized format.** The cosign Sigstore bundle is now
  attached as `*.sigstore.json` so release signatures are detected by standard tooling.

## [0.3.6] - 2026-06-15

### Added
- **100% test coverage.** The suite grew from 126 to 230 tests for full source line and
  function coverage; `bin/cli.js` was refactored into an importable `src/cli.js` with the
  CLI behavior unchanged.
- **Test coverage reporting.** A `coverage` script uses Node's built-in coverage
  (no new dependency) to emit lcov, and CI uploads it to Codecov; README gains coverage
  and zero-dependencies badges.
- **Signed release artifacts.** Each GitHub Release now ships the published tarball
  alongside a cosign (keyless) signature, certificate, and Sigstore bundle, so you can
  cryptographically verify exactly what you install.

### Changed
- **Release pipeline uses Node 24's bundled npm directly** (no unpinned global npm
  install), keeping the build toolchain fully pinned.
- **Docs diagrams are now brand-colored SVGs, not mermaid.** All eight in-doc mermaid
  blocks were converted to generated, animated SVGs in the `assets/architecture.svg`
  visual language (dark radial canvas, violet→cyan palette, rounded accent cards, curved
  animated flows, `prefers-color-scheme` light/dark) — GitHub renders mermaid with a fixed
  blue/gray theme that can't be brand-colored. Shared primitives were factored out of
  `scripts/generate-architecture-svg.py` into a new zero-dependency `scripts/svgkit.py`,
  and a new `scripts/generate-doc-diagrams.py` emits `assets/diagram-ultracode.svg`,
  `diagram-policy-decision.svg`, `diagram-guard-sequence.svg`, `diagram-testing.svg`,
  `diagram-showcase.svg`, `diagram-release.svg`, and `diagram-gate-decision.svg`. The
  redundant text-first architecture flowchart was dropped (the colored system map already
  is the reference).
- **Hardened the release pipeline:** explicit least-privilege permissions and an exact
  pinned npm version.

## [0.3.5] - 2026-06-15

### Added
- **Supply-chain & trust signals.** `CITATION.cff` (GitHub "Cite this repository"),
  an OpenSSF Scorecard workflow and a CodeQL workflow in CI, a `funding` field in
  `package.json`, and `version` + `license` on the marketplace plugin entry. README
  gains OpenSSF Scorecard, Socket, Snyk, and "Cite" badges plus a "Security & trust"
  callout.
- **Docs & visual overhaul.** A repo banner (`assets/banner.png`) leads the README; a new
  zero-dependency ANSI→SVG generator (`scripts/generate-terminals.mjs`) renders the real
  CLI output as on-brand mac-window panels (`assets/term-*.svg`); the architecture diagram
  generator (`scripts/generate-architecture-svg.py` → `assets/architecture.svg`) is
  expanded and made precise to the current architecture (full `src/` core, both surfaces,
  the runtime guard + cost gate, and the closed loop); mermaid diagrams were added/refreshed
  across `docs/`; and the README was tightened for scannability.

### Changed
- **Hardened CLI path handling.** User-supplied path arguments are now routed through a
  single `safePath()` choke point that rejects NUL-byte injection and canonicalizes to
  an absolute, normalized path before any filesystem read.
- **`SECURITY.md`** supported-versions table corrected to the `0.3.x` line, with a
  documented scanner posture (zero dependencies, Snyk Open Source clean, OIDC signed
  provenance, SHA-pinned actions).

## [0.3.4] - 2026-06-14

### Added
- **`docs/SHOWCASE.md`** — a captured, unscripted `ultracode` run showing all four layers
  fire without the user mentioning workflows or ultracost: policy injection (stages pinned
  on their own) → guard → the pre-flight cost gate → the native Approve/Modify/Cancel
  confirmation. Includes `examples/deep-audit.workflow.js`, a guard-clean per-file audit
  workflow you can run `ultracost check` / `estimate` against.

### Fixed
- **Images render on the npm package page.** The npm `files` allowlist doesn't include
  `assets/`, so the README's logo and diagrams showed as broken links on npmjs.com. The
  README and `docs/SHOWCASE.md` now reference images by absolute `raw.githubusercontent.com`
  URLs, so they render on both npm and GitHub without bloating the published tarball.

## [0.3.3] - 2026-06-14

### Changed
- **Slash commands are now agentic, not shell wrappers.** Each `/ultracost:<verb>` is a
  task: it uses the ultracost CLI as a *data tool* (the colored panels are evidence), the
  model reasons over the result, and where a decision helps it drives a **native
  `AskUserQuestion` picker** and carries out the choice. Examples: `/ultracost:check`
  proposes the correct per-stage pins and offers to apply them (now allowed to `Edit`);
  `/ultracost:estimate` names the costly stages and offers downgrades; `/ultracost:status`
  warns when a bypass permission mode is weakening the gate. Commands now declare the tools
  they need (`Read`/`Edit`/`AskUserQuestion`) instead of `Bash` only.

## [0.3.2] - 2026-06-14

### Changed
- **Slash commands now match the `npx` visual experience.** Each `/ultracost:<verb>` command
  runs the bundled CLI with `env -u NO_COLOR FORCE_COLOR=3`, so the visual kit emits its
  panels, tables, bars, and sparklines in color even though the Bash tool is not a TTY (and
  any ambient `NO_COLOR` is cleared for that one invocation). The command files now instruct
  the model to surface that output as the answer rather than paraphrasing it. (A chat markdown
  code block still can't render ANSI color — color shows in the command-output view; the
  unicode panels/bars read fine either way.)

## [0.3.1] - 2026-06-14

### Added
- **A slash command for every verb inside Claude Code.** The plugin previously shipped only
  `/ultracost:check`, so the phase-2 features were reachable solely through the npm CLI. It now
  ships `/ultracost:estimate · explain · simulate · diff · audit · usage · reconcile · calibrate ·
  ledger · status` as well — each runs the bundled CLI via `${CLAUDE_PLUGIN_ROOT}/bin/cli.js`, so
  plugin users need nothing on `PATH`. Generated from one table (`scripts/generate-commands.mjs`)
  and drift-tested.

### Changed
- **README is plugin-first.** The first-use example is `/ultracost:check ./path/to/workflow.js`
  (the slash command), not the npm `ultracost check` — which plugin users don't have on `PATH`.
  Added a full slash-command table and noted the `/ultracost:<verb>` equivalent next to each CLI
  block. The npm CLI is now framed as the CI/scripting path.

## [0.3.0] - 2026-06-14

Phase 2 — closed-loop precision and a zero-dependency visual overhaul. Still zero runtime
dependencies, Claude-Code-only, and offline on the hot path.

### Added
- **Closed-loop, self-calibrating estimates.** New `src/transcript.js` reads local Claude Code
  session transcripts offline (clean-room parse + dedup on `message.id`+`requestId`) and
  attributes tokens **per dynamic-workflow stage** via `subagents/workflows/wf_*/agent-*.jsonl`
  + `journal.jsonl`. `src/cost.js` prices real usage with cache multipliers.
  - `ultracost usage` — real token cost from your transcripts (main vs subagents vs workflow stages).
  - `ultracost reconcile [--last|<wfId>]` — estimate-vs-actual per stage for a real run.
  - `ultracost calibrate` — learns a token prior from your runs (outlier-filtered) into
    `~/.claude/ultracost/calibration.json`; `estimate`/`explain`/`simulate`/the gate use it automatically.
  - `ultracost ledger` (alias `savings`) — cumulative savings vs an all-opus baseline,
    persisted in `~/.claude/ultracost/ledger.jsonl` (idempotent per workflow id).
- **Sharper static guard.** `src/guard.js` now runs on a hand-rolled zero-dep JS tokenizer
  (`src/lexer.js`) instead of regex: dynamic model values, template literals, spreads, and
  optional-call `agent?.()` are handled, and fan-out detection covers `forEach`, `for…of`,
  `Promise.all([...map])`, and `Array.from` (not just `.map`/`pipeline`).
- **New guard codes.** `UC006` flags a pin that mismatches the work the prompt describes,
  `UC007` flags effort over the model's cap, `UC008` flags an `alwaysOpus` role pinned off-opus.
  Deterministic, offline tier scoring lives in `src/classify.js`.
- **`ultracost explain` / `simulate` / `diff`.** Per-stage rationale (tier, effort, est cost,
  check flags); cost under all-opus / tiered / all-sonnet side by side; and a cost delta between
  two workflow versions, with `--ci` emitting an Infracost-style PR-comment table.
- **Pre-flight budget guard.** `policy.budget.perRun` / `perDay` make the cost gate hard-deny an
  over-budget launch before it runs (per-day reads the savings ledger).
- **Zero-dependency visual overhaul.** New `src/render.js` (truecolor/256/16 with NO_COLOR and
  FORCE_COLOR support, ANSI-aware width via `util.stripVTControlCharacters` + `Intl.Segmenter`,
  box-drawing tables, bars, sparklines, rounded panels) reskins every command and the cost gate's
  message (now an aligned multi-line cost table).

### Changed
- **`status` and `doctor` are plugin-aware.** New `src/detect.js` reports how ultracost is
  delivered (`plugin` / `cli` / `both` / `none`) by reading `enabledPlugins` (in `settings.json`
  **and** `settings.local.json`) and the plugin cache `hooks/hooks.json` — so they no longer
  report the active plugin as "off / N issues". Both surface the bypass-mode caveat.
- **`init` refuses to double-install.** When the plugin already delivers ultracost, `init` stops
  (unless `--force`) so it can't write duplicate `~/.claude` rules that conflict with the plugin.
  CLI hints are `npx`-aware.
- **One source for the routing prose.** The SessionStart hook (`reinject.mjs`) now compiles the
  injected policy from `src/rules.js` at runtime, and `skills/ultracost/SKILL.md` is generated from
  the same `compileRules()` (drift-tested), so the CLAUDE.md block, the hook, and the skill cannot
  diverge. The injected prose no longer assumes a global `ultracost` binary (plugin users have none).
- **Policy `version` bumped to 2**: adds `classify.keywords`, `budget`, and
  `estimation.cacheMultipliers` (all optional, back-compatible).

## [0.2.1] - 2026-06-14

### Changed
- **The cost gate is now mode-aware and hard in every permission mode.** It reads
  `permission_mode` from the `PreToolUse` event: it asks (with the estimate) in
  `default`/`acceptEdits`/`auto`, and **auto-denies** an unpinned/banned/`inherit` workflow
  in `bypassPermissions`/`dontAsk` — where an `ask` is auto-approved and wouldn't pause. A
  `PreToolUse` `deny` is honored in every mode, so this closes the bypass gap without an env
  var. `ULTRACOST_GATE=strict` denies on any problem in all modes; new `=ask` opts out of the
  escalation (always ask); `=off` disables. Documented the residual upstream limitation that
  Claude Code skips `PreToolUse` hooks for subagents dispatched under `bypassPermissions`
  ([#43772](https://github.com/anthropics/claude-code/issues/43772)).

### Added
- **`pipeline(items, ...stages)` fan-out detection.** The guard and estimate now recognize
  the Workflow API's `pipeline()` primitive: every stage's `agent()` runs once per item, so
  those stages are counted as fan-out (like `.map`). A live test exposed that an `ultracode`
  build/verify/fix workflow uses `pipeline()`, which the old detector counted as a few fixed
  agents — badly under-reporting both the agent count and the cost.
- **The cost gate now enforces, not just estimates.** `workflow-gate.mjs` runs the static
  guard and leads the prompt with `⚠ N/M stage(s) NOT pinned -> will inherit <session model>`
  when any stage is unpinned/banned/`inherit`. New `ULTRACOST_GATE=strict` mode **denies**
  such launches outright (the model must pin every stage and relaunch).
- **The estimate is surfaced via `systemMessage`** so it's actually visible to the user.
  Claude Code does not render `permissionDecisionReason` for `"ask"` decisions in the TUI
  ([#24059](https://github.com/anthropics/claude-code/issues/24059)); the gate now sends the
  numbers through the documented `systemMessage` channel (and still sets the reason).

### Changed
- **The pre-flight cost gate is now ON by default and deterministic.** The plugin
  registers the `PreToolUse` hook on the `Workflow` tool (`hooks/hooks.json` →
  `templates/hooks/workflow-gate.mjs`), so every dynamic-workflow launch hard-stops with a
  cost estimate and an approve/deny prompt — no longer reliant on the model invoking
  `AskUserQuestion`. Set `ULTRACOST_GATE=off` to disable for non-interactive runs
  (`claude -p`, Auto Mode, CI); bypass-permissions mode auto-approves it. The gate now
  always pauses on a `Workflow` launch (even if the script can't be read for an estimate)
  and fails closed rather than letting an unpriced fan-out through.

## [0.2.0] - 2026-06-14

### Added
- **`ultracost estimate <script>`** — static cost estimate for a workflow: agent count
  (fan-outs as `N x`), model mix, and tiered-vs-all-opus cost with savings. `--json` supported.
- **Dynamic per-stage effort.** The policy now has Claude pick an `effort` per stage
  (`low`..`xhigh`, bounded by model) instead of a fixed per-tier effort, and the estimate
  factors effort into output-token cost. New `effort` block in `policy.json`.
- **Official-sourced pricing.** `pricing` block in `policy.json` carries `_source`/`_asOf`
  provenance; `ultracost pricing` shows it and `ultracost pricing refresh` re-fetches
  Anthropic's official pricing page and rewrites it. The estimate stays offline.
- **Pre-flight cost gate.** The injected policy + skill have Claude estimate a workflow and
  offer Approve / Cancel / Modify via `AskUserQuestion` before launching. Ships an opt-in
  deterministic `PreToolUse` gate (`templates/hooks/workflow-gate.mjs`) on the `Workflow` tool.

### Changed
- The `SessionStart` hook now injects the routing policy as `additionalContext` on every
  source (`startup|resume|clear|compact`), not just `compact`. A live end-to-end test showed
  the model-invoked skill alone was only *offered* and never opened during workflow authoring,
  so stages stayed unpinned; injecting the policy at session start makes the same prompt pin
  every stage with correct tiers. The skill now plays a secondary, explicit-reference role.

## [0.1.0] - 2026-06-14

### Added
- `ultracost init` — install a quality-first routing policy, compile it into
  `~/.claude/CLAUDE.md`, and register a `SessionStart` policy-injection hook.
- **Workflow Guard** (`ultracost check`) — static analysis that flags `agent()` stages
  missing a model pin, with codes `UC001`–`UC005`, `--json`, and `--fix`.
- Data-driven `policy.json` with load-time validation (rejects undefined default tiers
  and tiers whose model is in `neverUse`).
- `ultracost status`, `ultracost doctor`, `ultracost uninstall`.

[Unreleased]: https://github.com/danielkremen818/ultracost/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/danielkremen818/ultracost/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/danielkremen818/ultracost/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/danielkremen818/ultracost/compare/v0.3.7...v0.4.0
[0.3.7]: https://github.com/danielkremen818/ultracost/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/danielkremen818/ultracost/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/danielkremen818/ultracost/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/danielkremen818/ultracost/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/danielkremen818/ultracost/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/danielkremen818/ultracost/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/danielkremen818/ultracost/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/danielkremen818/ultracost/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/danielkremen818/ultracost/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/danielkremen818/ultracost/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/danielkremen818/ultracost/releases/tag/v0.1.0
