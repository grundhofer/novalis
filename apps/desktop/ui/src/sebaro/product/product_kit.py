#!/usr/bin/env python3
"""A product's sebaro outputs from its own declaration. Python 3.10+, standard library only.

A product declares itself in `sebaro.product.json` (shared/PRODUCT-CONTRACT.md, shared/product.schema.json): its id and
name, the group of its sign tile, its sign as paths on the 24-unit grid and what its website needs. This kit draws
the product's sign tile, launcher layers, notification icon, the start of an Android app, favicon SVG, web manifest
and head snippet from it and from one data file of the system, `product/tiles.json` (tile groups, foot colours,
grounds, stroke masters, the measures of the raster files).

    python3 product_kit.py build sebaro.product.json --copy <copy> --out <folder> [--render]
    python3 product_kit.py check sebaro.product.json --copy <copy> --out <folder> [--no-raster]

`build` writes the outputs into <folder>, which the product owns, with the record `sebaro-product.json` (sha256 per
file, the kit's version, the hashes of the declaration and of tiles.json). It writes nothing into <copy>. `check`
writes nothing at all: it draws the outputs again and compares them with the files and the record. The declaration
is compared by what it says, not by its bytes (1.2.0): a formatter that changes white space or the order of keys
leaves the outputs up to date.

Every output of the kit is text. The PNG and ICO files (favicon.ico, touch icon, manifest icons, Play icon, desktop
icon) need a browser: the kit writes one SVG per raster into <folder>/render/ and lists them in the record, and the
renderer beside this file (product/render.mjs, Node 20 and the product's own Playwright) draws them and keeps its
own record, `sebaro-product-raster.json`. `build --render` runs it after the build. `check` compares the raster
files with that record and with the SVGs they were drawn from, by sha256, never by pixel: missing, edited, stale.

Inside sebaroDesign this file is tools/product_kit.py and tools/brand_assets.py calls its functions for the same
outputs; a copy carries it as product/product_kit.py beside product/sign_geometry.py, the only module it imports,
and product/render.mjs (tools/product_render.mjs here). A third command is for the maintainers of sebaro alone and
needs the system's sources, which no copy holds: `python3 tools/product_kit.py tiles <system> --out <copy>` writes
<copy>/product/tiles.json.
Exit codes: 0 ok · 1 an output is missing, edited or stale (check), or a file could not be written · 2 usage or input.
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import math
import pathlib
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from typing import Any, Iterable

HERE = pathlib.Path(__file__).resolve().parent
if __name__ == "__main__":
    sys.dont_write_bytecode = True      # run from a copy, the kit leaves nothing in it: no __pycache__ beside this file
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import sign_geometry as GEO  # noqa: E402  (path data, glyphs, stroke masters, the foot tile; standard library)
from sign_geometry import fmt  # noqa: E402

TOOL_VERSION = "1.2.0"   # 1.2.0 (D148 stage 6c, sebaro CHECKS.md §120): check compares the declaration by its meaning (the record's declaration.meaning, the sha256 of its JSON with sorted keys and no white space), so a formatter's white space or key order is not „stale“, a record of 1.1 is still read by its bytes; sign/tile-small.svg for web and desktop, the tile's form below 32 px as Android's sb_sign_<id>_small; NOTICE.md, the terms of the folder's files; record 1.2; 1.1.0 (D148 stage 6a, sebaro CHECKS.md §118): the start of an Android app (sb_symbol_<id>, sb_splash_symbol_<id>, sebaro_start*.xml with Theme.Sebaro.Start), one SVG per raster file in render/ with the record's "raster" list, check reads the renderer's record (missing, edited, stale by sha256; --no-raster), build --render runs product/render.mjs, tiles.json 1.1 with the raster measures, record 1.1; 1.0.0 (D148 stage 2, sebaro CHECKS.md §114): first version
SCHEMA_VERSION = "1.0"                  # sebaro.product.json (PRODUCT-CONTRACT)
TILES_FORMAT = "1.1"                    # product/tiles.json (1.1: "raster")
RECORD_FORMAT = "1.2"                   # sebaro-product.json (1.2: declaration.meaning; 1.1: "raster" instead of "notProduced")
NOTICE_NAME = "NOTICE.md"               # <folder>/NOTICE.md: under what terms the folder's files stand (1.2.0)
RASTER_RECORD_FORMAT = "1.0"            # sebaro-product-raster.json, written by the renderer
KIT_PATH = "product/product_kit.py"     # this file's place in a copy; the notice in every output names it
RENDER_PATH = "product/render.mjs"      # the renderer's place in a copy (tools/product_render.mjs in sebaroDesign)
TILES_PATH = "product/tiles.json"
DECLARATION_NAME = "sebaro.product.json"
RECORD_NAME = "sebaro-product.json"
RASTER_RECORD_NAME = "sebaro-product-raster.json"
RENDER_DIR = "render"                   # <folder>/render/: the SVG each raster file is drawn from
CANVAS_DP = 108.0                       # the adaptive launcher canvas; a raster shows its middle (BRAND-ASSETS section 2)
SAFE_DP = 66.0                          # the circle of that canvas no launcher mask cuts
# the raster measures a system's brand.config.json may set, with the defaults of tools/brand_assets.py (DEFAULT_CONFIG)
RASTER_VIEWPORTS = {"any": 72.0, "play": round(SAFE_DP * 180 / 140, 4), "appleTouch": round(SAFE_DP * 180 / 140, 4),
                    "maskable": round(SAFE_DP * 512 / 409, 4), "desktop": 72.0}
RASTER_DESKTOP_BODY_PX = 824
RASTER_SQUIRCLE_EXPONENT = 5.0
DESKTOP_ICON_PX = 1024
OUTPUT_KINDS = ("android", "web", "desktop")
SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
LAYERS = ("background", "foreground", "monochrome")
STATUS_ICON = "ic_stat_notify.xml"      # res/drawable/: notification small icon
SPLASH_XML = "sebaro_splash.xml"        # res/values[-night]/: windowSplashScreenBackground colour
START_XML = "sebaro_start.xml"          # res/values/: the start's ground; res/values-v31/: Theme.Sebaro.Start with the splash
START_THEME_XML = "sebaro_start_theme.xml"   # res/values/: Theme.Sebaro.Start for API 30 and before
FAVICON_ICO_PX = (32, 16, 48)           # the entries of favicon.ico in file order, each drawn for its own size
THEME_COLOR_JSON = "theme-color.json"   # web/: the browser-bar colours the head snippet's tags are made from


class KitError(Exception):
    """Input/usage problem (exit 2)."""


class SvgSubsetError(KitError):
    """SVG uses something outside the documented subset."""

    def __init__(self, label: str, problems: list[str]):
        self.label, self.problems = label, problems
        super().__init__(f"{label}: " + "; ".join(problems))


# ============================================================================= small helpers

def esc(v: Any) -> str:
    """XML-escape text and attribute values."""
    return str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ============================================================================= colours

_NAMED = {"black": (0, 0, 0, 1.0), "white": (255, 255, 255, 1.0)}


def parse_color(value: str, *, allow_current: bool) -> tuple[int, int, int, float] | str | None:
    """SVG paint -> (r, g, b, alpha) | 'currentColor' | None (no paint). Raises ValueError."""
    v = value.strip()
    low = v.lower()
    if low in ("none", "transparent"):
        return None
    if low == "currentcolor":
        if not allow_current:
            raise ValueError("currentColor is not allowed here (use an explicit hex colour)")
        return "currentColor"
    if low in _NAMED:
        return _NAMED[low]
    if low.startswith("url("):
        raise ValueError(f"paint server {v!r} (gradients/patterns) is not supported")
    m = re.fullmatch(r"#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})", v)
    if not m:
        raise ValueError(f"colour {v!r} not supported (use #rgb, #rrggbb, #rrggbbaa, black, white, none)")
    h = m.group(1)
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), (int(h[6:8], 16) / 255 if len(h) == 8 else 1.0)


def hex6(rgb: Iterable[float]) -> str:
    r, g, b = [max(0, min(255, round(c))) for c in list(rgb)[:3]]
    return f"#{r:02X}{g:02X}{b:02X}"


# ============================================================================= path geometry

Affine = tuple[float, float, float, float]   # (sx, sy, tx, ty): p' = (sx*x + tx, sy*y + ty)
IDENTITY: Affine = (1.0, 1.0, 0.0, 0.0)


def compose(outer: Affine, inner: Affine) -> Affine:
    """outer ∘ inner (apply inner first)."""
    osx, osy, otx, oty = outer
    isx, isy, itx, ity = inner
    return osx * isx, osy * isy, osx * itx + otx, osy * ity + oty


def normalize_d(d: str, transform: Affine = IDENTITY, precision: int = 3) -> str:
    """Parse any SVG path data (arcs become cubics), apply a scale/translate, emit absolute M/L/C/Q/Z."""
    sx, sy, tx, ty = transform

    def pt(p) -> str:
        x, y = p
        return f"{fmt(sx * x + 0 * y + tx, precision)} {fmt(0 * x + sy * y + ty, precision)}"
    parts: list[str] = []
    try:
        for ev in GEO.path_events(d):
            if ev[0] == "M":
                parts.append("M" + pt(ev[1]))
            elif ev[0] == "L":
                parts.append("L" + pt(ev[1]))
            elif ev[0] == "C":
                parts.append("C" + " ".join(pt(p) for p in ev[1:]))
            elif ev[0] == "Q":
                parts.append("Q" + pt(ev[1]) + " " + pt(ev[2]))
            elif ev[0] == "Z":
                parts.append("Z")
    except Exception as exc:  # ValueError / IndexError / TypeError / AttributeError on malformed data
        raise ValueError(f"cannot parse path data ({exc})") from exc
    return "".join(parts)


# ============================================================================= SVG subset parser

PRESENTATION = ("fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
                "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity")
INHERITED = tuple(p for p in PRESENTATION if p != "opacity")
GEOMETRY = {"path": ("d",), "rect": ("x", "y", "width", "height", "rx", "ry"), "circle": ("cx", "cy", "r"),
            "ellipse": ("cx", "cy", "rx", "ry"), "line": ("x1", "y1", "x2", "y2"),
            "polyline": ("points",), "polygon": ("points",)}
IGNORED_ELEMENTS = ("title", "desc", "metadata")
ROOT_ATTRS = ("viewBox", "width", "height", "version", "preserveAspectRatio", "baseProfile")


@dataclasses.dataclass
class Shape:
    tag: str
    where: str
    d: str                      # normalized path data in the element's own coordinates
    paint: dict[str, str]       # effective presentation values (inherited + own)
    opacity: float


@dataclasses.dataclass
class Group:
    where: str
    transform: Affine | None
    children: list


def _local(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _attr_name(name: str) -> str:
    if name.startswith("{"):
        ns, local = name[1:].split("}", 1)
        return ("xlink:" if ns == XLINK_NS else "xml:" if ns.endswith("XML/1998/namespace") else ns + ":") + local
    return name


def _num(value: str, what: str) -> float:
    v = value.strip()
    if v.endswith("px"):
        v = v[:-2]
    try:
        return float(v)
    except ValueError:
        raise ValueError(f"{what}={value!r} is not a plain number (units other than px are not supported)")


def parse_transform(value: str) -> Affine:
    """translate()/scale() lists only; anything else raises ValueError."""
    result = IDENTITY
    pos = 0
    value = value.strip()
    for m in re.finditer(r"\s*([a-zA-Z]+)\s*\(([^)]*)\)\s*,?", value):
        if m.start() != pos:
            break
        pos = m.end()
        fn, args = m.group(1), [float(a) for a in re.split(r"[\s,]+", m.group(2).strip()) if a]
        if fn == "translate" and len(args) in (1, 2):
            t = (1.0, 1.0, args[0], args[1] if len(args) == 2 else 0.0)
        elif fn == "scale" and len(args) in (1, 2):
            t = (args[0], args[1] if len(args) == 2 else args[0], 0.0, 0.0)
        else:
            raise ValueError(f"transform {fn}({m.group(2)}) is not supported (only translate and scale)")
        result = compose(result, t)
    if pos != len(value):
        raise ValueError(f"transform {value!r} is not supported (only translate(...) and scale(...))")
    return result


def _points(value: str) -> list[tuple[float, float]]:
    nums = [float(n) for n in re.split(r"[\s,]+", value.strip()) if n]
    if len(nums) < 4 or len(nums) % 2:
        raise ValueError(f"points={value!r} needs at least two x,y pairs")
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]


def shape_to_d(tag: str, a: dict[str, str]) -> str:
    g = lambda k, default=None: _num(a[k], k) if k in a else default  # noqa: E731
    if tag == "path":
        if not a.get("d", "").strip():
            raise ValueError("<path> without d")
        return a["d"]
    if tag == "rect":
        x, y, w, h = g("x", 0.0), g("y", 0.0), g("width"), g("height")
        if w is None or h is None or w <= 0 or h <= 0:
            raise ValueError("<rect> needs positive width and height")
        rx, ry = g("rx"), g("ry")
        if rx is None and ry is None:
            return f"M{x} {y}H{x + w}V{y + h}H{x}Z"
        rx = ry if rx is None else rx
        ry = rx if ry is None else ry
        rx, ry = min(max(rx, 0.0), w / 2), min(max(ry, 0.0), h / 2)
        if rx == 0 or ry == 0:
            return f"M{x} {y}H{x + w}V{y + h}H{x}Z"
        return (f"M{x + rx} {y}H{x + w - rx}A{rx} {ry} 0 0 1 {x + w} {y + ry}V{y + h - ry}"
                f"A{rx} {ry} 0 0 1 {x + w - rx} {y + h}H{x + rx}A{rx} {ry} 0 0 1 {x} {y + h - ry}"
                f"V{y + ry}A{rx} {ry} 0 0 1 {x + rx} {y}Z")
    if tag in ("circle", "ellipse"):
        cx, cy = g("cx", 0.0), g("cy", 0.0)
        if tag == "circle":
            rx = ry = g("r")
        else:
            rx, ry = g("rx"), g("ry")
        if rx is None or ry is None or rx <= 0 or ry <= 0:
            raise ValueError(f"<{tag}> needs a positive radius")
        return (f"M{cx - rx} {cy}A{rx} {ry} 0 1 0 {cx + rx} {cy}A{rx} {ry} 0 1 0 {cx - rx} {cy}Z")
    if tag == "line":
        return f"M{g('x1', 0.0)} {g('y1', 0.0)}L{g('x2', 0.0)} {g('y2', 0.0)}"
    if tag in ("polyline", "polygon"):
        pts = _points(a.get("points", ""))
        d = f"M{pts[0][0]} {pts[0][1]}" + "".join(f"L{x} {y}" for x, y in pts[1:])
        return d + ("Z" if tag == "polygon" else "")
    raise ValueError(f"<{tag}> is not supported")


def _parse_style(style: str) -> dict[str, str]:
    out = {}
    for decl in style.split(";"):
        if not decl.strip():
            continue
        if ":" not in decl:
            raise ValueError(f"cannot parse style declaration {decl!r}")
        k, v = decl.split(":", 1)
        out[k.strip()] = v.strip()
    return out


def _validate_paint(props: dict[str, str], allow_current: bool) -> list[str]:
    errs = []
    for k, v in props.items():
        if k not in PRESENTATION:
            errs.append(f"property {k!r} is not supported")
            continue
        if v == "inherit":
            continue
        try:
            if k in ("fill", "stroke"):
                parse_color(v, allow_current=allow_current)
            elif k in ("fill-opacity", "stroke-opacity", "opacity"):
                f = float(v)
                if not 0 <= f <= 1:
                    raise ValueError(f"{k}={v} outside 0..1")
            elif k == "stroke-width":
                if _num(v, k) < 0:
                    raise ValueError("negative stroke-width")
            elif k == "stroke-miterlimit":
                if float(v) < 1:
                    raise ValueError("stroke-miterlimit < 1")
            elif k == "fill-rule" and v not in ("nonzero", "evenodd"):
                raise ValueError(f"fill-rule {v!r}")
            elif k == "stroke-linecap" and v not in ("butt", "round", "square"):
                raise ValueError(f"stroke-linecap {v!r}")
            elif k == "stroke-linejoin" and v not in ("miter", "round", "bevel"):
                raise ValueError(f"stroke-linejoin {v!r} (VectorDrawable knows miter, round, bevel)")
        except ValueError as exc:
            errs.append(str(exc))
    return errs


def parse_viewbox(value: str | None) -> tuple[float, float, float, float] | None:
    if not value:
        return None
    nums = [float(n) for n in re.split(r"[\s,]+", value.strip()) if n]
    if len(nums) != 4 or nums[2] <= 0 or nums[3] <= 0:
        raise ValueError(f"viewBox {value!r} is not 'min-x min-y width height' with positive size")
    return nums[0], nums[1], nums[2], nums[3]


def parse_xml(text: str, label: str) -> ET.Element:
    if "<!ENTITY" in text:
        raise SvgSubsetError(label, ["XML entity declarations are not allowed"])
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SvgSubsetError(label, [f"not well-formed XML ({exc})"]) from exc
    if _local(root.tag) != "svg":
        raise SvgSubsetError(label, [f"root element is <{_local(root.tag)}>, expected <svg>"])
    return root


def parse_svg_subset(text: str, label: str, *, allow_current: bool = False, precision: int = 3,
                     fragment: bool = False) -> tuple[tuple | None, Group, list[str]]:
    """Parse the documented subset into a tree. Returns (viewBox, root group, warnings).
    Raises SvgSubsetError listing every problem found (fail loud, not first-error-only)."""
    root = parse_xml(text, label)
    problems: list[str] = []
    warnings: list[str] = []
    try:
        vb = parse_viewbox(root.get("viewBox"))
    except ValueError as exc:
        problems.append(str(exc))
        vb = None

    def own_props(el: ET.Element, where: str) -> dict[str, str]:
        props = {}
        for k in PRESENTATION:
            if el.get(k) is not None:
                props[k] = el.get(k)
        if el.get("style"):
            try:
                props.update(_parse_style(el.get("style")))
            except ValueError as exc:
                problems.append(f"{where}: {exc}")
        for e in _validate_paint(props, allow_current):
            problems.append(f"{where}: {e}")
        return props

    def check_attrs(el: ET.Element, allowed: Iterable[str], where: str) -> None:
        allowed = set(allowed) | set(PRESENTATION) | {"style", "id", "role", "class"}
        for raw in el.attrib:
            name = _attr_name(raw)
            if name in allowed or name.startswith(("data-", "aria-", "xmlns", "xml:")):
                continue
            if name == "class":
                continue
            problems.append(f"{where}: attribute {name!r} is not supported")
        if el.get("class") is not None:
            warnings.append(f"{where}: class has no effect (<style> is not part of the subset)")

    def walk(el: ET.Element, where: str, inherited: dict[str, str], is_root: bool) -> Group:
        tag = _local(el.tag)
        transform = None
        if is_root:
            check_attrs(el, ROOT_ATTRS, where)
        else:
            check_attrs(el, ("transform",), where)
            if el.get("transform") is not None:
                try:
                    transform = parse_transform(el.get("transform"))
                except ValueError as exc:
                    problems.append(f"{where}: {exc}")
        props = own_props(el, where)
        if props.get("opacity") not in (None, "1", "1.0", "inherit"):
            problems.append(f"{where}: opacity on <{tag}> is not supported (VectorDrawable groups have no "
                            "alpha); set fill-opacity/stroke-opacity on the shapes")
        eff = dict(inherited)
        eff.update({k: v for k, v in props.items() if k in INHERITED and v != "inherit"})
        group = Group(where, transform, [])
        counts: dict[str, int] = {}
        for child in el:
            if not isinstance(child.tag, str):     # comments / processing instructions
                continue
            ctag = _local(child.tag)
            counts[ctag] = counts.get(ctag, 0) + 1
            cwhere = f"{where}/{ctag}[{counts[ctag]}]" + (f"#{child.get('id')}" if child.get("id") else "")
            if ctag in IGNORED_ELEMENTS:
                continue
            if ctag == "g":
                group.children.append(walk(child, cwhere, eff, False))
            elif ctag in GEOMETRY:
                check_attrs(child, GEOMETRY[ctag], cwhere)
                if child.get("transform") is not None:
                    problems.append(f"{cwhere}: transform is only supported on <g> (wrap the shape in a group)")
                cprops = own_props(child, cwhere)
                paint = dict(eff)
                paint.update({k: v for k, v in cprops.items() if k in INHERITED and v != "inherit"})
                try:
                    op = float(cprops.get("opacity", "1"))
                except ValueError:
                    op = 1.0
                try:
                    d = normalize_d(shape_to_d(ctag, {_attr_name(k): v for k, v in child.attrib.items()}),
                                    precision=precision)
                    if not d:
                        raise ValueError("empty geometry")
                    group.children.append(Shape(ctag, cwhere, d, paint, op))
                except ValueError as exc:
                    problems.append(f"{cwhere}: {exc}")
            else:
                problems.append(f"{cwhere}: element <{ctag}> is not supported "
                                "(subset: path, rect, circle, ellipse, line, polyline, polygon, g)")
        return group

    tree = walk(root, "svg", {}, True)
    if problems:
        raise SvgSubsetError(label, problems)
    return vb, tree, warnings


def iter_shapes(node: Group, transform: Affine = IDENTITY):
    """Yield (shape, cumulative transform)."""
    t = compose(transform, node.transform) if node.transform else transform
    for child in node.children:
        if isinstance(child, Group):
            yield from iter_shapes(child, t)
        else:
            yield child, t


def shape_paints(shape: Shape) -> tuple[Any, Any, float, float]:
    """-> (fill colour|None, stroke colour|None, fill alpha, stroke alpha) with SVG defaults applied."""
    fill = parse_color(shape.paint.get("fill", "#000000"), allow_current=True)
    if shape.tag == "line":
        fill = None
    stroke = parse_color(shape.paint.get("stroke", "none"), allow_current=True)
    sw = _num(shape.paint.get("stroke-width", "1"), "stroke-width")
    if sw == 0:
        stroke = None
    fa = float(shape.paint.get("fill-opacity", "1")) * shape.opacity
    sa = float(shape.paint.get("stroke-opacity", "1")) * shape.opacity
    if isinstance(fill, tuple):
        fa *= fill[3]
    if isinstance(stroke, tuple):
        sa *= stroke[3]
    return fill, stroke, fa, sa


# ============================================================================= VectorDrawable

def svg_to_vector_drawable(text: str, label: str, *, width_dp: float | None = None,
                           height_dp: float | None = None, precision: int = 3, source: str | None = None,
                           tool: str = KIT_PATH) -> str:
    """Convert the documented SVG subset to an Android VectorDrawable. Raises SvgSubsetError.
    `tool` and `source` go into the head comment: who generated the file, and from what."""
    vb, tree, _warn = parse_svg_subset(text, label, allow_current=False, precision=precision)
    if vb is None:
        raise SvgSubsetError(label, ["root <svg> needs a viewBox"])
    minx, miny, w, h = vb
    problems: list[str] = []
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             f"<!-- generated by {tool}{' from ' + esc(source) if source else ''} — do not edit -->",
             '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
             f'    android:width="{fmt(width_dp or w)}dp"',
             f'    android:height="{fmt(height_dp or h)}dp"',
             f'    android:viewportWidth="{fmt(w)}"',
             f'    android:viewportHeight="{fmt(h)}">']

    def emit(node: Group, depth: int, scale: tuple[float, float]) -> None:
        ind = "    " * depth
        for child in node.children:
            if isinstance(child, Group):
                if child.transform and child.transform != IDENTITY:
                    sx, sy, tx, ty = child.transform
                    attrs = []
                    if tx:
                        attrs.append(f'android:translateX="{fmt(tx, precision)}"')
                    if ty:
                        attrs.append(f'android:translateY="{fmt(ty, precision)}"')
                    if sx != 1:
                        attrs.append(f'android:scaleX="{fmt(sx, 6)}"')
                    if sy != 1:
                        attrs.append(f'android:scaleY="{fmt(sy, 6)}"')
                    lines.append(f"{ind}<group {' '.join(attrs)}>")
                    emit(child, depth + 1, (scale[0] * sx, scale[1] * sy))
                    lines.append(f"{ind}</group>")
                else:
                    emit(child, depth, scale)
                continue
            fill, stroke, fa, sa = shape_paints(child)
            if fill is None and stroke is None:
                continue
            if child.opacity < 1 and fill is not None and stroke is not None:
                problems.append(f"{child.where}: opacity < 1 on a shape with both fill and stroke cannot be "
                                "converted exactly (split it into two shapes)")
            if stroke is not None and not math.isclose(abs(scale[0]), abs(scale[1]), rel_tol=1e-6):
                problems.append(f"{child.where}: stroked shape under a non-uniform scale (stroke width would "
                                "be ambiguous in VectorDrawable)")
            attrs = [f'android:pathData="{child.d}"']
            if fill is not None:
                attrs.append(f'android:fillColor="{hex6(fill)}"')
                if fa < 1:
                    attrs.append(f'android:fillAlpha="{fmt(fa, 4)}"')
                if child.paint.get("fill-rule") == "evenodd":
                    attrs.append('android:fillType="evenOdd"')
            if stroke is not None:
                attrs.append(f'android:strokeColor="{hex6(stroke)}"')
                if sa < 1:
                    attrs.append(f'android:strokeAlpha="{fmt(sa, 4)}"')
                attrs.append(f'android:strokeWidth="{fmt(_num(child.paint.get("stroke-width", "1"), "sw"), precision)}"')
                cap = child.paint.get("stroke-linecap", "butt")
                join = child.paint.get("stroke-linejoin", "miter")
                if cap != "butt":
                    attrs.append(f'android:strokeLineCap="{cap}"')
                if join != "miter":
                    attrs.append(f'android:strokeLineJoin="{join}"')
                ml = float(child.paint.get("stroke-miterlimit", "4"))
                if ml != 4:
                    attrs.append(f'android:strokeMiterLimit="{fmt(ml, 3)}"')
            lines.append(f"{ind}<path")
            for a in attrs:
                lines.append(f"{ind}    {a}")
            lines[-1] += "/>"

    if minx or miny:
        lines.append(f'    <group android:translateX="{fmt(-minx, precision)}" android:translateY="{fmt(-miny, precision)}">')
        emit(tree, 2, (1.0, 1.0))
        lines.append("    </group>")
    else:
        emit(tree, 1, (1.0, 1.0))
    lines.append("</vector>")
    if problems:
        raise SvgSubsetError(label, problems)
    return "\n".join(lines) + "\n"


# ============================================================================= who wrote an output

@dataclasses.dataclass(frozen=True)
class Stamp:
    """What an output's head says about its origin: the tool, the file its drawing comes from, and where the grounds
    and the splash rule are written. The defaults are the kit's own; tools/brand_assets.py passes the workshop's."""
    tool: str = KIT_PATH
    source: str = DECLARATION_NAME
    grounds: str = f'{TILES_PATH} "grounds"'
    splash: str = "PRODUCT-CONTRACT section 5"

    @property
    def generated(self) -> str:
        return f"generated by {self.tool} — do not edit"

    def drawing(self, what: str) -> str:
        return f"{self.source} ({what})"


# ============================================================================= texts that hold for every product

SPLASH_COLOURS_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- {generated}. Android 12+ splash screen ({scheme} scheme): windowSplashScreenBackground = the system's {scheme}
     bg ({grounds}); the icon is the adaptive launcher icon ({splash}). -->
<resources>
    <color name="sebaro_splash_background">{colour}</color>
</resources>
"""
ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- {generated} -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
"""
MANIFEST_ICONS = ({"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                  {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                  {"src": "icon-mask.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"})
# manifest members the kit writes itself; a "manifest" object must not set them again
MANIFEST_OWN = ("name", "short_name", "theme_color", "background_color", "icons")


def adaptive_icon_xml(stamp: Stamp) -> str:
    """res/mipmap-anydpi-v26/ic_launcher.xml and ic_launcher_round.xml: the three launcher layers."""
    return ADAPTIVE_XML.format(generated=stamp.generated)


def splash_colours_xml(scheme: str, colour: str, stamp: Stamp) -> str:
    """res/values[-night]/sebaro_splash.xml: the splash ground of one scheme (the system's bg)."""
    return SPLASH_COLOURS_XML.format(generated=stamp.generated, scheme=scheme, colour=colour, grounds=stamp.grounds,
                                     splash=stamp.splash)


def sign_drawable_names(pid: str) -> tuple[str, str]:
    """The drawables an app needs to show this product's tile (SbSignTile): the base form and the one below 32 px."""
    res = re.sub(r"[^a-z0-9_]", "_", pid.lower())
    return f"sb_sign_{res}.xml", f"sb_sign_{res}_small.xml"


def manifest_snippet(name: str | None = None, short_name: str | None = None, theme_color: str | None = None,
                     background_color: str | None = None) -> dict:
    """manifest.snippet.json: the members a site merges into a manifest it already has. Nothing is guessed: a member
    without a value is left out."""
    out: dict[str, Any] = {}
    for key, value in (("name", name), ("short_name", short_name), ("theme_color", theme_color),
                       ("background_color", background_color)):
        if value:
            out[key] = value
    out["icons"] = [dict(i) for i in MANIFEST_ICONS]
    return out


def manifest_full(snippet: dict, members: dict) -> dict:
    """manifest.webmanifest: the snippet's members plus the declared Web App Manifest members, names first."""
    full = {k: v for k, v in snippet.items() if k in ("name", "short_name")}
    full.update(members)
    full.update({k: v for k, v in snippet.items() if k not in full})
    return full


def manifest_snippet_text(snippet: dict) -> str:
    return json.dumps(snippet, indent=2) + "\n"


def manifest_text(full: dict) -> str:
    return json.dumps(full, indent=2, ensure_ascii=False) + "\n"


def theme_colors(grounds: dict, tokens: dict | None = None) -> dict:
    """The browser-bar colours, one source for web/theme-color.json and the head snippet's tags: the grounds per
    scheme, plus per tone variant of a tokens.json (TOKEN-CONTRACT §10.4, e.g. sebaro's "warm") its bg per scheme,
    listed only when it differs from the grounds."""
    out: dict[str, Any] = {"light": grounds["light"], "dark": grounds["dark"]}
    tones = {}
    for tone, modes in sorted(((tokens or {}).get("variants") or {}).items()):
        if not isinstance(modes, dict) or not re.fullmatch(r"[a-z][a-z0-9-]*", str(tone)):
            continue
        vals = {m: (modes.get(m) or {}).get("bg") if isinstance(modes.get(m), dict) else None for m in ("light", "dark")}
        if all(isinstance(v, str) for v in vals.values()) and any(vals[m].upper() != str(out[m]).upper() for m in vals):
            tones[tone] = vals
    if tones:
        out["tones"] = tones
    return out


def theme_color_json(colors: dict, tags: bool, stamp: Stamp) -> str:
    """web/theme-color.json. headTags: whether this product's head.snippet.html carries the tags."""
    doc = {"$generated": stamp.generated, "headTags": tags, "light": colors["light"], "dark": colors["dark"]}
    if colors.get("tones"):
        doc["tones"] = colors["tones"]
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def theme_color_meta(colors: dict) -> str:
    """The two theme-color tags of a head snippet, made from theme_colors(): the ground per scheme, and each tone that
    differs as data-sb-tone-<tone>="<its bg in that scheme>", which a page script puts into content while the tone is on."""
    lines = []
    for mode in ("light", "dark"):
        extra = "".join(f' data-sb-tone-{t}="{v[mode]}"' for t, v in sorted((colors.get("tones") or {}).items()))
        lines.append(f'<meta name="theme-color" content="{colors[mode]}" media="(prefers-color-scheme: {mode})"{extra}>\n')
    return "".join(lines)


def head_snippet(stamp: Stamp, theme_meta: str = "") -> str:
    """web/head.snippet.html: the four link tags of a site's head, then the theme-color tags when the product has them."""
    return (f"<!-- {stamp.generated} -->\n"
            '<link rel="icon" href="/favicon.ico" sizes="32x32">\n'
            '<link rel="icon" href="/icon.svg" type="image/svg+xml">\n'
            '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
            '<link rel="manifest" href="/manifest.webmanifest">\n' + theme_meta)


# ============================================================================= the sign on its tile

@dataclasses.dataclass
class Tile:
    """The fixed paints and the corner of a sign tile (D143/D144): the group's ground and sign colour, the same in
    light and dark, the foot's band and line, the radius as a share of the edge."""
    ground: str
    ink: str
    foot: dict
    radius: float


def layer_svg(sign: GEO.SizedGlyphs, tile: Tile, name: str, title: str) -> str:
    """One layer of the adaptive launcher icon on the 108-dp canvas. background: the tile's ground with line and band,
    full bleed. foreground: the sign in the tile's sign colour. monochrome: sign and band in one colour, the line a gap."""
    if name == "background":
        body = f'<rect width="108" height="108" fill="{tile.ground}"/>' + GEO.foot_elements(tile.foot, adaptive=True)
    else:
        body = GEO.foot_symbol(sign, tile.ink if name == "foreground" else "#000000", adaptive=True)
        if name == "monochrome":
            body += GEO.foot_elements(tile.foot, adaptive=True, mono="#000000")
    return f'<svg xmlns="{SVG_NS}" viewBox="0 0 108 108"><title>{esc(title)}</title>{body}</svg>\n'


def notify_box(glyph: GEO.Glyph, pad: float) -> tuple[float, float]:
    """(viewBox origin, side) of the notification icon: the small master's view fills 24 dp minus the padding per side."""
    x0, _y0, side = glyph.view()
    field = side * 24.0 / (24.0 - 2 * pad)
    return x0 - (field - side) / 2, field


def notify_svg(sign: GEO.SizedGlyphs, strokes: GEO.StrokeMasters, pad: float, title: str) -> str:
    """The notification small icon: the sign alone with the stroke master of 24 px, white (Android reads alpha)."""
    gl = sign.glyph_at(strokes, 24)
    o, field = notify_box(gl, pad)
    return (f'<svg xmlns="{SVG_NS}" viewBox="{fmt(o, 4)} {fmt(o, 4)} {fmt(field, 4)} {fmt(field, 4)}">'
            f'<title>{esc(title)}</title>{gl.svg_elements("#FFFFFF")}</svg>\n')


def notify_icon_xml(svg_text: str, label: str, *, source: str, tool: str = KIT_PATH) -> str:
    """ic_stat_notify.xml from notify_svg(): a 24-dp VectorDrawable, every paint white."""
    vd = svg_to_vector_drawable(svg_text, label, width_dp=24, height_dp=24, source=source, tool=tool)
    return re.sub(r'android:(fill|stroke)Color="#[0-9A-Fa-f]{3,8}"', r'android:\1Color="#FFFFFFFF"', vd)


def favicon_svg(sign: GEO.SizedGlyphs, strokes: GEO.StrokeMasters, tile: Tile, px: int, name: str) -> str:
    """The favicon drawn for px (16, 32, 48): the whole tile; below 32 px its small form with the 16-px stroke master."""
    body = GEO.foot_tile(sign, tile.foot, tile.ground, tile.ink, tile.radius, small=px < 32, grammar=strokes)
    return f'<svg xmlns="{SVG_NS}" viewBox="0 0 72 72" width="16" height="16"><title>{esc(name)}</title>{body}</svg>\n'


def tile_svg(sign: GEO.SizedGlyphs, tile: Tile, name: str, *, small: bool = False,
             strokes: GEO.StrokeMasters | None = None) -> str:
    """The tile as the launcher shows it, 72 x 72, for app lists and headers: the base form for 32 px and above, with
    small the form below 32 px (1.2.0), the drawing of the favicon and of Android's sb_sign_<id>_small: the small
    sign (`glyphSmall` where the declaration has one) with the stroke master of 16 px, the heavier foot."""
    body = GEO.foot_tile(sign, tile.foot, tile.ground, tile.ink, tile.radius, small=small, grammar=strokes)
    return (f'<svg xmlns="{SVG_NS}" viewBox="0 0 72 72" width="72" height="72" role="img">'
            f'<title>{esc(name)}</title>{body}</svg>\n')


def sign_svg(sign: GEO.SizedGlyphs, strokes: GEO.StrokeMasters, name: str, *, small: bool = False) -> str:
    """The sign alone in currentColor: the base master, or with small the 16-px master (for 16 to 24 px)."""
    return (sign.glyph_at(strokes, 16) if small else sign.glyph).svg(title=name)


def in_app_tile_xml(sign: GEO.SizedGlyphs, strokes: GEO.StrokeMasters, tile: Tile, *, small: bool, label: str,
                    tool: str = KIT_PATH) -> str:
    """sb_sign_<id>.xml / sb_sign_<id>_small.xml: the complete tile in its fixed colours as a 72-dp VectorDrawable."""
    body = GEO.foot_tile(sign, tile.foot, tile.ground, tile.ink, tile.radius, small=small, grammar=strokes)
    return svg_to_vector_drawable(f'<svg xmlns="{SVG_NS}" viewBox="0 0 72 72">{body}</svg>', label, width_dp=72,
                                  height_dp=72, tool=tool)


# ============================================================================= the start of an Android app

def resource_id(pid: str) -> str:
    """A product id as part of an Android resource name: every character a name cannot have becomes `_`."""
    return re.sub(r"[^a-z0-9_]", "_", pid.lower())


def start_symbol_names(pid: str) -> tuple[str, str]:
    """The drawables of the start: the symbol SbStartSymbol reads by name (`sb_symbol_<id>`) and the one the
    platform splash of API 31 and later shows."""
    res = resource_id(pid)
    return f"sb_symbol_{res}.xml", f"sb_splash_symbol_{res}.xml"


def start_symbol_xml(glyph: GEO.Glyph, colour: str, *, splash: bool, label: str, tool: str = KIT_PATH) -> str:
    """The bare sign in the sign colour of its tile group, without tile and foot (D144). The start symbol is 96 dp.
    The splash symbol stands in the middle third of a 288-dp field: the platform's canvas for an icon without a
    background, so the sign has the size SbStart gives it instead of filling the canvas."""
    x0, y0, side = glyph.view()
    if splash:
        svg = (f'<svg xmlns="{SVG_NS}" viewBox="0 0 72 72"><g transform="translate(24 24)">'
               f'{glyph.svg_elements(colour)}</g></svg>')
        return svg_to_vector_drawable(svg, label, width_dp=288, height_dp=288, tool=tool)
    svg = (f'<svg xmlns="{SVG_NS}" viewBox="{fmt(x0)} {fmt(y0)} {fmt(side)} {fmt(side)}">'
           f'{glyph.svg_elements(colour)}</svg>')
    return svg_to_vector_drawable(svg, label, width_dp=96, height_dp=96, tool=tool)


def start_colour_xml(colour: str) -> str:
    """res/values/sebaro_start.xml: the ground of the start, the tile colour of the product's group."""
    return f'<resources><color name="sebaro_start_background">{colour}</color></resources>\n'


def start_theme_xml(pid: str | None = None) -> str:
    """Theme.Sebaro.Start on the copy's Theme.Sebaro. Without a product id res/values/sebaro_start_theme.xml: the
    ground alone, for API 30 and before. With one res/values-v31/sebaro_start.xml: the platform splash with the
    product's splash symbol."""
    splash = ""
    if pid is not None:
        splash = ('<item name="android:windowSplashScreenBackground">@color/sebaro_start_background</item>'
                  f'<item name="android:windowSplashScreenAnimatedIcon">@drawable/{start_symbol_names(pid)[1][:-4]}</item>')
    return ('<resources><style name="Theme.Sebaro.Start" parent="Theme.Sebaro">' + splash
            + '<item name="android:windowBackground">@color/sebaro_start_background</item></style></resources>\n')


# ============================================================================= one SVG per raster file

def viewport_box(v: float) -> str:
    """The viewBox that shows the middle v dp of the launcher canvas."""
    o = (CANVAS_DP - v) / 2
    return f"{fmt(o, 4)} {fmt(o, 4)} {fmt(v, 4)} {fmt(v, 4)}"


def launcher_body(sign: GEO.SizedGlyphs, tile: Tile) -> str:
    """Background and foreground of the adaptive launcher icon as one drawing on the 108-dp canvas."""
    return (f'<rect width="108" height="108" fill="{tile.ground}"/>' + GEO.foot_elements(tile.foot, adaptive=True)
            + GEO.foot_symbol(sign, tile.ink, adaptive=True))


def squircle_d(centre: float, radius: float, exponent: float, steps: int = 360) -> str:
    """A superellipse |x|^n + |y|^n = r^n as a closed polygon (the body of a desktop icon)."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append(f"{fmt(centre + radius * math.copysign(abs(c) ** (2 / exponent), c), 4)} "
                   f"{fmt(centre + radius * math.copysign(abs(s) ** (2 / exponent), s), 4)}")
    return "M" + "L".join(pts) + "Z"


def icon_svg(sign: GEO.SizedGlyphs, tile: Tile, px: int, viewport: float, *, rounded: bool = False,
             squircle: float | None = None) -> str:
    """The source of a square raster drawn at px: the middle `viewport` dp of the launcher icon, full bleed, or cut:
    with `rounded` to the tile's rounded square, with `squircle` to a superellipse of that exponent (the body of a
    desktop icon). The cut is a clip path in the units of the canvas."""
    body, clip = launcher_body(sign, tile), None
    if squircle:
        clip = f'<path d="{squircle_d(CANVAS_DP / 2, viewport / 2, squircle)}"/>'
    elif rounded and tile.radius:
        o = fmt((CANVAS_DP - viewport) / 2, 4)
        clip = (f'<rect x="{o}" y="{o}" width="{fmt(viewport, 4)}" height="{fmt(viewport, 4)}" '
                f'rx="{fmt(tile.radius * viewport, 4)}"/>')
    if clip:
        body = f'<clipPath id="m">{clip}</clipPath><g clip-path="url(#m)">{body}</g>'
    return f'<svg xmlns="{SVG_NS}" viewBox="{viewport_box(viewport)}" width="{px}" height="{px}">{body}</svg>\n'


# ============================================================================= product/tiles.json

@dataclasses.dataclass
class Tiles:
    """What the kit needs of a system, as its copy ships it in product/tiles.json."""
    system: str
    groups: dict                    # id -> {"tile", "glyph", "css", "kotlin"}
    foot: dict                      # {"band", "line"}
    grounds: dict                   # {"light", "dark"}: the system's bg
    tones: dict                     # tone -> {"light", "dark"}: the bg of a tone variant that differs
    radius: float                   # corner radius of a tile as a share of its edge
    strokes: GEO.Strokes
    notify_pad: float               # dp around the notification icon's sign
    kotlin_package: str | None
    raster: dict                    # {"viewports": {any, play, appleTouch, maskable, desktop}, "desktopBodyPx", "squircleExponent"}
    sha256: str = ""

    def tile(self, group: str) -> Tile:
        g = self.groups[group]
        return Tile(g["tile"].upper(), g["glyph"].upper(), self.foot, self.radius)

    def theme_colors(self) -> dict:
        out: dict[str, Any] = {"light": self.grounds["light"], "dark": self.grounds["dark"]}
        if self.tones:
            out["tones"] = self.tones
        return out


def tiles_doc(tokens: dict, brand: dict, registry: dict, *, kotlin_package: str | None = None) -> dict:
    """The content of product/tiles.json, from a system's dist/tokens.json, brand/brand.config.json and the grammar of
    brand/signs.json. It names no product: of signTiles it takes the groups' colours and names, not their product lists.
    Raises KitError for a system the kit cannot draw (it draws the tile with the fixed foot only)."""
    signs = brand.get("signs") if isinstance(brand, dict) else None
    if not isinstance(signs, dict):
        raise KitError("brand.config.json has no \"signs\" section: the kit draws sign tiles only")
    tile_cfg = signs.get("tile") or {}
    if tile_cfg.get("source") != "signTiles" or not isinstance(tokens.get("signTiles"), dict):
        raise KitError("the kit needs signs.tile.source \"signTiles\" and signTiles in dist/tokens.json (tile groups)")
    if signs.get("foot") is None or signs.get("code") is not None:
        raise KitError("the kit draws the tile with the fixed foot only: brand.config.json needs signs.foot and no "
                       "signs.code")
    if (signs.get("favicon") or {}).get("style", "tile") != "tile":
        raise KitError("the kit draws the tile favicon only: signs.favicon.style must be \"tile\"")
    try:
        foot = GEO.resolve_foot(signs["foot"], tokens)
    except ValueError as exc:
        raise KitError(str(exc)) from exc
    try:
        radius = tile_cfg["radius"]
        pad = signs["notification"]["paddingDp"]
        bg = tokens["tokens"]["color.bg"]
        grounds = {"light": bg["light"], "dark": bg["dark"]}
        groups = {gid: {"tile": g["tile"], "glyph": g["glyph"], "css": g["css"], "kotlin": g["kotlin"]}
                  for gid, g in tokens["signTiles"].items()}
        grammar = registry["grammar"]
        stroke = {k: grammar["stroke"][k] for k in ("width", "cap", "join")}
    except (KeyError, TypeError) as exc:
        missing = exc.args[0] if isinstance(exc, KeyError) else exc
        raise KitError(f"cannot write tiles.json: {missing!r} is not set (signs.tile.radius and "
                       "signs.notification.paddingDp in brand.config.json, color.bg and signTiles in dist/tokens.json, "
                       "grammar.stroke in signs.json are read as written, without defaults)") from exc
    doc: dict[str, Any] = {
        "$generated": "generated by tools/product_kit.py tiles from dist/tokens.json, brand/brand.config.json and "
                      "brand/signs.json — do not edit",
        "format": TILES_FORMAT,
        "system": (tokens.get("meta") or {}).get("slug", ""),
        "groups": groups,
        "foot": foot,
        "grounds": grounds,
    }
    tones = theme_colors(grounds, tokens).get("tones")
    if tones:
        doc["tones"] = tones
    doc["tile"] = {"radius": radius}
    doc["sign"] = {"stroke": stroke, "strokeBySize": list(grammar.get("strokeBySize") or [])}
    doc["notification"] = {"paddingDp": pad}
    doc["raster"] = raster_measures(brand)
    if kotlin_package:
        doc["kotlin"] = {"package": kotlin_package}
    tiles_from_doc(doc)     # the same checks a copy's file gets
    return doc


def raster_measures(brand: dict) -> dict:
    """The measures of the raster files as a system's brand.config.json sets them: `viewports` (the dp of the launcher
    canvas each raster shows; its `tauri` is `desktop` here), `tauriBodyPx` and `masks.squircleExponent`. A measure
    the config leaves out has the default of tools/brand_assets.py, which draws the workshop's rasters."""
    views = brand.get("viewports") if isinstance(brand.get("viewports"), dict) else {}
    masks = brand.get("masks") if isinstance(brand.get("masks"), dict) else {}
    return {"viewports": {key: views.get("tauri" if key == "desktop" else key, default)
                          for key, default in RASTER_VIEWPORTS.items()},
            "desktopBodyPx": brand.get("tauriBodyPx", RASTER_DESKTOP_BODY_PX),
            "squircleExponent": masks.get("squircleExponent", RASTER_SQUIRCLE_EXPONENT)}


def tiles_text(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def tiles_from_doc(doc: Any, sha256: str = "") -> Tiles:
    where = TILES_PATH
    if not isinstance(doc, dict):
        raise KitError(f"{where}: must be a JSON object")
    if doc.get("format") != TILES_FORMAT:
        raise KitError(f"{where}: format {doc.get('format')!r}, this kit ({TOOL_VERSION}) reads \"{TILES_FORMAT}\"")
    probs: list[str] = []

    def section(key) -> dict:
        v = doc.get(key)
        return v if isinstance(v, dict) else {}

    def colour(v, what) -> None:
        if not isinstance(v, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", v):
            probs.append(f"{what} must be an opaque #rrggbb colour, got {v!r}")

    def number(v, lo, hi, what) -> float:
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
            probs.append(f"{what} must be a number in {fmt(lo)}..{fmt(hi)}, got {v!r}")
            return lo
        return float(v)
    groups = doc.get("groups")
    if not isinstance(groups, dict) or not groups:
        probs.append("groups must be a non-empty object")
        groups = {}
    for gid, g in groups.items():
        if not isinstance(g, dict) or not all(isinstance(g.get(k), str) for k in ("tile", "glyph", "css", "kotlin")):
            probs.append(f"groups.{gid} needs tile, glyph, css and kotlin")
            continue
        colour(g["tile"], f"groups.{gid}.tile")
        colour(g["glyph"], f"groups.{gid}.glyph")
    foot, grounds = section("foot"), section("grounds")
    for key, v, names in (("foot", foot, ("band", "line")), ("grounds", grounds, ("light", "dark"))):
        if set(v) != set(names):
            probs.append(f"{key} must have exactly {' and '.join(names)}")
        else:
            for n in names:
                colour(v[n], f"{key}.{n}")
    tones = doc.get("tones", {})
    if not isinstance(tones, dict) or any(not isinstance(t, dict) or set(t) != {"light", "dark"} for t in tones.values()):
        probs.append("tones must map a tone to its light and dark ground")
        tones = {}
    radius = number(section("tile").get("radius"), 0.0, 0.25, "tile.radius")
    pad = number(section("notification").get("paddingDp"), 0.0, 4.0, "notification.paddingDp")
    stroke = section("sign").get("stroke")
    stroke = stroke if isinstance(stroke, dict) else {}
    width = stroke.get("width")
    if not isinstance(width, (int, float)) or isinstance(width, bool) or not 0 < width <= 12:
        probs.append(f"sign.stroke.width must be a number in (0, 12], got {width!r}")
        width = 3.0
    if stroke.get("cap") not in GEO.CAPS or stroke.get("join") not in GEO.JOINS:
        probs.append(f"sign.stroke needs cap {GEO.CAPS} and join {GEO.JOINS}")
    by_size = []
    for i, e in enumerate(section("sign").get("strokeBySize") or []):
        if not isinstance(e, dict) or set(e) != {"maxPx", "width"} or not all(
                isinstance(e[k], (int, float)) and not isinstance(e[k], bool) and e[k] > 0 for k in e):
            probs.append(f"sign.strokeBySize[{i}] must be {{\"maxPx\": >0, \"width\": >0}}")
            continue
        by_size.append((float(e["maxPx"]), float(e["width"])))
    raster = section("raster")
    views = raster.get("viewports") if isinstance(raster.get("viewports"), dict) else {}
    if set(views) != set(RASTER_VIEWPORTS):
        probs.append(f"raster.viewports must have exactly {', '.join(RASTER_VIEWPORTS)}")
    else:
        for key in RASTER_VIEWPORTS:
            number(views[key], SAFE_DP, CANVAS_DP, f"raster.viewports.{key}")
    body = raster.get("desktopBodyPx")
    if not isinstance(body, int) or isinstance(body, bool) or not 0 < body <= DESKTOP_ICON_PX or body % 2:
        probs.append(f"raster.desktopBodyPx must be an even whole number in 2..{DESKTOP_ICON_PX}, got {body!r}")
    number(raster.get("squircleExponent"), 2.0, 20.0, "raster.squircleExponent")
    package = section("kotlin").get("package")
    if package is not None and (not isinstance(package, str) or not re.fullmatch(r"[A-Za-z_]\w*(\.[A-Za-z_]\w*)*", package)):
        probs.append(f"kotlin.package must be a package name, got {package!r}")
    if probs:
        raise KitError(f"{where}: " + "; ".join(probs))
    return Tiles(system=str(doc.get("system", "")), groups=groups, foot=foot, grounds=grounds,
                 tones=tones, radius=radius,
                 strokes=GEO.Strokes(float(width), stroke["cap"], stroke["join"], tuple(sorted(by_size))),
                 notify_pad=pad, kotlin_package=package, raster=raster, sha256=sha256)


def load_tiles(copy: pathlib.Path) -> Tiles:
    p = pathlib.Path(copy) / TILES_PATH
    try:
        raw = p.read_bytes()
    except OSError as exc:
        raise KitError(f"no {TILES_PATH} in the copy {copy} ({exc.strerror or exc})") from exc
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KitError(f"{p}: invalid JSON ({exc})") from exc
    return tiles_from_doc(doc, sha256_bytes(raw))


# ============================================================================= sebaro.product.json

ID_RE = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
DECLARATION_KEYS = {"$schema", "$comment", "schemaVersion", "id", "name", "shortName", "tile", "sign", "web", "outputs"}
DECLARATION_REQUIRED = ("schemaVersion", "id", "name", "tile", "sign", "outputs")
WEB_KEYS = {"name", "themeColor", "backgroundColor", "manifest", "headThemeColor"}


@dataclasses.dataclass
class Product:
    """A valid declaration, read against the system's tiles."""
    id: str
    name: str
    short_name: str
    group: str
    sign: GEO.Sign
    outputs: tuple
    web: dict                       # the declaration's "web" object ({} when absent)

    @property
    def web_name(self) -> str:
        return self.web.get("name", self.name)

    @property
    def head_theme_color(self) -> bool:
        return self.web.get("headThemeColor", True)


def declaration_problems(doc: Any) -> list[str]:
    """Every structural problem of a declaration (the rules of shared/product.schema.json), all at once."""
    if not isinstance(doc, dict):
        return ["the declaration must be a JSON object"]
    probs = [f"unknown key {k!r}" for k in sorted(set(doc) - DECLARATION_KEYS)]
    probs += [f"{k} is required" for k in DECLARATION_REQUIRED if k not in doc]

    def text(v, what, pattern=None):
        if not isinstance(v, str) or not v.strip():
            probs.append(f"{what} must be a non-empty string, got {v!r}")
        elif pattern is not None and not pattern.fullmatch(v):
            probs.append(f"{what} must be kebab-case ([a-z0-9]+(-[a-z0-9]+)*), got {v!r}")
    for key in ("$schema", "$comment"):
        if key in doc and not isinstance(doc[key], str):
            probs.append(f"{key} must be a string")
    if "schemaVersion" in doc and doc["schemaVersion"] != SCHEMA_VERSION:
        probs.append(f"schemaVersion must be \"{SCHEMA_VERSION}\", got {doc['schemaVersion']!r}")
    if "id" in doc:
        text(doc["id"], "id", ID_RE)
    if "name" in doc:
        text(doc["name"], "name")
    if "shortName" in doc:
        text(doc["shortName"], "shortName")
    if "tile" in doc:
        text(doc["tile"], "tile", ID_RE)
    if "sign" in doc:
        sign = doc["sign"]
        if not isinstance(sign, dict):
            probs.append("sign must be an object with glyph")
        else:
            probs += [f"sign: unknown key {k!r}" for k in sorted(set(sign) - {"glyph", "glyphSmall"})]
            if "glyph" not in sign:
                probs.append("sign.glyph is required")
            for key in ("glyph", "glyphSmall"):
                if key in sign and (not isinstance(sign[key], list) or not sign[key]):
                    probs.append(f"sign.{key} must be a non-empty list of paths")
    if "outputs" in doc:
        outs = doc["outputs"]
        if not isinstance(outs, list) or not outs or any(o not in OUTPUT_KINDS for o in outs) \
                or len(set(map(str, outs))) != len(outs):
            probs.append(f"outputs must list one or more of {', '.join(OUTPUT_KINDS)}, each once, got {outs!r}")
    if "web" in doc:
        web = doc["web"]
        if not isinstance(web, dict):
            probs.append("web must be an object")
        else:
            probs += [f"web: unknown key {k!r}" for k in sorted(set(web) - WEB_KEYS)]
            if "name" in web:
                text(web["name"], "web.name")
            for key in ("themeColor", "backgroundColor"):
                if key in web and (not isinstance(web[key], str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", web[key])):
                    probs.append(f"web.{key} must be an opaque #rrggbb colour, got {web[key]!r}")
            if "headThemeColor" in web and not isinstance(web["headThemeColor"], bool):
                probs.append("web.headThemeColor must be true or false")
            if "manifest" in web:
                if not isinstance(web["manifest"], dict):
                    probs.append("web.manifest must be an object of Web App Manifest members")
                else:
                    own = sorted(set(web["manifest"]) & set(MANIFEST_OWN))
                    if own:
                        probs.append("web.manifest must not set " + ", ".join(own) + " (name and shortName, web.name, "
                                     "web.themeColor and web.backgroundColor say them; icons are written by the kit)")
    return probs


def product_of(doc: Any, tiles: Tiles) -> Product:
    """The declaration as a Product, or KitError with every problem: the structure, then what only the system's tiles
    and the drawing can tell (the tile group exists, the paths parse, the ink stays in the 24-unit box)."""
    probs = declaration_problems(doc)
    if probs:
        raise KitError("; ".join(probs))
    if doc["tile"] not in tiles.groups:
        probs.append(f"tile {doc['tile']!r} is not a tile group of the system ({', '.join(tiles.groups)})")
    defaults = {"width": tiles.strokes.width, "cap": tiles.strokes.cap, "join": tiles.strokes.join}
    glyphs: dict[str, GEO.Glyph | None] = {"glyph": None, "glyphSmall": None}
    for key in glyphs:
        if key not in doc["sign"]:
            continue
        glyphs[key], gp = GEO.glyph_from_json(doc["sign"][key], f"sign.{key}", defaults)
        probs += gp
        if glyphs[key] is not None and glyphs[key].overshoot() > GEO.BOX_TOL:
            probs.append(f"sign.{key}: the ink leaves the 24-unit box by {fmt(glyphs[key].overshoot())} units")
    outs = tuple(k for k in OUTPUT_KINDS if k in doc["outputs"])
    if "web" in doc and "web" not in outs:
        probs.append("web is declared, but outputs does not list \"web\"")
    if "android" in outs and not tiles.kotlin_package:
        probs.append(f"outputs lists \"android\", but {TILES_PATH} names no kotlin.package for SebaroProductInfo.kt")
    if probs:
        raise KitError("; ".join(probs))
    return Product(id=doc["id"], name=doc["name"], short_name=doc.get("shortName", doc["name"]), group=doc["tile"],
                   sign=GEO.Sign(glyphs["glyph"], glyphs["glyphSmall"]), outputs=outs, web=dict(doc.get("web") or {}))


def read_declaration(path: pathlib.Path) -> tuple[Any, bytes]:
    try:
        raw = pathlib.Path(path).read_bytes()
    except OSError as exc:
        raise KitError(f"{path}: cannot read the declaration ({exc.strerror or exc})") from exc
    try:
        return json.loads(raw.decode("utf-8")), raw
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KitError(f"{path}: invalid JSON ({exc})") from exc


# ============================================================================= a product's outputs

def product_css(p: Product, tiles: Tiles, stamp: Stamp) -> str:
    """sign/product.css: the product's own scope on the tile colours of its group (tokens.css has the groups)."""
    var = tiles.groups[p.group]["css"]
    return (f"/* {stamp.generated}. The tile colours of {p.id}: its group's custom properties of the copy's\n"
            f"   tokens.css under the product's own id, for .sb-product-area, the start and an inlined tile. */\n"
            f'[data-sb-product="{p.id}"] {{\n'
            f"  --sb-product-tile: var({var});\n"
            f"  --sb-product-glyph: var({var}-glyph);\n"
            "}\n")


def product_info_kt(p: Product, tiles: Tiles, stamp: Stamp) -> str:
    """android/kotlin/SebaroProductInfo.kt: the product as the Compose wrappers take it, through the constructor of the
    class SebaroProduct(id, tile) in SebaroTheme.kt (token contract 1.14; the enum of older themes has none)."""
    pkg, const = tiles.kotlin_package, tiles.groups[p.group]["kotlin"]
    return (f"// generated by {stamp.tool} from {stamp.source} — do not edit\n"
            f"package {pkg}.product\n\n"
            f"import {pkg}.SebaroProduct\n"
            f"import {pkg}.{const.split('.', 1)[0]}\n\n"
            "/** This product for the wrappers that take one: its id and the group of its sign tile. */\n"
            f'val AppProduct = SebaroProduct("{p.id}", {const})\n')


def outputs(p: Product, tiles: Tiles, stamp: Stamp = Stamp()) -> dict[str, bytes]:
    """Every text output of the product, path (relative to the output folder) -> bytes, sorted by path: the product's
    files and, under render/, the SVG of each raster file (raster_sources)."""
    tile = tiles.tile(p.group)
    sign, strokes = p.sign, tiles.strokes
    files: dict[str, str] = {}
    if "android" in p.outputs:
        res = "android/res"
        for name in LAYERS:
            files[f"{res}/drawable/ic_launcher_{name}.xml"] = svg_to_vector_drawable(
                layer_svg(sign, tile, name, f"{p.id} {name}"), f"{p.id}/{name}.svg", source=stamp.drawing(name),
                tool=stamp.tool)
        for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
            files[f"{res}/mipmap-anydpi-v26/{name}"] = adaptive_icon_xml(stamp)
        files[f"{res}/drawable/{STATUS_ICON}"] = notify_icon_xml(
            notify_svg(sign, strokes, tiles.notify_pad, f"{p.id} notification"), f"{p.id}/notify",
            source=stamp.drawing("notification small master"), tool=stamp.tool)
        for name, small in zip(sign_drawable_names(p.id), (False, True)):
            files[f"{res}/drawable/{name}"] = in_app_tile_xml(sign, strokes, tile, small=small, label=name,
                                                              tool=stamp.tool)
        for folder, scheme in (("values", "light"), ("values-night", "dark")):
            files[f"{res}/{folder}/{SPLASH_XML}"] = splash_colours_xml(scheme, tiles.grounds[scheme].upper(), stamp)
        group = tiles.groups[p.group]
        for name, splash in zip(start_symbol_names(p.id), (False, True)):
            files[f"{res}/drawable/{name}"] = start_symbol_xml(sign.glyph, group["glyph"], splash=splash, label=name,
                                                               tool=stamp.tool)
        files[f"{res}/values/{START_XML}"] = start_colour_xml(group["tile"])
        files[f"{res}/values-v31/{START_XML}"] = start_theme_xml(p.id)
        files[f"{res}/values/{START_THEME_XML}"] = start_theme_xml()
        files["android/kotlin/SebaroProductInfo.kt"] = product_info_kt(p, tiles, stamp)
    if "web" in p.outputs:
        colors = tiles.theme_colors()
        snippet = manifest_snippet(p.web_name, p.short_name, p.web.get("themeColor", tiles.grounds["light"]),
                                   p.web.get("backgroundColor", tiles.grounds["light"]))
        files["web/icon.svg"] = favicon_svg(sign, strokes, tile, 16, p.name)
        files["web/manifest.snippet.json"] = manifest_snippet_text(snippet)
        files["web/manifest.webmanifest"] = manifest_text(manifest_full(snippet, p.web.get("manifest") or {}))
        files["web/head.snippet.html"] = head_snippet(stamp, theme_color_meta(colors) if p.head_theme_color else "")
        files[f"web/{THEME_COLOR_JSON}"] = theme_color_json(colors, p.head_theme_color, stamp)
    if "web" in p.outputs or "desktop" in p.outputs:
        files["sign/sign.svg"] = sign_svg(sign, strokes, p.name)
        files["sign/sign-small.svg"] = sign_svg(sign, strokes, p.name, small=True)
        files["sign/tile.svg"] = tile_svg(sign, tile, p.name)
        files["sign/tile-small.svg"] = tile_svg(sign, tile, p.name, small=True, strokes=strokes)
        files["sign/product.css"] = product_css(p, tiles, stamp)
    files.update(raster_sources(p, tiles))
    files[NOTICE_NAME] = notice_md(p, sorted(files), stamp)
    return {path: text.encode("utf-8") for path, text in sorted(files.items())}


def is_mark(path: str) -> bool:
    """Whether an output is a drawing of the product's sign (the sign, its tile, an icon): an SVG, an Android
    drawable or adaptive icon, a PNG or an ICO. The rest is code and data."""
    return (path.endswith((".svg", ".png", ".ico")) or "/drawable/" in path or "/mipmap-" in path)


def notice_md(p: Product, texts: list[str], stamp: Stamp) -> str:
    """NOTICE.md of the output folder (1.2.0): which of its files are the product's marks and which are code and
    data, by the licence file of the system (LICENSE.md of the copy, D76). TEXTS are the text outputs; the raster
    files are named with them, drawn or not."""
    marks = sorted(path for path in [*texts, *rasters(p)] if is_mark(path) and not path.startswith(RENDER_DIR + "/"))
    rest = sorted(path for path in texts if not is_mark(path))
    listed = lambda paths: ", ".join(f"`{path}`" for path in paths)   # noqa: E731
    return (f"# Notice: the files of this folder\n\n"
            f"{stamp.generated[0].upper()}{stamp.generated[1:]}.\n\n"
            f"The files of one product, {p.name} (`{p.id}`), made from its declaration with the product kit of the "
            "sebaro design system. They stand under two different terms, which the licence file of the system "
            "(`LICENSE.md` in its copy) sets:\n\n"
            "- **The product's sign and every drawing made from it: all rights reserved.** The sign, its tile, the "
            "favicon and the icons are marks of the product. The MIT licence of the sebaro design system does not "
            "cover them, and the licence of the repository that holds this folder covers them only where the owner "
            f"of the product says so. These files: {listed(marks)}, and the drawings under `{RENDER_DIR}/` they are "
            "drawn from.\n"
            "- **Code and data: MIT**, like the kit that wrote them (the text is in `LICENSE.md` of the copy): "
            f"{listed(rest + [RECORD_NAME, RASTER_RECORD_NAME])} and this notice.\n\n"
            "A product whose repository is under an open licence states the first kind as not covered by it: a REUSE "
            "`.license` file beside the files, or an entry in the repository's own notice. Nothing else has to be "
            "stated for this folder.\n")


def rasters(p: Product, body_px: int = RASTER_DESKTOP_BODY_PX) -> dict[str, dict]:
    """The PNG and ICO files of the product, path -> what the renderer draws: for a PNG `width`, `height`, `alpha`
    (false: 24-bit RGB, every pixel opaque) and its `source`; for the ICO its `entries` in file order, each with
    `size` and `source`. A source is an SVG under render/ that outputs() writes. `body` (the desktop icon): the
    source is drawn at body x body and stands in the middle of a transparent field of the file's size."""
    def png(name: str, px: int, alpha: bool) -> dict:
        return {"width": px, "height": px, "alpha": alpha, "source": f"{RENDER_DIR}/{name}.svg"}
    out: dict[str, dict] = {}
    if "android" in p.outputs:      # the Play listing's icon; an app itself needs no raster (adaptive icon, API 26)
        out["android/play-store-512.png"] = png("android/play-store-512", 512, True)
    if "web" in p.outputs:
        out["web/favicon.ico"] = {"entries": [{"size": px, "source": f"{RENDER_DIR}/web/favicon-{px}.svg"}
                                              for px in FAVICON_ICO_PX]}
        out["web/apple-touch-icon.png"] = png("web/apple-touch-icon", 180, False)
        out["web/icon-192.png"] = png("web/icon-192", 192, True)
        out["web/icon-512.png"] = png("web/icon-512", 512, True)
        out["web/icon-mask.png"] = png("web/icon-mask", 512, False)
    if "desktop" in p.outputs:
        out["desktop/icon-1024.png"] = dict(png("desktop/icon-1024", DESKTOP_ICON_PX, True), body=body_px)
    return out


def raster_sources(p: Product, tiles: Tiles) -> dict[str, str]:
    """render/<raster>.svg for every file of rasters(): what the renderer draws at the raster's size. The launcher
    icon as one drawing, cut to the middle each raster shows (tiles.json "raster"); the favicon per ICO entry."""
    tile, sign, views = tiles.tile(p.group), p.sign, tiles.raster["viewports"]
    files: dict[str, str] = {}
    if "android" in p.outputs:
        files[f"{RENDER_DIR}/android/play-store-512.svg"] = icon_svg(sign, tile, 512, views["play"])
    if "web" in p.outputs:
        for px in FAVICON_ICO_PX:
            files[f"{RENDER_DIR}/web/favicon-{px}.svg"] = favicon_svg(sign, tiles.strokes, tile, px, p.name)
        files[f"{RENDER_DIR}/web/apple-touch-icon.svg"] = icon_svg(sign, tile, 180, views["appleTouch"])
        for px in (192, 512):
            files[f"{RENDER_DIR}/web/icon-{px}.svg"] = icon_svg(sign, tile, px, views["any"], rounded=True)
        files[f"{RENDER_DIR}/web/icon-mask.svg"] = icon_svg(sign, tile, 512, views["maskable"])
    if "desktop" in p.outputs:
        files[f"{RENDER_DIR}/desktop/icon-1024.svg"] = icon_svg(
            sign, tile, tiles.raster["desktopBodyPx"], views["desktop"], squircle=tiles.raster["squircleExponent"])
    return files


def raster_source_paths(job: dict) -> list[str]:
    return [e["source"] for e in job["entries"]] if "entries" in job else [job["source"]]


# ============================================================================= build and check

def declaration_meaning(raw: bytes) -> str:
    """The sha256 of what a declaration says (1.2.0): its JSON with the keys sorted and no white space. A formatter
    that moves white space or reorders keys does not change it; any value does, a `$comment` too."""
    doc = json.loads(raw.decode("utf-8"))
    return sha256_bytes(json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def record_doc(p: Product, tiles: Tiles, declaration: pathlib.Path, raw: bytes, files: dict[str, bytes]) -> dict:
    return {
        "$generated": f"generated by {KIT_PATH} build — do not edit; `{KIT_PATH} check` compares it with the files, "
                      "the declaration and the copy",
        "format": RECORD_FORMAT,
        "kit": TOOL_VERSION,
        "product": p.id,
        "outputs": list(p.outputs),
        "declaration": {"file": pathlib.Path(declaration).name, "sha256": sha256_bytes(raw),
                        "meaning": declaration_meaning(raw)},
        "tiles": {"file": TILES_PATH, "system": tiles.system, "sha256": tiles.sha256},
        "files": {path: sha256_bytes(data) for path, data in files.items()},
        "raster": {"renderer": RENDER_PATH, "record": RASTER_RECORD_NAME,
                   "files": rasters(p, tiles.raster["desktopBodyPx"])},
    }


def read_record(out: pathlib.Path) -> dict | None:
    """The record of the last build, or None when the folder has none. An unreadable record is a KitError."""
    p = pathlib.Path(out) / RECORD_NAME
    if not p.is_file():
        return None
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KitError(f"{p}: unreadable record ({exc}); delete it and run build") from exc
    if not isinstance(doc, dict) or not isinstance(doc.get("files"), dict) \
            or not all(isinstance(k, str) and isinstance(v, str) for k, v in doc["files"].items()):
        raise KitError(f"{p}: not a record of this kit (no \"files\" object); delete it and run build")
    return doc


def read_raster_record(out: pathlib.Path) -> dict | None:
    """The renderer's record of the raster files in the folder, or None when it has none: path -> {"sha256",
    "sources": {source path -> sha256 of the SVG it was drawn from}}. An unreadable record is a KitError."""
    p = pathlib.Path(out) / RASTER_RECORD_NAME
    if not p.is_file():
        return None
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KitError(f"{p}: unreadable record ({exc}); delete it and run {RENDER_PATH}") from exc
    files = doc.get("files") if isinstance(doc, dict) else None
    if not isinstance(files, dict) or not all(
            isinstance(k, str) and isinstance(v, dict) and isinstance(v.get("sha256"), str)
            and isinstance(v.get("sources"), dict) for k, v in files.items()):
        raise KitError(f"{p}: not a record of {RENDER_PATH} (no \"files\" with sha256 and sources); delete it and "
                       "render again")
    return doc


def raster_findings(out: pathlib.Path, due: dict[str, dict], files: dict[str, bytes]) -> list[tuple[str, str]]:
    """The raster files against the renderer's record and the SVGs a build writes now, by sha256 (no pixel is
    compared). missing: the file or its entry in the record is not there. stale: it was drawn from another SVG than
    the kit draws now, or is no longer an output. edited: the file is not the one the renderer wrote."""
    record = read_raster_record(out)
    recorded = record["files"] if record else {}
    findings: list[tuple[str, str]] = []
    for rel, job in due.items():
        dest, entry = pathlib.Path(out) / rel, recorded.get(rel)
        if entry is None or not dest.is_file():
            findings.append(("missing", f"{rel} (a raster file: render it with {RENDER_PATH})"))
        elif entry["sources"] != {src: sha256_bytes(files[src]) for src in raster_source_paths(job)}:
            findings.append(("stale", f"{rel} (a raster file drawn from another {RENDER_DIR}/ SVG than the build gives now: render again)"))
        elif sha256_bytes(dest.read_bytes()) != entry["sha256"]:
            findings.append(("edited", f"{rel} (a raster file: it is not the one {RENDER_PATH} wrote)"))
    for rel in sorted(set(recorded) - set(due)):
        findings.append(("stale", f"{rel} (a raster file that is no longer an output of this declaration)"))
    return findings


def _inside(path: pathlib.Path, folder: pathlib.Path) -> bool:
    try:
        path.resolve().relative_to(folder.resolve())
        return True
    except ValueError:
        return False


def prepare(declaration: pathlib.Path, copy: pathlib.Path, out: pathlib.Path) -> tuple[Product, Tiles, bytes]:
    copy, out = pathlib.Path(copy), pathlib.Path(out)
    if not copy.is_dir():
        raise KitError(f"--copy {copy} is not a folder")
    if _inside(out, copy) or _inside(copy, out):
        raise KitError(f"--out {out} and the copy {copy} lie inside one another: the kit writes into a folder of its "
                       "own that the product owns, never into the copy")
    tiles = load_tiles(copy)
    doc, raw = read_declaration(declaration)
    try:
        return product_of(doc, tiles), tiles, raw
    except KitError as exc:
        raise KitError(f"{declaration}: {exc}") from exc


def build(declaration: pathlib.Path, copy: pathlib.Path, out: pathlib.Path) -> dict:
    """Write the outputs and the record into `out`; remove files an earlier build wrote that are no longer outputs.
    Returns the record."""
    out = pathlib.Path(out)
    product, tiles, raw = prepare(declaration, copy, out)
    files = outputs(product, tiles)
    previous = read_record(out) or {"files": {}}
    for rel in sorted(set(previous["files"]) - set(files)):
        old = out / rel
        if _inside(old, out) and old.is_file():
            old.unlink()
            for parent in old.parents:
                if parent == out or not _inside(parent, out) or any(parent.iterdir()):
                    break
                parent.rmdir()
    for rel, data in files.items():
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    record = record_doc(product, tiles, declaration, raw, files)
    (out / RECORD_NAME).write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return record


def check(declaration: pathlib.Path, copy: pathlib.Path, out: pathlib.Path, *,
          raster: bool = True) -> tuple[list[tuple[str, str]], list[str]]:
    """Compare `out` with what a build would write now. Returns (findings, notes); a finding is (kind, text) with kind
    missing (an output or the record is not there), edited (a file differs from what the build wrote) or stale (the
    build's files are whole, but the declaration, the copy or the kit give other outputs now). The raster files are
    compared by raster_findings; with raster=False they are counted in a note instead. Writes nothing."""
    out = pathlib.Path(out)
    product, tiles, raw = prepare(declaration, copy, out)
    files = outputs(product, tiles)
    findings: list[tuple[str, str]] = []
    notes: list[str] = []
    record = read_record(out)
    if record is None:
        findings.append(("missing", f"{RECORD_NAME} (no record of a build in {out})"))
        record = {"files": {}}
    recorded = record["files"]
    for rel, data in files.items():
        dest = out / rel
        if not dest.is_file():
            findings.append(("missing", rel))
            continue
        on_disk = sha256_bytes(dest.read_bytes())
        if on_disk == sha256_bytes(data):
            if recorded.get(rel) not in (None, on_disk):
                findings.append(("edited", f"{RECORD_NAME}: lists another sha256 for {rel} than the file has"))
        elif on_disk == recorded.get(rel):
            findings.append(("stale", rel))
        else:
            findings.append(("edited", rel))
    for rel in sorted(set(recorded) - set(files)):
        findings.append(("stale", f"{rel} (no longer an output of this declaration)"))
    name = pathlib.Path(declaration).name
    decl = record.get("declaration") if isinstance(record.get("declaration"), dict) else {}
    if recorded and "meaning" in decl:                    # 1.2.0: what the declaration says, not its bytes
        if decl["meaning"] != declaration_meaning(raw):
            findings.append(("stale", f"{name} changed since the build ({RECORD_NAME} records another declaration)"))
    elif recorded and decl.get("sha256") != sha256_bytes(raw):   # a record of kit 1.1 or older has the bytes alone
        findings.append(("stale", f"{name} changed since the build ({RECORD_NAME} has another sha256 of it; a record "
                                  f"of kit {record.get('kit')} compares the bytes, a build by this kit compares "
                                  "what the declaration says)"))
    rec_tiles = record.get("tiles") if isinstance(record.get("tiles"), dict) else {}
    if recorded and rec_tiles.get("sha256") != tiles.sha256:
        findings.append(("stale", f"{TILES_PATH} of the copy changed since the build"))
    if recorded and record.get("kit") != TOOL_VERSION:
        notes.append(f"built by kit {record.get('kit')}, this is kit {TOOL_VERSION}"
                     + ("" if findings else "; the outputs are the same"))
    due = rasters(product, tiles.raster["desktopBodyPx"])
    if due and raster:
        findings += raster_findings(out, due, files)
    elif due:
        notes.append(f"{len(due)} raster file(s) not checked (--no-raster): " + ", ".join(due))
    return findings, notes


# ============================================================================= workshop side: tiles.json of a system

def system_tiles(system: pathlib.Path) -> dict:
    """tiles_doc() of a system folder of sebaroDesign (dist/tokens.json, brand/brand.config.json, brand/signs.json and
    the package line of dist/SebaroTheme.kt)."""
    system = pathlib.Path(system)
    docs = {}
    for key, rel in (("tokens", "dist/tokens.json"), ("brand", "brand/brand.config.json"), ("registry", "brand/signs.json")):
        try:
            docs[key] = json.loads((system / rel).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise KitError(f"{system / rel}: cannot read ({exc})") from exc
    package = None
    theme = system / "dist" / "SebaroTheme.kt"
    if theme.is_file():
        m = re.search(r"^package\s+([\w.]+)\s*$", theme.read_text(encoding="utf-8"), re.M)
        package = m.group(1) if m else None
    return tiles_doc(docs["tokens"], docs["brand"], docs["registry"], kotlin_package=package)


# ============================================================================= CLI

def renderer_script() -> pathlib.Path:
    """The renderer beside this file: render.mjs in a copy, product_render.mjs in sebaroDesign's tools/."""
    for name in (pathlib.PurePosixPath(RENDER_PATH).name, "product_render.mjs"):
        if (HERE / name).is_file():
            return HERE / name
    raise KitError(f"--render needs the renderer beside the kit ({RENDER_PATH} of the copy); it is not in {HERE}")


def _cmd_build(a) -> int:
    script = node = None
    if a.render:                                # before anything is written: a missing renderer or Node is exit 2
        script, node = renderer_script(), shutil.which("node")
        if node is None:
            raise KitError(f"--render needs Node 20 or later on the PATH (it runs {RENDER_PATH})")
    record = build(a.declaration, a.copy, a.out)
    print(f"wrote {len(record['files'])} files and {RECORD_NAME} to {a.out} (product {record['product']}, "
          f"outputs {', '.join(record['outputs'])}, kit {TOOL_VERSION})")
    pending = record["raster"]["files"]
    if not pending:
        return 0
    if a.render:
        sys.stdout.flush()
        return subprocess.run([node, str(script), str(a.out)]).returncode
    print(f"to render: {len(pending)} raster file(s) from {RENDER_DIR}/ (build --render, or node {RENDER_PATH} "
          f"{a.out}): " + ", ".join(pending))
    return 0


def _cmd_check(a) -> int:
    findings, notes = check(a.declaration, a.copy, a.out, raster=not a.no_raster)
    for kind, text in findings:
        print(f"{kind:<8}{text}")
    for n in notes:
        print(f"note: {n}")
    if findings:
        counts = ", ".join(f"{sum(1 for k, _ in findings if k == kind)} {kind}"
                           for kind in ("missing", "edited", "stale") if any(k == kind for k, _ in findings))
        print(f"not up to date ({counts}): run {KIT_PATH} build {pathlib.Path(a.declaration).name} --copy … --out …"
              + (" --render" if any("(a raster file" in text for _, text in findings) else ""))
        return 1
    print(f"up to date: the outputs in {a.out} are what {pathlib.Path(a.declaration).name} and the copy give "
          f"(kit {TOOL_VERSION})")
    return 0


def _cmd_tiles(a) -> int:
    system = pathlib.Path(a.system)
    if not system.is_dir():
        system = HERE.parent / "systems" / a.system
    if not system.is_dir():
        raise KitError(f"no system folder {a.system!r}: `tiles` is for the maintainers of sebaro and reads the "
                       "system's sources (a path, or a slug under systems/ of their repository); a product needs "
                       f"only build and check, and its copy brings {TILES_PATH}")
    dest = pathlib.Path(a.out) / TILES_PATH
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(tiles_text(system_tiles(system)), encoding="utf-8")
    print(f"wrote {dest}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="product_kit.py", description="A product's sebaro outputs from sebaro.product.json "
                                 "(shared/PRODUCT-CONTRACT.md).")
    ap.add_argument("--version", action="version", version=f"product_kit.py {TOOL_VERSION}")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, func, text in (("build", _cmd_build, "write the outputs and the record into --out"),
                             ("check", _cmd_check, "exit 1 when an output is missing, edited or stale; writes nothing")):
        c = sub.add_parser(name, help=text)
        c.add_argument("declaration", help=f"the product's {DECLARATION_NAME}")
        c.add_argument("--copy", required=True, help=f"the folder of the system's copy (it holds {TILES_PATH})")
        c.add_argument("--out", required=True, help="the product's own output folder, outside the copy")
        if name == "build":
            c.add_argument("--render", action="store_true",
                           help=f"then draw the PNG and ICO files with {RENDER_PATH} (Node 20, the product's Playwright)")
        else:
            c.add_argument("--no-raster", action="store_true",
                           help="do not compare the PNG and ICO files (a product that keeps none of them)")
        c.set_defaults(func=func)
    t = sub.add_parser("tiles", help=f"for the maintainers of sebaro (it needs the system's sources, which no copy "
                                     f"holds): write <out>/{TILES_PATH}")
    t.add_argument("system", help="a system folder, or its slug under systems/")
    t.add_argument("--out", required=True, help="the copy's folder")
    t.set_defaults(func=_cmd_tiles)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    try:
        return a.func(a)
    except KitError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
