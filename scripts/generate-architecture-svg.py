#!/usr/bin/env python3
"""
Generate assets/architecture.svg — the animated "live architecture" diagram for the
README and docs/architecture.md.

Hand-crafted (not mermaid) so we get a living system map:
  - SMIL data-flow animation on every edge (stroke-dashoffset)
  - pulsing endpoint dots on every active node
  - subtle radial-gradient subsystem backdrops in the ultracost violet/cyan theme
  - real vendor logos (simple-icons, CC0) for the tech nodes, vendored locally
  - lightweight Feather-style glyphs (MIT) for the src/ core modules
  - dark + light rendering via prefers-color-scheme

What it depicts (precise to the real code):
  - ONE source of truth (policy.json) loaded by the shared src/ core
  - the src/ core grouped by capability (policy/rules/guard+lexer+classify/estimate+
    pricing/closed-loop/delivery), compiling into TWO surfaces
  - the Claude Code plugin (SessionStart hook, PreToolUse cost gate, routing skill,
    slash commands) and the npm CLI (15 verbs + the CLAUDE.md block)
  - the ultracode runtime: policy injected -> Claude authors the workflow -> the
    PreToolUse gate (guard + estimate) hard-stops the launch
  - the closed loop: a run's transcripts -> reconcile -> calibrate (feeds the
    estimator) -> the savings ledger

Offline by design: logos are read from scripts/icons/*.svg (committed), no network.

The brand primitives (palette, node cards, flows, subsystem boxes, CSS, the vendored
logos) live in scripts/svgkit.py and are shared with scripts/generate-doc-diagrams.py.

Run from the repo root:
    python3 scripts/generate-architecture-svg.py

Output: assets/architecture.svg
"""
from __future__ import annotations

import sys

from svgkit import (
    AMBER,
    ARROW_COLORS,
    CSS,
    CYAN,
    GREEN,
    LILAC,
    MAGENTA,
    PINK,
    REPO_ROOT,
    VIOLET,
    arrow_marker,
    curve,
    flow,
    gradient,
    logo_symbols,
    node,
    subsystem_box,
)

OUT_PATH = REPO_ROOT / "assets" / "architecture.svg"

# ── the diagram ─────────────────────────────────────────────────────────────
W, H = 1520, 1050


def build_svg() -> str:
    P = []
    P.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'role="img" aria-label="ultracost architecture diagram">'
    )
    P.append(f"<style>{CSS}</style>")

    # defs
    P.append("<defs>")
    P.append(logo_symbols())
    P.append(
        '<radialGradient id="bg-canvas" cx="50%" cy="0%" r="120%">'
        '<stop offset="0%" stop-color="#1d1033"/>'
        '<stop offset="100%" stop-color="#080510"/></radialGradient>'
    )
    P.append(gradient("bg-truth",   "#2a1a4a", "#160d2e"))
    P.append(gradient("bg-core",    "#3b1d62", "#1e0b3a"))
    P.append(gradient("bg-plugin",  "#4a1660", "#2a0838"))
    P.append(gradient("bg-cli",     "#241b53", "#120f36"))
    P.append(gradient("bg-runtime", "#42104f", "#22052e"))
    P.append(gradient("bg-loop",    "#143a3f", "#0a1f29"))
    for c in ARROW_COLORS:
        P.append(arrow_marker(c))
    P.append("</defs>")

    # canvas + heading
    P.append(f'<rect width="{W}" height="{H}" fill="url(#bg-canvas)"/>')
    P.append(f'<text x="40" y="50" class="h1">ULTRACOST &#183; LIVE ARCHITECTURE</text>')
    P.append(
        f'<text x="40" y="76" class="legend">'
        f"One source of truth (policy.json) &#8594; one shared src/ core &#8594; two delivery surfaces "
        f"&#8226; the guard + cost gate verify every workflow stage &#8226; the closed loop "
        f"reconciles &amp; calibrates from real runs &#8226; dots are live (animated)"
        f"</text>"
    )

    # ── subsystem boxes ──────────────────────────────────────────────
    P.append(subsystem_box(x=40,   y=110, w=240, h=300, title="Source of truth",
                           fill_id="bg-truth", stroke="#7c3aed"))
    P.append(subsystem_box(x=320,  y=110, w=360, h=640, title="Shared core \u00b7 src/",
                           fill_id="bg-core", stroke="#a855f7"))
    P.append(subsystem_box(x=720,  y=110, w=360, h=300, title="Claude Code plugin \u00b7 PRIMARY",
                           fill_id="bg-plugin", stroke="#c026d3"))
    P.append(subsystem_box(x=720,  y=438, w=360, h=312, title="npm CLI \u00b7 secondary",
                           fill_id="bg-cli", stroke="#6366f1"))
    P.append(subsystem_box(x=1120, y=110, w=360, h=640, title="Claude Code \u00b7 ultracode runtime",
                           fill_id="bg-runtime", stroke="#d946ef"))
    P.append(subsystem_box(x=40,   y=782, w=1440, h=200, title="Closed loop \u00b7 measure \u2192 reconcile \u2192 calibrate \u2192 ledger (offline)",
                           fill_id="bg-loop", stroke="#14b8a6"))

    # ── nodes ────────────────────────────────────────────────────────
    # Source of truth
    P.append(node(cx=160, cy=270, logo="json", label="policy.json",
                  sublabel="tiers \u00b7 effort \u00b7 prices", accent=LILAC))

    # Shared core (src/) — grouped; sublabels name the rest of the 13 modules
    CX = 500
    P.append(node(cx=CX, cy=175, glyph="sliders", label="policy.js",
                  sublabel="load \u00b7 validate \u00b7 normalize", accent="#c4b5fd"))
    P.append(node(cx=CX, cy=270, glyph="file-text", label="rules.js",
                  sublabel="compile \u2192 routing block", accent="#d8b4fe"))
    P.append(node(cx=CX, cy=365, glyph="shield", label="guard.js",
                  sublabel="lexer + classify \u00b7 UC001\u201308", accent="#e879f9"))
    P.append(node(cx=CX, cy=460, glyph="activity", label="estimate.js",
                  sublabel="pricing.js \u00b7 vs all-opus", accent="#22d3ee"))
    P.append(node(cx=CX, cy=555, glyph="tag", label="loop.js",
                  sublabel="transcript + cost \u00b7 ledger", accent="#34d399"))
    P.append(node(cx=CX, cy=650, glyph="command", label="detect / install",
                  sublabel="render.js \u00b7 paths \u00b7 delivery", accent="#94a3b8"))

    # Plugin (PRIMARY)
    SX = 900
    P.append(node(cx=SX, cy=185, logo="anthropic", label="routing skill",
                  sublabel="always-relevant policy", accent="#e9d5ff"))
    P.append(node(cx=SX, cy=270, glyph="command", label="slash commands",
                  sublabel="/ultracost:check \u00b7 \u2026", accent="#f0abfc"))
    P.append(node(cx=SX, cy=355, logo="nodedotjs", label="hooks.json",
                  sublabel="SessionStart + PreToolUse", accent="#a3e635"))

    # CLI (secondary)
    P.append(node(cx=SX, cy=520, logo="npm", label="bin/cli.js",
                  sublabel="15 verbs \u00b7 npx ultracost", accent="#f9a8d4"))
    P.append(node(cx=SX, cy=620, glyph="file-text", label="CLAUDE.md block",
                  sublabel="injected rules + hook", accent="#818cf8"))

    # Runtime
    RX = 1300
    P.append(node(cx=RX, cy=210, logo="anthropic", label="SessionStart",
                  sublabel="policy as context", accent="#f0abfc"))
    P.append(node(cx=RX, cy=375, glyph="terminal", label="workflow script",
                  sublabel="agent() stages \u00b7 pinned", accent="#d946ef"))
    P.append(node(cx=RX, cy=540, glyph="shield", label="PreToolUse gate",
                  sublabel="guard + estimate \u00b7 stop", accent=AMBER))

    # Closed loop band
    P.append(node(cx=240,  cy=888, glyph="database", label="transcripts",
                  sublabel="wf_*/agent-*.jsonl", accent="#5eead4"))
    P.append(node(cx=620,  cy=888, glyph="activity", label="usage / reconcile",
                  sublabel="real cost \u00b7 est vs actual", accent="#22d3ee"))
    P.append(node(cx=1000, cy=888, glyph="sliders", label="calibrate",
                  sublabel="token prior", accent="#c4b5fd"))
    P.append(node(cx=1340, cy=888, glyph="tag", label="ledger",
                  sublabel="cumulative savings", accent="#34d399"))

    # ── flows ────────────────────────────────────────────────────────
    # policy.json -> policy.js (load)
    P.append(flow(d=curve(260, 270, 400, 175, 0.55), color=VIOLET,
                  label="load", label_pos=(330, 214)))
    # core internal: policy.js -> rules.js
    P.append(flow(d="M 500 219 L 500 240", color=VIOLET, dur="1.6s"))

    # rules.js -> skill + CLAUDE.md block (compile to both surfaces)
    P.append(flow(d=curve(600, 268, 800, 185, 0.5), color=MAGENTA,
                  label="compile", label_pos=(700, 212), dur="2.4s"))
    P.append(flow(d=curve(600, 282, 800, 620, 0.5), color=MAGENTA, dashed=True, dur="2.8s"))

    # guard.js -> slash commands + bin/cli.js
    P.append(flow(d=curve(600, 360, 800, 270, 0.5), color=PINK,
                  label="scan", label_pos=(700, 300), dur="2.2s"))
    P.append(flow(d=curve(600, 370, 800, 520, 0.5), color=PINK, dur="2.6s"))

    # estimate.js -> the gate (via hooks.json) + bin/cli.js
    P.append(flow(d=curve(600, 455, 800, 355, 0.5), color=CYAN,
                  label="estimate", label_pos=(706, 398), dur="2.0s"))
    P.append(flow(d=curve(600, 465, 800, 522, 0.5), color=CYAN, dur="2.4s"))

    # loop.js -> bin/cli.js (closed-loop verbs live in the CLI)
    P.append(flow(d=curve(600, 555, 800, 525, 0.5), color=GREEN, dur="2.6s"))
    # detect/install -> CLAUDE.md block (install writes the block + registers the hook)
    P.append(flow(d=curve(600, 648, 800, 624, 0.5), color="#94a3b8", dur="2.8s"))

    # plugin hooks -> runtime (SessionStart inject + PreToolUse gate)
    P.append(flow(d=curve(1000, 350, 1200, 210, 0.5), color=LILAC,
                  label="inject", label_pos=(1095, 268), dur="2.4s"))
    P.append(flow(d=curve(1000, 360, 1200, 540, 0.5), color=AMBER,
                  label="gate", label_pos=(1078, 408), dur="1.8s"))
    # CLAUDE.md block -> SessionStart (CLI path inject)
    P.append(flow(d=curve(1000, 616, 1200, 222, 0.62), color=LILAC, dashed=True, dur="3.0s"))

    # runtime: SessionStart -> workflow script (Claude authors with the policy)
    P.append(flow(d="M 1300 254 L 1300 345", color=GREEN,
                  label="authors", label_pos=(1370, 300), dur="2.2s"))
    # workflow launch -> the gate
    P.append(flow(d="M 1300 419 L 1300 510", color=AMBER,
                  label="launch", label_pos=(1366, 466), dur="1.8s"))
    # gate -> workflow (approve / cancel)
    P.append(flow(d="M 1190 540 C 1140 500, 1140 412, 1190 374", color=AMBER,
                  label="approve / cancel", label_pos=(1132, 500), dur="2.0s"))

    # closed loop: gate/run -> transcripts (sweep through the gap below the boxes)
    P.append(flow(d="M 1300 584 C 1300 766, 520 766, 250 855", color=GREEN,
                  label="run \u2192 transcripts", label_pos=(840, 766), dur="2.8s"))
    # transcripts -> reconcile -> calibrate -> ledger
    P.append(flow(d="M 340 888 L 500 888", color="#5eead4", label="parse", label_pos=(420, 868), dur="1.8s"))
    P.append(flow(d="M 720 888 L 880 888", color=CYAN, label="learn", label_pos=(800, 868), dur="1.8s"))
    P.append(flow(d="M 1100 888 L 1220 888", color=GREEN, label="persist", label_pos=(1160, 868), dur="1.8s"))
    # loop.js drives the reconcile/calibrate/ledger band
    P.append(flow(d="M 470 590 C 430 700, 520 820, 600 855", color="#5eead4", dashed=True, dur="2.6s"))
    # calibrate -> estimate.js (the feedback that closes the loop)
    P.append(flow(d="M 1000 854 C 940 700, 720 470, 602 462", color=CYAN,
                  label="feeds estimate", label_pos=(720, 600), dashed=True, dur="3.0s"))

    # ── legend ───────────────────────────────────────────────────────
    ly = 1024
    P.append(f'<text x="40" y="{ly}" class="legend-h">FLOW LEGEND</text>')
    items = [
        (VIOLET, "load / normalize"),
        (MAGENTA, "compile \u2192 surfaces"),
        (PINK, "guard"),
        (CYAN, "estimate / calibrate"),
        (LILAC, "inject policy"),
        (AMBER, "cost gate"),
        (GREEN, "author / run / loop"),
    ]
    lx = 190
    for color, txt in items:
        P.append(
            f'<line x1="{lx}" y1="{ly - 4}" x2="{lx + 26}" y2="{ly - 4}" '
            f'stroke="{color}" stroke-width="3" stroke-linecap="round"/>'
        )
        P.append(f'<text x="{lx + 33}" y="{ly}" class="legend">{txt}</text>')
        lx += max(150, len(txt) * 7 + 64)

    # footer
    P.append(
        f'<text x="{W - 16}" y="{H - 8}" text-anchor="end" class="footer">'
        f"assets/architecture.svg \u00b7 regenerate via scripts/generate-architecture-svg.py</text>"
    )

    P.append("</svg>")
    return "\n".join(P)


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(build_svg())
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
