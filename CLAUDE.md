# CLAUDE.md

This file guides AI agents (and humans) working **on the ultracost repository itself**.

See [AGENTS.md](AGENTS.md) for the full repo development guidance: structure map, how to run tests, and the invariants to keep green.

**Hard rule:** for every new feature, after `npm test` + the dogfood guard, you MUST also
live-verify it by installing the plugin **from this local working copy** into Claude Code
(`claude plugin marketplace add ~/projects/ultracost` + `claude plugin install ultracost@ultracost`,
or `claude --plugin-dir ~/projects/ultracost`), turning on ultracode (`/effort ultracode`),
and confirming the behavior with prompts to Claude Code before claiming it works. The npm
CLI path (`node bin/cli.js init`) does NOT satisfy this. See [AGENTS.md](AGENTS.md)
("Live verification"). Test in isolation is not enough.

**Versioning:** bump the **patch** version only (`0.4.x`) by default. Never bump the minor
or major version unless the user explicitly asks for it. Keep `package.json`,
`.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` in sync (enforced by
`tests/version-sync.test.js`).

> **Not** to be confused with the routing block ultracost *injects* into a user's
> `~/.claude/CLAUDE.md`. That generated block (delimited by `<!-- ultracost:start -->`
> / `<!-- ultracost:end -->`) is compiled from `policy.json` and is a **product artifact**.
> This file is about developing ultracost, not about using it.
