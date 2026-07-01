#!/usr/bin/env python3
"""
Generate the brand-colored documentation diagrams (assets/diagram-*.svg).

These replace the plain GitHub mermaid blocks in docs/ with the same animated, on-brand
visual language as assets/architecture.svg — dark radial canvas, violet→cyan palette,
rounded node cards with accent strokes, curved/straight animated flows with arrowheads,
and prefers-color-scheme light/dark. GitHub renders mermaid with its own default blue/gray
theme that cannot be brand-colored, so the diagrams are pre-rendered to SVG and embedded as
images instead.

All primitives live in scripts/svgkit.py (shared with generate-architecture-svg.py).
Pure Python standard library; offline; no third-party packages.

Layout patterns implemented:
  (i)   linear pipeline  — LR row of cards + animated arrows  (ultracode, showcase, release)
  (ii)  vertical ladder  — TD stack of cards                  (testing)
  (iii) decision tree    — diamonds + labeled yes/no branches (policy, gate)
  (iv)  sequence diagram — participant lanes + lifelines + arrowed messages + a note band
                                                              (guard flow)

Run from the repo root:
    python3 scripts/generate-doc-diagrams.py

Output: assets/diagram-ultracode.svg, diagram-policy-decision.svg, diagram-guard-sequence.svg,
        diagram-testing.svg, diagram-showcase.svg, diagram-release.svg, diagram-gate-decision.svg
"""
from __future__ import annotations

import sys

import svgkit as sk
from svgkit import (
    AMBER,
    CLAY,
    CYAN,
    GREEN,
    LILAC,
    MAGENTA,
    PINK,
    RED,
    SLATE,
    VIOLET,
)

OUT_DIR = sk.REPO_ROOT / "assets"
SCRIPT = "scripts/generate-doc-diagrams.py"


# ── small layout helpers (built on the svgkit primitives) ───────────────────
def connect_h(x_from, x_to, y, color, label=None, dur="2.4s"):
    """Straight horizontal animated flow with an arrowhead at x_to."""
    pos = ((x_from + x_to) / 2, y - 13) if label else None
    return sk.flow(d=f"M {x_from} {y} L {x_to} {y}", color=color, label=label,
                   label_pos=pos, dur=dur)


def connect_v(x, y_from, y_to, color, label=None, dur="2.4s"):
    """Straight vertical animated flow with an arrowhead at y_to."""
    pos = (x, (y_from + y_to) / 2) if label else None
    return sk.flow(d=f"M {x} {y_from} L {x} {y_to}", color=color, label=label,
                   label_pos=pos, dur=dur)


def pipeline_row(cards, *, x0, y, w, h, gap, edges_color=None):
    """Lay a row of cards left→right and connect them with horizontal flows.

    `cards` is a list of dicts: {title, sub, accent, step?, glyph?, edge?, edge_color?}.
    Returns (svg, centers) where centers are the card center x-coordinates.
    """
    parts, centers, xs = [], [], []
    x = x0
    for c in cards:
        parts.append(sk.card(x=x, y=y, w=w, h=h, accent=c["accent"], title=c["title"],
                             sub=c.get("sub"), step=c.get("step"), glyph=c.get("glyph")))
        centers.append(x + w / 2)
        xs.append(x)
        x += w + gap
    midy = y + h / 2
    for i in range(len(cards) - 1):
        col = cards[i + 1].get("edge_color") or edges_color or cards[i]["accent"]
        parts.append(connect_h(xs[i] + w, xs[i + 1], midy, col,
                               label=cards[i + 1].get("edge")))
    return "".join(parts), centers


def ladder_col(cards, *, cx, y0, w, h, gap):
    """Lay a vertical stack of cards top→bottom and connect them downward."""
    parts, ys = [], []
    y = y0
    x = cx - w / 2
    for c in cards:
        parts.append(sk.card(x=x, y=y, w=w, h=h, accent=c["accent"], title=c["title"],
                             sub=c.get("sub"), step=c.get("step"), glyph=c.get("glyph")))
        ys.append(y)
        y += h + gap
    for i in range(len(cards) - 1):
        col = cards[i + 1].get("edge_color") or cards[i]["accent"]
        parts.append(connect_v(cx, ys[i] + h, ys[i + 1], col,
                               label=cards[i + 1].get("edge")))
    return "".join(parts)


def write(name, svg):
    path = OUT_DIR / name
    path.write_text(svg + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)", file=sys.stderr)


# ── (i) linear pipeline — docs/ultracode.md ─────────────────────────────────
def build_ultracode():
    W, H = 1460, 500
    name = "diagram-ultracode.svg"
    P = [sk.svg_open(W, H, "the ultracode cost trap: ultracode forces Opus, the workflow "
                           "fans out, and unpinned stages inherit Opus by accident")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "THE ULTRACODE COST TRAP",
                        "ultracode on \u2192 session forced to Opus (xhigh) \u2192 workflow fans "
                        "out \u2192 unpinned stages inherit Opus \u2192 the whole fan-out runs "
                        "on Opus by accident"))

    w, h, gap = 210, 108, 28
    cards = [
        {"title": "ultracode on", "sub": "xhigh + dynamic workflows", "accent": VIOLET,
         "glyph": "play"},
        {"title": "session \u2192 Opus", "sub": "xhigh is Opus-only", "accent": MAGENTA,
         "glyph": "cpu", "edge": "forces"},
        {"title": "workflow fans out", "sub": "dozens of subagents", "accent": PINK,
         "glyph": "git-branch", "edge": "spawns"},
        {"title": "stages inherit", "sub": "the session model", "accent": AMBER,
         "glyph": "alert", "edge": "no pin"},
        {"title": "all Opus", "sub": "by accident", "accent": RED,
         "glyph": "alert", "edge": "result"},
        {"title": "ultracost", "sub": "pin per stage, then verify", "accent": GREEN,
         "glyph": "check-circle", "edge": "fix"},
    ]
    row, centers = pipeline_row(cards, x0=50, y=130, w=w, h=h, gap=gap)
    P.append(row)

    # feeder: the built-in guidance that makes inheritance the default, joining "stages inherit"
    fx, fy, fw, fh = 690, 320, 290, 84
    P.append(sk.card(x=fx, y=fy, w=fw, h=fh, accent=SLATE,
                     title="built-in guidance", sub="omit the per-agent model",
                     glyph="file-text"))
    inherit_cx = centers[3]
    P.append(sk.flow(d=f"M {fx + fw / 2} {fy} C {fx + fw / 2} {fy - 40}, "
                       f"{inherit_cx} {238 + 20}, {inherit_cx} 238",
                     color=SLATE, label="default", label_pos=(fx + fw / 2 + 6, 290),
                     dur="2.8s"))

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


# ── (i) linear pipeline — docs/SHOWCASE.md ──────────────────────────────────
def build_showcase():
    W, H = 1500, 470
    name = "diagram-showcase.svg"
    P = [sk.svg_open(W, H, "a live ultracode run: policy injected, Claude pins every stage, "
                           "the guard confirms, the gate hard-stops with the estimate, you "
                           "approve, then the loop reconciles")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "ULTRACOST ON A LIVE ULTRACODE RUN",
                        "SessionStart injects the policy \u2192 Claude authors a fully-pinned "
                        "workflow \u2192 the guard confirms \u2192 the gate hard-stops with the "
                        "estimate \u2192 Approve / Modify / Cancel \u2192 the closed loop"))

    cards = [
        {"step": "1 \u00b7 INJECT", "title": "SessionStart", "sub": "injects the policy",
         "accent": LILAC, "glyph": "file-text"},
        {"step": "AUTHOR", "title": "Claude pins", "sub": "every agent() stage",
         "accent": GREEN, "glyph": "code", "edge": "authors"},
        {"step": "2 \u00b7 GUARD", "title": "guard confirms", "sub": "every stage pins a model",
         "accent": PINK, "glyph": "shield", "edge": "scan"},
        {"step": "3 \u00b7 GATE", "title": "PreToolUse stops", "sub": "+ shows the estimate",
         "accent": AMBER, "glyph": "alert", "edge": "launch"},
        {"step": "3 \u00b7 CONFIRM", "title": "Approve / Modify", "sub": "/ Cancel \u00b7 AskUserQuestion",
         "accent": CYAN, "glyph": "command", "edge": "ask"},
        {"step": "4 \u00b7 LOOP", "title": "reconcile", "sub": "calibrate \u00b7 ledger",
         "accent": GREEN, "glyph": "activity", "edge": "after run"},
    ]
    row, _ = pipeline_row(cards, x0=50, y=150, w=222, h=120, gap=24)
    P.append(row)

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


# ── (i) linear pipeline (with a fan) — docs/PUBLISHING.md ────────────────────
def build_release():
    W, H = 1240, 470
    name = "diagram-release.svg"
    P = [sk.svg_open(W, H, "release pipeline: a vX.Y.Z tag runs CI tests, which cuts a "
                           "GitHub Release and publishes to npm")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "RELEASE PIPELINE",
                        "push a vX.Y.Z tag \u2192 CI runs the tests \u2192 a GitHub Release "
                        "(generated notes) + npm publish (when NPM_TOKEN is set)"))

    P.append(sk.card(x=50, y=190, w=250, h=92, accent=VIOLET,
                     title="git tag vX.Y.Z", sub="+ push", glyph="git-branch"))
    P.append(sk.card(x=390, y=190, w=240, h=92, accent=CYAN,
                     title="CI runs tests", sub="node 24 / 26", glyph="cpu"))
    P.append(sk.card(x=730, y=80, w=290, h=92, accent=MAGENTA,
                     title="GitHub Release", sub="generated notes", glyph="tag"))
    P.append(sk.card(x=730, y=300, w=290, h=92, accent=GREEN,
                     title="npm publish", sub="when NPM_TOKEN is set", glyph="package"))

    P.append(connect_h(300, 390, 236, VIOLET, label="push"))
    P.append(sk.flow(d="M 630 226 C 690 226, 690 126, 730 126", color=MAGENTA,
                     label="release", label_pos=(686, 150), dur="2.4s"))
    P.append(sk.flow(d="M 630 246 C 690 246, 690 346, 730 346", color=GREEN,
                     label="publish", label_pos=(686, 318), dur="2.6s"))

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


# ── (ii) vertical ladder — docs/TESTING.md ──────────────────────────────────
def build_testing():
    W, H = 820, 700
    name = "diagram-testing.svg"
    P = [sk.svg_open(W, H, "the manual test ladder: sandbox install, deterministic proof, "
                           "plugin install, npm link, then a live ultracode run")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "MANUAL TEST LADDER",
                        "zero-risk sandbox \u2192 deterministic proof \u2192 plugin & npm "
                        "installs \u2192 a live ultracode run"))

    cards = [
        {"step": "STEP 1 \u00b7 SAFE", "title": "sandbox install",
         "sub": "throwaway CLAUDE_CONFIG_DIR", "accent": GREEN, "glyph": "box"},
        {"step": "STEP 2 \u00b7 SAFE", "title": "deterministic proof",
         "sub": "audit + check (read-only)", "accent": GREEN, "glyph": "shield",
         "edge": "then"},
        {"step": "STEP 3 \u00b7 ~/.claude", "title": "plugin, local",
         "sub": "marketplace or --plugin-dir", "accent": AMBER, "glyph": "command",
         "edge": "then"},
        {"step": "STEP 4 \u00b7 ~/.claude", "title": "npm link",
         "sub": "ultracost on your PATH", "accent": AMBER, "glyph": "package",
         "edge": "then"},
        {"step": "STEP 5 \u00b7 ~/.claude", "title": "live ultracode run",
         "sub": "the end-to-end proof", "accent": CLAY, "glyph": "play", "edge": "then"},
    ]
    P.append(ladder_col(cards, cx=W / 2, y0=110, w=540, h=86, gap=30))

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


# ── (iii) decision tree — docs/policy.md ────────────────────────────────────
def build_policy():
    W, H = 1160, 760
    name = "diagram-policy-decision.svg"
    P = [sk.svg_open(W, H, "how a stage's tier is chosen: if it must decide how to change "
                           "code use opus, else if it is search or mechanical use sonnet, "
                           "else the tieBreaker (opus)")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "HOW A STAGE'S TIER IS CHOSEN",
                        "decide how to change code \u2192 opus \u00b7 search / mechanical "
                        "\u2192 sonnet \u00b7 when in doubt \u2192 the tieBreaker (opus)"))

    cx = 470
    # agent() stage
    P.append(sk.card(x=cx - 130, y=96, w=260, h=68, accent=LILAC,
                     title="agent() stage", sub=None, glyph="code"))
    # decision 1
    P.append(sk.diamond(cx=cx, cy=250, rx=175, ry=92, accent=AMBER,
                        label="Must it DECIDE how to write or change code?", sub_wrap=20))
    P.append(connect_v(cx, 164, 158, LILAC))  # stage -> diamond (short)
    # yes -> opus (right)
    P.append(sk.card(x=820, y=216, w=240, h=72, accent=VIOLET,
                     title="opus tier", sub="model: opus \u00b7 effort: xhigh", glyph="cpu"))
    P.append(connect_h(cx + 175, 820, 250, VIOLET, label="yes"))
    # no -> decision 2 (down)
    P.append(sk.diamond(cx=cx, cy=500, rx=190, ry=98, accent=AMBER,
                        label="Search / collection / formatting, or a pre-planned mechanical edit?",
                        sub_wrap=24))
    P.append(connect_v(cx, 342, 402, AMBER, label="no"))
    # yes -> sonnet (left)
    P.append(sk.card(x=80, y=466, w=240, h=72, accent=CYAN,
                     title="sonnet tier", sub="model: sonnet \u00b7 effort: high", glyph="activity"))
    P.append(sk.flow(d=f"M {cx - 190} 500 L 320 500", color=CYAN,
                     label="yes", label_pos=((cx - 190 + 320) / 2, 487), dur="2.4s"))
    # unsure -> tieBreaker (right)
    P.append(sk.card(x=820, y=466, w=260, h=72, accent=LILAC,
                     title="tieBreaker", sub="default: opus", glyph="sliders"))
    P.append(connect_h(cx + 190, 820, 500, LILAC, label="unsure"))
    # all -> effort
    P.append(sk.card(x=cx - 280, y=660, w=560, h=72, accent=GREEN,
                     title="pick the lowest effort that fits", sub="capped by the model",
                     glyph="sliders"))
    P.append(sk.flow(d="M 940 288 C 940 600, 600 600, 520 656", color=VIOLET, dur="2.8s"))
    P.append(sk.flow(d="M 200 538 C 200 620, 360 640, 420 656", color=CYAN, dur="2.8s"))
    P.append(sk.flow(d="M 950 538 C 950 620, 640 645, 560 656", color=LILAC, dur="3.0s"))

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


# ── (iii) decision tree — docs/ESTIMATES.md ─────────────────────────────────
def build_gate():
    W, H = 1280, 1110
    name = "diagram-gate-decision.svg"
    P = [sk.svg_open(W, H, "the pre-flight cost gate decision: if the gate is off allow, "
                           "else run the guard and estimate; deny over-budget; deny unpinned "
                           "in bypass or strict; otherwise ask with the estimate")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "THE PRE-FLIGHT COST GATE",
                        "ULTRACOST_GATE=off \u2192 allow \u00b7 over budget \u2192 deny \u00b7 "
                        "unpinned in bypass / =strict \u2192 deny \u00b7 otherwise \u2192 ask "
                        "with the estimate"))

    cx = 520
    # workflow launch
    P.append(sk.card(x=cx - 175, y=96, w=350, h=68, accent=CLAY,
                     title="Workflow launch", sub="PreToolUse fires", glyph="play"))
    # M: gate off?
    P.append(sk.diamond(cx=cx, cy=250, rx=160, ry=84, accent=AMBER,
                        label="ULTRACOST_GATE = off?", sub_wrap=18))
    P.append(connect_v(cx, 164, 166, CLAY))
    # allow (right)
    P.append(sk.card(x=950, y=214, w=250, h=72, accent=GREEN,
                     title="allow", sub="gate disabled", glyph="check-circle"))
    P.append(connect_h(cx + 160, 950, 250, GREEN, label="yes"))
    # E: run guard + estimate
    P.append(sk.card(x=cx - 175, y=362, w=350, h=70, accent=CYAN,
                     title="run the guard + estimate", sub="calibrated, offline", glyph="activity"))
    P.append(connect_v(cx, 334, 362, AMBER, label="no"))
    # B: over budget?
    P.append(sk.diamond(cx=cx, cy=560, rx=170, ry=90, accent=AMBER,
                        label="over budget.perRun / perDay?", sub_wrap=20))
    P.append(connect_v(cx, 432, 470, CYAN))
    # deny (shared, right)
    P.append(sk.card(x=950, y=520, w=270, h=84, accent=RED,
                     title="deny", sub="hard budget cap, or unpinned in bypass / =strict",
                     glyph="alert"))
    P.append(sk.flow(d=f"M {cx + 170} 560 C 800 560, 860 562, 950 562", color=RED,
                     label="yes (unless =ask)", label_pos=(800, 548), dur="2.2s"))
    # P: unpinned?
    P.append(sk.diamond(cx=cx, cy=820, rx=185, ry=98, accent=AMBER,
                        label="any stage unpinned / banned / inherit?", sub_wrap=22))
    P.append(connect_v(cx, 650, 722, AMBER, label="no"))
    # P -> deny (bypass/strict), curve up-right
    P.append(sk.flow(d=f"M {cx + 185} 820 C 820 820, 980 700, 1010 604", color=RED,
                     label="bypass / =strict", label_pos=(880, 760), dur="2.6s"))
    # ask + warning (lower-left)
    P.append(sk.card(x=70, y=880, w=300, h=84, accent=AMBER,
                     title="ask + \u26a0 warning", sub="+ the estimate (interactive)",
                     glyph="alert"))
    P.append(sk.flow(d=f"M {cx - 185} 820 C 360 820, 240 844, 220 880", color=AMBER,
                     label="interactive", label_pos=(330, 832), dur="2.6s"))
    # ask + estimate (down)
    P.append(sk.card(x=cx - 160, y=980, w=320, h=72, accent=GREEN,
                     title="ask + estimate", sub="all stages pinned", glyph="command"))
    P.append(connect_v(cx, 918, 980, GREEN, label="no"))

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


# ── (iv) sequence diagram — docs/architecture.md (Workflow Guard) ───────────
def build_guard_sequence():
    W, H = 1240, 640
    name = "diagram-guard-sequence.svg"
    P = [sk.svg_open(W, H, "the Workflow Guard sequence: you prompt Claude Code, it writes a "
                           "workflow script guided by the injected policy, launches the "
                           "Workflow, and the PreToolUse gate scans every stage and estimates "
                           "cost before any subagent runs")]
    P.append(sk.defs())
    P.append(sk.canvas(W, H))
    P.append(sk.heading(50, 52, "THE WORKFLOW GUARD \u00b7 PRETOOLUSE FLOW",
                        "you prompt \u2192 Claude authors a workflow \u2192 ultracost scans "
                        "every agent() stage and estimates cost before any subagent runs"))

    lanes = [
        ("You", "the human", SLATE, "user"),
        ("Claude Code", "ultracode", CLAY, "cpu"),
        ("workflow script", "agent() stages", VIOLET, "code"),
        ("ultracost gate", "check + PreToolUse", AMBER, "shield"),
    ]
    lane_x = [160, 480, 800, 1110]
    top, bottom = 168, 580
    lane_w, lane_h = 250, 74
    for (title, sub, accent, glyph), x in zip(lanes, lane_x):
        P.append(sk.card(x=x - lane_w / 2, y=96, w=lane_w, h=lane_h, accent=accent,
                         title=title, sub=sub, glyph=glyph, dot=False))
        P.append(sk.lifeline(cx=x, top=top, bottom=bottom, color=accent))

    U, CC, FS, FT = lane_x
    # m1 You -> Claude Code
    P.append(sk.message(x1=U, x2=CC, y=210, color=SLATE, label="prompt"))
    # m2 Claude Code -> workflow script
    P.append(sk.message(x1=CC, x2=FS, y=262, color=CLAY,
                        label="writes agent()/parallel()/pipeline()"))
    # note over Claude Code .. workflow script
    P.append(sk.note_band(x=CC - 120, y=296, w=(FS + 120) - (CC - 120), h=52, accent=LILAC,
                          text="SessionStart-injected policy guides per-stage model pins"))
    # m3 Claude Code -> ultracost gate
    P.append(sk.message(x1=CC, x2=FT, y=400, color=AMBER,
                        label="launches the Workflow (PreToolUse fires)"))
    # m4 ultracost gate -> workflow script (scan, leftward)
    P.append(sk.message(x1=FT, x2=FS, y=458, color=CYAN,
                        label="scan agent() call sites + estimate cost"))
    # m5 ultracost gate --> You (return, dashed, leftward)
    P.append(sk.message(x1=FT, x2=U, y=534, color=PINK, dashed=True,
                        label="flag unpinned stages \u00b7 ask / deny before any subagent runs"))

    P.append(sk.footer(W, H, name, script=SCRIPT))
    P.append("</svg>")
    write(name, "".join(P))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_ultracode()
    build_showcase()
    build_release()
    build_testing()
    build_policy()
    build_gate()
    build_guard_sequence()


if __name__ == "__main__":
    main()
