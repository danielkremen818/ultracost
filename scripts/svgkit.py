#!/usr/bin/env python3
"""
svgkit — the shared, zero-dependency brand-SVG toolkit for ultracost's docs.

This is pure Python standard library (string building only — no XML/jinja/etc.) so it
runs with the repo's existing toolchain (`python3`) and adds no dependencies. It is the
single home for the ultracost visual language used by every generated diagram:

  - the brand palette (mirrors src/render.js COLORS)
  - rounded node cards (accent stroke + optional pulsing dot)
  - subsystem boxes (radial-gradient backdrops)
  - curved + straight animated data-flow edges (arrow markers + a moving dash overlay)
  - decision diamonds and yes/no branch labels
  - sequence-diagram lifelines, arrowed messages, and note bands
  - the dark radial canvas + prefers-color-scheme light/dark CSS
  - the standard heading and "regenerate via scripts/..." footer

Two generators import from here:
  - scripts/generate-architecture-svg.py  -> assets/architecture.svg
  - scripts/generate-doc-diagrams.py      -> assets/diagram-*.svg

Offline by design: no network, no third-party packages.
"""
from __future__ import annotations

import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
ICON_DIR = REPO_ROOT / "scripts" / "icons"

# ── brand palette (mirrors src/render.js COLORS) ────────────────────────────
VIOLET = "#a78bfa"   # load / normalize flows
MAGENTA = "#e879f9"  # compile -> surfaces flows
PINK = "#f472b6"     # guard flows
CYAN = "#22d3ee"     # estimate / pricing / calibration-feedback flows
LILAC = "#c4b5fd"    # runtime policy injection flows
AMBER = "#fbbf24"    # the cost gate (one warm accent — it is a stop)
GREEN = "#34d399"    # author + run + closed loop
RED = "#fb7185"      # deny / failure
CLAY = "#d97757"     # Claude / runtime accent
SLATE = "#94a3b8"    # neutral / support

ARROW_COLORS = (VIOLET, MAGENTA, PINK, CYAN, LILAC, AMBER, GREEN)

# The full palette any generator may emit arrow markers for.
ALL_COLORS = (VIOLET, MAGENTA, PINK, CYAN, LILAC, AMBER, GREEN, RED, CLAY, SLATE)

NODE_FILL = "rgba(20, 9, 36, 0.62)"

# Vendored simple-icons (CC0). slug -> theme fill colour.
LOGOS = {
    "json": LILAC,
    "nodedotjs": "#a3e635",   # node keeps a hint of green so the eye reads "node"
    "npm": "#f9a8d4",
    "anthropic": "#e9d5ff",   # Claude mark, tinted to the lilac theme
}

# Feather-style glyphs (MIT), stroke-rendered. Used for src/ core modules + doc cards.
GLYPHS = {
    "sliders": (
        '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>'
        '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>'
        '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>'
        '<line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>'
        '<line x1="17" y1="16" x2="23" y2="16"/>'
    ),
    "file-text": (
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
        '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>'
        '<line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'
    ),
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    "activity": '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    "tag": (
        '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 '
        '2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'
    ),
    "terminal": (
        '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'
    ),
    "command": (
        '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 '
        '0-3 3h12a3 3 0 0 0 0-6z"/>'
    ),
    "database": (
        '<ellipse cx="12" cy="5" rx="9" ry="3"/>'
        '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>'
        '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'
    ),
    "package": (
        '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>'
        '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 '
        '2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'
        '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
    ),
    "play": '<polygon points="5 3 19 12 5 21 5 3"/>',
    "git-branch": (
        '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/>'
        '<circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'
    ),
    "check-circle": (
        '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>'
        '<polyline points="22 4 12 14.01 9 11.01"/>'
    ),
    "alert": (
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 '
        '3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/>'
        '<line x1="12" y1="17" x2="12.01" y2="17"/>'
    ),
    "cpu": (
        '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>'
        '<rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/>'
        '<line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/>'
        '<line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/>'
        '<line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/>'
        '<line x1="1" y1="14" x2="4" y2="14"/>'
    ),
    "user": (
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>'
        '<circle cx="12" cy="7" r="4"/>'
    ),
    "code": (
        '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'
    ),
    "search": (
        '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    ),
    "box": (
        '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 '
        '2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'
        '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
    ),
}


def esc(s: str) -> str:
    """Escape text for use in SVG text nodes."""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def extract_path(slug: str) -> str:
    txt = (ICON_DIR / f"{slug}.svg").read_text()
    m = re.search(r'<path\s+d="([^"]+)"', txt)
    if not m:
        raise RuntimeError(f'no <path d="..."> in {slug}.svg')
    return m.group(1)


def logo_symbols() -> str:
    out = []
    for slug, color in LOGOS.items():
        out.append(
            f'<symbol id="logo-{slug}" viewBox="0 0 24 24">'
            f'<path d="{extract_path(slug)}" fill="{color}"/></symbol>'
        )
    return "\n    ".join(out)


def glyph_markup(kind: str, *, x: float, y: float, size: float, color: str) -> str:
    s = size / 24.0
    return (
        f'<g transform="translate({x} {y}) scale({s:.4f})" fill="none" '
        f'stroke="{color}" stroke-width="2" stroke-linecap="round" '
        f'stroke-linejoin="round">{GLYPHS[kind]}</g>'
    )


# ── geometry helpers ────────────────────────────────────────────────────────
def subsystem_box(*, x, y, w, h, title, fill_id, stroke) -> str:
    return (
        f'<g class="subsystem">'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" '
        f'fill="url(#{fill_id})" stroke="{stroke}" stroke-width="1.5"/>'
        f'<text x="{x + 18}" y="{y + 28}" class="title">{title}</text></g>'
    )


def node(*, cx, cy, label, sublabel, accent, logo=None, glyph=None, href=None, w=200) -> str:
    """A node card: 34px icon + bold label + dim sublabel + pulsing dot."""
    g_open = f'<a href="{href}" target="_blank">' if href else "<g>"
    g_close = "</a>" if href else "</g>"
    left = cx - w / 2
    if logo:
        icon = f'<use href="#logo-{logo}" x="{left + 8}" y="{cy - 17}" width="34" height="34"/>'
    else:
        icon = glyph_markup(glyph, x=left + 8, y=cy - 17, size=34, color=accent)
    return (
        f"{g_open}"
        f'<rect x="{left}" y="{cy - 30}" width="{w}" height="74" rx="11" '
        f'fill="rgba(20, 9, 36, 0.62)" stroke="{accent}" stroke-width="1" '
        f'stroke-opacity="0.5"/>'
        f"{icon}"
        f'<text x="{left + 54}" y="{cy - 3}" class="node-label">{label}</text>'
        f'<text x="{left + 54}" y="{cy + 16}" class="node-sub">{sublabel}</text>'
        f'<g transform="translate({cx + w / 2 - 10}, {cy - 20})">'
        f'<circle r="4" fill="{accent}">'
        f'<animate attributeName="r" values="3;7;3" dur="2.4s" repeatCount="indefinite"/>'
        f'<animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite"/>'
        f'</circle><circle r="3" fill="{accent}"/></g>'
        f"{g_close}"
    )


def curve(x1, y1, x2, y2, bend=0.5) -> str:
    """A horizontal-leaning cubic between two points (control points on a vertical seam)."""
    mx = x1 + (x2 - x1) * bend
    return f"M {x1} {y1} C {mx} {y1}, {mx} {y2}, {x2} {y2}"


def vcurve(x1, y1, x2, y2, bend=0.5) -> str:
    """A vertical-leaning cubic between two points (control points on a horizontal seam)."""
    my = y1 + (y2 - y1) * bend
    return f"M {x1} {y1} C {x1} {my}, {x2} {my}, {x2} {y2}"


def flow(*, d, color, label=None, label_pos=None, dashed=False, dur="2.2s") -> str:
    dash = 'stroke-dasharray="6 6"' if dashed else ""
    base = (
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2" '
        f'stroke-opacity="0.5" stroke-linecap="round" {dash} '
        f'marker-end="url(#arrow-{color.strip("#")})"/>'
    )
    overlay = (
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2" '
        f'stroke-linecap="round" stroke-dasharray="2 14" stroke-opacity="0.95">'
        f'<animate attributeName="stroke-dashoffset" values="0;-32" dur="{dur}" '
        f'repeatCount="indefinite"/></path>'
    )
    out = base + overlay
    if label and label_pos:
        out += edge_label(label, label_pos[0], label_pos[1], color)
    return out


def edge_label(label: str, lx: float, ly: float, color: str) -> str:
    w = max(54, len(label) * 6.6 + 16)
    return (
        f'<g transform="translate({lx} {ly})">'
        f'<rect x="{-w/2:.1f}" y="-11" width="{w:.1f}" height="22" rx="6" '
        f'fill="rgba(10, 6, 18, 0.88)" stroke="{color}" stroke-opacity="0.45"/>'
        f'<text x="0" y="4" class="edge-label" text-anchor="middle">{esc(label)}</text></g>'
    )


def gradient(id_, c0, c1) -> str:
    return (
        f'<linearGradient id="{id_}" x1="0%" y1="0%" x2="0%" y2="100%">'
        f'<stop offset="0%" stop-color="{c0}" stop-opacity="0.9"/>'
        f'<stop offset="100%" stop-color="{c1}" stop-opacity="0.55"/></linearGradient>'
    )


def arrow_marker(color) -> str:
    cid = color.strip("#")
    return (
        f'<marker id="arrow-{cid}" viewBox="0 0 10 10" refX="9" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>'
    )


# ── the shared CSS (dark default + prefers-color-scheme light) ──────────────
CSS = """
    .title      { font: 700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
                  fill: #c4b5fd; letter-spacing: 0.09em; text-transform: uppercase; }
    .h1         { font: 700 20px -apple-system, system-ui, sans-serif; fill: #f5f3ff; letter-spacing: 0.14em; }
    .node-label { font: 600 13.5px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #faf5ff; }
    .node-sub   { font: 500 10.5px -apple-system, system-ui, sans-serif; fill: #a78bbf; }
    .edge-label { font: 600 10px -apple-system, system-ui, sans-serif; fill: #f5f3ff; }
    .legend     { font: 500 12px -apple-system, system-ui, sans-serif; fill: #a78bbf; }
    .legend-h   { font: 700 12px -apple-system, system-ui, sans-serif; fill: #e9d5ff; letter-spacing: 0.06em; text-transform: uppercase; }
    .footer     { font: 500 10px ui-monospace, Menlo, monospace; fill: #6d5a8c; }

    @media (prefers-color-scheme: light) {
      .title      { fill: #6d28d9; }
      .h1         { fill: #4c1d95; }
      .node-label { fill: #2e1065; }
      .node-sub   { fill: #6d28d9; }
      .edge-label { fill: #2e1065; }
      .legend     { fill: #6d28d9; }
      .legend-h   { fill: #5b21b6; }
      .footer     { fill: #7c6aa0; }
    }
"""

# Extra CSS classes used by the doc-diagram layouts (cards with centered text,
# diamonds, lifelines, note bands). Append after CSS in doc diagrams only — the
# architecture SVG keeps exactly the CSS above so its bytes stay stable.
DOC_CSS = """
    .card-title { font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #faf5ff; }
    .card-sub   { font: 500 11px -apple-system, system-ui, sans-serif; fill: #b9a7d6; }
    .card-step  { font: 700 11px ui-monospace, Menlo, monospace; fill: #c4b5fd; letter-spacing: 0.08em; }
    .diamond-t  { font: 700 13px -apple-system, system-ui, sans-serif; fill: #faf5ff; }
    .lane       { font: 700 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #faf5ff; }
    .lane-sub   { font: 500 10.5px -apple-system, system-ui, sans-serif; fill: #b9a7d6; }
    .note       { font: 500 12px -apple-system, system-ui, sans-serif; fill: #f5f3ff; }

    @media (prefers-color-scheme: light) {
      .card-title { fill: #2e1065; }
      .card-sub   { fill: #6d28d9; }
      .card-step  { fill: #6d28d9; }
      .diamond-t  { fill: #2e1065; }
      .lane       { fill: #2e1065; }
      .lane-sub   { fill: #6d28d9; }
      .note       { fill: #2e1065; }
    }
"""


# ── doc-diagram primitives (centered cards, diamonds, sequence parts) ───────
def _wrap_lines(text, max_chars):
    """Greedy word-wrap into <= max_chars-wide lines."""
    words = text.split()
    lines, cur = [], ""
    for w in words:
        cand = (cur + " " + w).strip()
        if len(cand) > max_chars and cur:
            lines.append(cur)
            cur = w
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines or [""]


def card(*, x, y, w, h, accent, title, sub=None, step=None, glyph=None,
         dot=True, rx=12, sub_wrap=None) -> str:
    """A centered rounded card: optional step kicker + title + wrapped sublabel.

    The accent stroke and (optional) pulsing dot match the architecture nodes.
    """
    cx = x + w / 2
    parts = [
        f'<g class="card">'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
        f'fill="{NODE_FILL}" stroke="{accent}" stroke-width="1.5" stroke-opacity="0.6"/>'
    ]
    # vertical centering of the text block
    sub_lines = []
    if sub:
        sub_lines = _wrap_lines(sub, sub_wrap if sub_wrap else max(12, int(w / 7.2)))
    n_text = (1 if step else 0) + 1 + len(sub_lines)
    line_h = 17
    block_h = n_text * line_h
    ty = y + (h - block_h) / 2 + 13
    if glyph:
        parts.append(glyph_markup(glyph, x=x + 14, y=y + h / 2 - 12, size=24, color=accent))
    if step:
        parts.append(
            f'<text x="{cx}" y="{ty}" class="card-step" text-anchor="middle">{esc(step)}</text>'
        )
        ty += line_h
    parts.append(
        f'<text x="{cx}" y="{ty}" class="card-title" text-anchor="middle">{esc(title)}</text>'
    )
    ty += line_h
    for ln in sub_lines:
        parts.append(
            f'<text x="{cx}" y="{ty}" class="card-sub" text-anchor="middle">{esc(ln)}</text>'
        )
        ty += line_h
    if dot:
        parts.append(
            f'<g transform="translate({x + w - 14}, {y + 14})">'
            f'<circle r="4" fill="{accent}">'
            f'<animate attributeName="r" values="3;6.5;3" dur="2.6s" repeatCount="indefinite"/>'
            f'<animate attributeName="opacity" values="1;0.4;1" dur="2.6s" repeatCount="indefinite"/>'
            f'</circle><circle r="3" fill="{accent}"/></g>'
        )
    parts.append("</g>")
    return "".join(parts)


def diamond(*, cx, cy, rx, ry, accent, label, sub_wrap=18) -> str:
    """A decision diamond with wrapped centered text inside."""
    pts = f"{cx},{cy - ry} {cx + rx},{cy} {cx},{cy + ry} {cx - rx},{cy}"
    parts = [
        f'<g class="decision">'
        f'<polygon points="{pts}" fill="{NODE_FILL}" stroke="{accent}" '
        f'stroke-width="1.5" stroke-opacity="0.7"/>'
    ]
    lines = _wrap_lines(label, sub_wrap)
    line_h = 17
    ty = cy - (len(lines) - 1) * line_h / 2 + 4
    for ln in lines:
        parts.append(
            f'<text x="{cx}" y="{ty}" class="diamond-t" text-anchor="middle">{esc(ln)}</text>'
        )
        ty += line_h
    parts.append("</g>")
    return "".join(parts)


def lifeline(*, cx, top, bottom, color) -> str:
    """A dashed vertical lifeline for a sequence participant."""
    return (
        f'<line x1="{cx}" y1="{top}" x2="{cx}" y2="{bottom}" stroke="{color}" '
        f'stroke-width="1.4" stroke-opacity="0.35" stroke-dasharray="3 7"/>'
    )


def note_band(*, x, y, w, h, accent, text, sub_wrap=None) -> str:
    """A rounded note band spanning one or more lanes (sequence-diagram note)."""
    cx = x + w / 2
    lines = _wrap_lines(text, sub_wrap if sub_wrap else max(20, int(w / 7.0)))
    line_h = 16
    block_h = len(lines) * line_h
    ty = y + (h - block_h) / 2 + 12
    parts = [
        f'<g class="noteband">'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" '
        f'fill="rgba(45, 22, 71, 0.66)" stroke="{accent}" stroke-width="1.2" '
        f'stroke-dasharray="5 4" stroke-opacity="0.7"/>'
    ]
    for ln in lines:
        parts.append(
            f'<text x="{cx}" y="{ty}" class="note" text-anchor="middle">{esc(ln)}</text>'
        )
        ty += line_h
    parts.append("</g>")
    return "".join(parts)


def message(*, x1, x2, y, color, label, dashed=False, dur="2.4s") -> str:
    """A horizontal arrowed sequence message with a centered label above the line."""
    dash = 'stroke-dasharray="7 5"' if dashed else ""
    base = (
        f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" '
        f'stroke-width="2" stroke-opacity="0.55" {dash} '
        f'marker-end="url(#arrow-{color.strip("#")})"/>'
    )
    overlay = (
        f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" '
        f'stroke-width="2" stroke-linecap="round" stroke-dasharray="2 14" '
        f'stroke-opacity="0.95">'
        f'<animate attributeName="stroke-dashoffset" values="0;-32" dur="{dur}" '
        f'repeatCount="indefinite"/></line>'
    )
    lx = (x1 + x2) / 2
    return base + overlay + edge_label(label, lx, y - 13, color)


# ── document scaffolding (canvas, defs, heading, footer) ────────────────────
def svg_open(w, h, aria, *, extra_css=True) -> str:
    style = CSS + (DOC_CSS if extra_css else "")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{esc(aria)}">'
        f"<style>{style}</style>"
    )


def defs(colors=ALL_COLORS, *, gradients=None) -> str:
    P = ["<defs>"]
    P.append(
        '<radialGradient id="bg-canvas" cx="50%" cy="0%" r="120%">'
        '<stop offset="0%" stop-color="#1d1033"/>'
        '<stop offset="100%" stop-color="#080510"/></radialGradient>'
    )
    if gradients:
        for gid, c0, c1 in gradients:
            P.append(gradient(gid, c0, c1))
    for c in colors:
        P.append(arrow_marker(c))
    P.append("</defs>")
    return "".join(P)


def canvas(w, h) -> str:
    return f'<rect width="{w}" height="{h}" fill="url(#bg-canvas)"/>'


def heading(x, y, title, subtitle=None) -> str:
    out = f'<text x="{x}" y="{y}" class="h1">{esc(title)}</text>'
    if subtitle:
        out += f'<text x="{x}" y="{y + 26}" class="legend">{esc(subtitle)}</text>'
    return out


def footer(w, h, out_name, *, script="scripts/generate-doc-diagrams.py") -> str:
    return (
        f'<text x="{w - 16}" y="{h - 8}" text-anchor="end" class="footer">'
        f"assets/{out_name} \u00b7 regenerate via {script}</text>"
    )
