# Security Policy

## Supported versions

ultracost follows [Semantic Versioning](https://semver.org/). Security fixes
land on the latest minor release line.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | ✅        |
| < 0.3   | ❌        |

## Reporting a vulnerability

Please report security issues **privately** via this repository's
**GitHub Security Advisories** → **"Report a vulnerability"**
(the *Security* tab → *Advisories* → *Report a vulnerability*). This opens a
private channel with the maintainer; do **not** open a public issue for a
suspected vulnerability.

You should expect an initial acknowledgement within a few days. Once a fix is
prepared, the advisory is published alongside the patched release.

## Trust model

ultracost is a local static analyzer and config installer. It is intentionally
small and easy to vet:

- **No telemetry.** Nothing is collected, logged off-machine, or phoned home.
- **No network on the session hot path.** The `SessionStart` hook
  (`reinject.mjs`) drains stdin and emits a static policy string — no I/O, no
  subprocesses, no network.
- **One outbound request, user-invoked only.** The *only* time ultracost makes
  a network request is when you run `ultracost pricing refresh`, which fetches
  Anthropic's official pricing page
  (`https://platform.claude.com/docs/en/about-claude/pricing.md`) to update the
  rate table in your local `policy.json`. Estimates and the guard run fully
  offline.
- **Zero runtime dependencies.** The published package has no `dependencies`
  and no `devDependencies`; the entire surface is auditable Node stdlib code
  under `bin/`, `src/`, and `templates/`.
- **Touches only its own files.** The installer writes under
  `~/.claude/ultracost/`, injects a clearly delimited
  `<!-- ultracost:start -->` block into `~/.claude/CLAUDE.md`, and registers its
  hook in `~/.claude/settings.json`. `ultracost uninstall` reverses this.

## Scanner posture

ultracost is built to be auditable, and the supply-chain posture is verifiable:

- **Zero dependency risk.** No runtime or dev dependencies, so there is nothing to
  pull in transitively. Snyk Open Source and `npm audit` report **0 vulnerabilities**.
- **Signed, reproducible releases.** Published to npm with OIDC Trusted Publishing and
  a signed `--provenance` attestation; no long-lived npm token exists to leak.
- **Pinned CI.** Every GitHub Action is pinned to a full commit SHA. CodeQL and
  OpenSSF Scorecard run on a schedule and on every push to `main`.
- **Hardened input handling.** User-supplied path arguments are routed through a single
  `safePath()` choke point that rejects NUL-byte injection and canonicalizes the path
  before any filesystem read.

### Known static-analysis findings (accepted, by design)

Static analysis (Snyk Code, CWE-23 "Path Traversal") flags that the CLI reads files and
directories named on the command line — for example `ultracost check ./workflow.js` or
`ultracost audit ~/.claude/projects`. This is the intended behavior of a local developer
CLI: the path you pass *is* the input, exactly as with `cat`, `eslint`, or `grep`. The
invoking user is the trust boundary, no privilege boundary is crossed, and these findings
are **Low severity and accepted**. They are not remotely reachable and do not affect the
hooks (`reinject.mjs` / `workflow-gate.mjs`), which take no path input.
