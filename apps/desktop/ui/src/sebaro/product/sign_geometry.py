"""Sign and tile geometry of a sebaroDesign system. Python 3.10+, standard library only.

What tools/signs.py (the registry, its measures and the screening; Pillow and fontTools) and tools/product_kit.py (a
product's outputs from its own declaration; standard library, shipped with a copy later as product/sign_geometry.py)
share: SVG path data, a sign as stroked and filled paths on the 24-unit grid with its stroke masters, and the tile
with the fixed foot (D143/D144). The code was moved out of signs.py, which imports every name back, so
`signs.Glyph`, `signs.flatten`, `signs.foot_tile` and the others are what they were. No command line: this is a module.

Path data is read by `path_events`, a port of fontTools 4.55.3 `svgLib/path/parser.py` and `arc.py` (MIT; the parser
after svg.path by Lennart Regebro, MIT; the arc after Blink's SVGPathNormalizer::DecomposeArcToCubic, BSD) with the
few lines of `misc/transform.py` the arc needs. The arithmetic is kept expression by expression, so the points are the
same floats fontTools gives and the error texts are the same; tools/tests/test_product_kit.py `PathData` compares the
two on every sign of the registry and on a syntax corpus.
"""
# Third-party notice for `path_events` and its helpers below (the port named in the docstring). fontTools is under the
# MIT licence; its parser is an adaptation of svg.path, Copyright (c) 2013-2014 Lennart Regebro, also MIT. The notice
# of fontTools 4.55.3, word for word, as the licence asks for every copy of a substantial portion:
#
#   MIT License
#
#   Copyright (c) 2017 Just van Rossum
#
#   Permission is hereby granted, free of charge, to any person obtaining a copy
#   of this software and associated documentation files (the "Software"), to deal
#   in the Software without restriction, including without limitation the rights
#   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
#   copies of the Software, and to permit persons to whom the Software is
#   furnished to do so, subject to the following conditions:
#
#   The above copyright notice and this permission notice shall be included in all
#   copies or substantial portions of the Software.
#
#   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
#   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
#   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
#   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
#   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
#   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
#   SOFTWARE.
from __future__ import annotations

import dataclasses
import html as _html
import math
import re
from typing import Any

BOX = 24.0                 # the sign grid: 24 x 24 units, (0, 0) top left, y down (SVG)
SMALL_GLYPH_MAX_PX = 24    # a sign's glyphSmall replaces its glyph at this size and below (favicon, notification)
BOX_TOL = 0.01             # ink may leave the 24-unit box by this much (flattening noise)
CAPS = ("butt", "round", "square")
JOINS = ("miter", "round", "bevel")


# ============================================================================= small helpers

def fmt(v: float, precision: int = 3) -> str:
    """Plain decimal, trailing zeros stripped, no '-0'."""
    s = f"{round(float(v), precision):.{precision}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def esc(v: Any) -> str:
    return _html.escape(str(v), quote=True)


# ============================================================================= SVG path data

_COMMANDS = set("MmZzLlHhVvCcSsQqTtAa")
_ARC_COMMANDS = set("Aa")
_UPPERCASE = set("MZLHVCSQTA")
_COMMAND_RE = re.compile("([MmZzLlHhVvCcSsQqTtAa])")
# https://www.w3.org/TR/css-syntax-3/#number-token-diagram, but -6.e-5 is read as "-6" then "-5"
_FLOAT_RE = re.compile(
    r"[-+]?"
    r"(?:"
    r"(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?"
    r"|"
    r"(?:\.[0-9]+(?:[eE][-+]?[0-9]+)?)"
    r")"
)
_BOOL_RE = re.compile("^[01]")
_SEPARATOR_RE = re.compile("[, \t]")
_ARC_ARGUMENT_TYPES = (("rx", _FLOAT_RE), ("ry", _FLOAT_RE), ("x-axis-rotation", _FLOAT_RE),
                       ("large-arc-flag", _BOOL_RE), ("sweep-flag", _BOOL_RE), ("x", _FLOAT_RE), ("y", _FLOAT_RE))
_TWO_PI = 2 * math.pi
_PI_OVER_TWO = 0.5 * math.pi
_EPSILON = 1e-15
_IDENTITY = (1, 0, 0, 1, 0, 0)     # (xx, xy, yx, yy, dx, dy)


def _tokenize_path(pathdef: str):
    arc_cmd = None
    for x in _COMMAND_RE.split(pathdef):
        if x in _COMMANDS:
            arc_cmd = x if x in _ARC_COMMANDS else None
            yield x
            continue
        if arc_cmd:
            try:
                yield from _tokenize_arc_arguments(x)
            except ValueError as e:
                raise ValueError(f"Invalid arc command: '{arc_cmd}{x}'") from e
        else:
            for token in _FLOAT_RE.findall(x):
                yield token


def _tokenize_arc_arguments(arcdef: str):
    raw_args = [s for s in _SEPARATOR_RE.split(arcdef) if s]
    if not raw_args:
        raise ValueError(f"Not enough arguments: '{arcdef}'")
    raw_args.reverse()
    i = 0
    while raw_args:
        arg = raw_args.pop()
        name, pattern = _ARC_ARGUMENT_TYPES[i]
        match = pattern.search(arg)
        if not match:
            raise ValueError(f"Invalid argument for '{name}' parameter: {arg!r}")
        j, k = match.span()
        yield arg[j:k]
        arg = arg[k:]
        if arg:
            raw_args.append(arg)
        i = 0 if i == 6 else i + 1      # wrap around every 7 consecutive arguments
    if i != 0:
        raise ValueError(f"Not enough arguments: '{arcdef}'")


def _transformed(m: tuple, other: tuple) -> tuple:
    """m with `other` applied first (fontTools Transform.transform)."""
    xx1, xy1, yx1, yy1, dx1, dy1 = other
    xx2, xy2, yx2, yy2, dx2, dy2 = m
    return (xx1 * xx2 + xy1 * yx2, xx1 * xy2 + xy1 * yy2, yx1 * xx2 + yy1 * yx2, yx1 * xy2 + yy1 * yy2,
            xx2 * dx1 + yx2 * dy1 + dx2, xy2 * dx1 + yy2 * dy1 + dy2)


def _norm_sin_cos(v: float) -> float:
    if abs(v) < _EPSILON:
        v = 0
    elif v > 1 - _EPSILON:
        v = 1
    elif v < -1 + _EPSILON:
        v = -1
    return v


def _rotated(m: tuple, angle: float) -> tuple:
    c = _norm_sin_cos(math.cos(angle))
    s = _norm_sin_cos(math.sin(angle))
    return _transformed(m, (c, s, -s, c, 0, 0))


def _map_point(m: tuple, pt: complex) -> complex:
    xx, xy, yx, yy, dx, dy = m
    x, y = pt.real, pt.imag
    r = (xx * x + yx * y + dx, xy * x + yy * y + dy)
    return r[0] + r[1] * 1j


def _arc_cubics(current_point: complex, rx: float, ry: float, rotation: float, large: bool, sweep: bool,
                target_point: complex):
    """An elliptical arc as cubic Bezier segments, one per 90 degrees: (control 1, control 2, end) as complex."""
    angle = math.radians(rotation)
    # endpoint to centre parametrisation: https://www.w3.org/TR/SVG/implnote.html#ArcConversionEndpointToCenter
    rx = math.fabs(rx)
    ry = math.fabs(ry)
    if not (rx and ry):                         # a radius of 0: nothing is drawn (fontTools draws no line either)
        return
    if target_point == current_point:           # a zero-length arc
        return
    mid_point_distance = (current_point - target_point) * 0.5
    point_transform = _rotated(_IDENTITY, -angle)
    transformed_mid_point = _map_point(point_transform, mid_point_distance)
    square_rx = rx * rx
    square_ry = ry * ry
    square_x = transformed_mid_point.real * transformed_mid_point.real
    square_y = transformed_mid_point.imag * transformed_mid_point.imag
    # radii too small for the arc are scaled up: http://www.w3.org/TR/SVG/implnote.html#ArcCorrectionOutOfRangeRadii
    radii_scale = square_x / square_rx + square_y / square_ry
    if radii_scale > 1:
        rx *= math.sqrt(radii_scale)
        ry *= math.sqrt(radii_scale)
    point_transform = _rotated((1 / rx, 0, 0, 1 / ry, 0, 0), -angle)
    point1 = _map_point(point_transform, current_point)
    point2 = _map_point(point_transform, target_point)
    delta = point2 - point1
    d = delta.real * delta.real + delta.imag * delta.imag
    scale_factor_squared = max(1 / d - 0.25, 0.0)
    scale_factor = math.sqrt(scale_factor_squared)
    if sweep == large:
        scale_factor = -scale_factor
    delta *= scale_factor
    center_point = (point1 + point2) * 0.5
    center_point += complex(-delta.imag, delta.real)
    point1 -= center_point
    point2 -= center_point
    theta1 = math.atan2(point1.imag, point1.real)
    theta2 = math.atan2(point2.imag, point2.real)
    theta_arc = theta2 - theta1
    if theta_arc < 0 and sweep:
        theta_arc += _TWO_PI
    elif theta_arc > 0 and not sweep:
        theta_arc -= _TWO_PI

    point_transform = _transformed(_rotated(_IDENTITY, angle), (rx, 0, 0, ry, 0, 0))
    # adding 0.001 keeps an inexact atan2 from giving one segment too many (Blink)
    num_segments = int(math.ceil(math.fabs(theta_arc / (_PI_OVER_TWO + 0.001))))
    for i in range(num_segments):
        start_theta = theta1 + i * theta_arc / num_segments
        end_theta = theta1 + (i + 1) * theta_arc / num_segments
        t = (4 / 3) * math.tan(0.25 * (end_theta - start_theta))
        if not math.isfinite(t):
            return
        sin_start_theta = math.sin(start_theta)
        cos_start_theta = math.cos(start_theta)
        sin_end_theta = math.sin(end_theta)
        cos_end_theta = math.cos(end_theta)
        p1 = complex(cos_start_theta - t * sin_start_theta, sin_start_theta + t * cos_start_theta)
        p1 += center_point
        end = complex(cos_end_theta, sin_end_theta)
        end += center_point
        p2 = end
        p2 += complex(t * sin_end_theta, -t * cos_end_theta)
        yield _map_point(point_transform, p1), _map_point(point_transform, p2), _map_point(point_transform, end)


def path_events(pathdef: str):
    """SVG path data (the `d` attribute) as absolute drawing events, in order:
    ("M", pt) · ("L", pt) · ("C", control 1, control 2, pt) · ("Q", control, pt) · ("Z",) close · ("E",) the end of an
    open subpath. Relative commands, H, V, S and T are resolved; an arc becomes cubics, one per 90 degrees. A generator:
    malformed data raises ValueError, IndexError, TypeError or AttributeError where the reading stops."""
    current_pos = complex(0, 0)
    elements = list(_tokenize_path(pathdef))
    elements.reverse()                              # for .pop()
    start_pos = None
    command = None
    last_control = None
    while elements:
        if elements[-1] in _COMMANDS:
            last_command = command                  # used by S and T
            command = elements.pop()
            absolute = command in _UPPERCASE
            command = command.upper()
        else:
            if command is None:                     # numbers without a command
                raise ValueError("Unallowed implicit command in %s, position %s"
                                 % (pathdef, len(pathdef.split()) - len(elements)))
            last_command = command
        if command == "M":
            x = elements.pop()
            y = elements.pop()
            pos = float(x) + float(y) * 1j
            if absolute:
                current_pos = pos
            else:
                current_pos += pos
            if start_pos is not None:               # M not preceded by Z: the subpath before stays open
                yield ("E",)
            yield ("M", (current_pos.real, current_pos.imag))
            start_pos = current_pos
            command = "L"                           # further coordinate pairs are implicit linetos
        elif command == "Z":
            if current_pos != start_pos:
                yield ("L", (start_pos.real, start_pos.imag))
            yield ("Z",)
            current_pos = start_pos
            start_pos = None
            command = None                          # no implicit command after closing
        elif command == "L":
            x = elements.pop()
            y = elements.pop()
            pos = float(x) + float(y) * 1j
            if not absolute:
                pos += current_pos
            yield ("L", (pos.real, pos.imag))
            current_pos = pos
        elif command == "H":
            x = elements.pop()
            pos = float(x) + current_pos.imag * 1j
            if not absolute:
                pos += current_pos.real
            yield ("L", (pos.real, pos.imag))
            current_pos = pos
        elif command == "V":
            y = elements.pop()
            pos = current_pos.real + float(y) * 1j
            if not absolute:
                pos += current_pos.imag * 1j
            yield ("L", (pos.real, pos.imag))
            current_pos = pos
        elif command == "C":
            control1 = float(elements.pop()) + float(elements.pop()) * 1j
            control2 = float(elements.pop()) + float(elements.pop()) * 1j
            end = float(elements.pop()) + float(elements.pop()) * 1j
            if not absolute:
                control1 += current_pos
                control2 += current_pos
                end += current_pos
            yield ("C", (control1.real, control1.imag), (control2.real, control2.imag), (end.real, end.imag))
            current_pos = end
            last_control = control2
        elif command == "S":
            if last_command not in "CS":            # no curve before: the first control point is the current point
                control1 = current_pos
            else:                                   # the reflection of the curve's second control point
                control1 = current_pos + current_pos - last_control
            control2 = float(elements.pop()) + float(elements.pop()) * 1j
            end = float(elements.pop()) + float(elements.pop()) * 1j
            if not absolute:
                control2 += current_pos
                end += current_pos
            yield ("C", (control1.real, control1.imag), (control2.real, control2.imag), (end.real, end.imag))
            current_pos = end
            last_control = control2
        elif command == "Q":
            control = float(elements.pop()) + float(elements.pop()) * 1j
            end = float(elements.pop()) + float(elements.pop()) * 1j
            if not absolute:
                control += current_pos
                end += current_pos
            yield ("Q", (control.real, control.imag), (end.real, end.imag))
            current_pos = end
            last_control = control
        elif command == "T":
            if last_command not in "QT":
                control = current_pos
            else:
                control = current_pos + current_pos - last_control
            end = float(elements.pop()) + float(elements.pop()) * 1j
            if not absolute:
                end += current_pos
            yield ("Q", (control.real, control.imag), (end.real, end.imag))
            current_pos = end
            last_control = control
        elif command == "A":
            rx = abs(float(elements.pop()))
            ry = abs(float(elements.pop()))
            rotation = float(elements.pop())
            arc_large = bool(int(elements.pop()))
            arc_sweep = bool(int(elements.pop()))
            end = float(elements.pop()) + float(elements.pop()) * 1j
            if not absolute:
                end += current_pos
            for p1, p2, p3 in _arc_cubics(current_pos, rx, ry, rotation, arc_large, arc_sweep, end):
                yield ("C", (p1.real, p1.imag), (p2.real, p2.imag), (p3.real, p3.imag))
            current_pos = end
    if start_pos is not None:                       # no final Z: an open path
        yield ("E",)


# ============================================================================= geometry

class _Flattener:
    """Path events -> subpaths of points in grid units. Curves are flattened; their inner points are marked smooth
    (corner=False), so a stroke joins them with a round disc whatever the grammar's join is."""

    def __init__(self):
        self.subpaths: list[tuple[list, list, bool]] = []
        self.cur: tuple[list, list] | None = None
        self.start: tuple[float, float] | None = None

    def _begin_if_needed(self):
        if self.cur is None:      # drawing after Z without M continues at the subpath's start (SVG)
            p = self.start or (0.0, 0.0)
            self.cur = ([p], [True])

    def move(self, pt):
        self.flush(False)
        self.start = (float(pt[0]), float(pt[1]))
        self.cur = ([self.start], [True])

    def line(self, pt):
        self._begin_if_needed()
        self.cur[0].append((float(pt[0]), float(pt[1])))
        self.cur[1].append(True)

    def _add_curve(self, pts_fn, ctrl_len):
        self._begin_if_needed()
        n = max(4, min(128, math.ceil(ctrl_len / 0.75)))
        for i in range(1, n + 1):
            self.cur[0].append(pts_fn(i / n))
            self.cur[1].append(i == n)

    def cubic(self, p1, p2, p3):
        p0 = self.cur[0][-1] if self.cur else self.start
        ctrl = math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)

        def f(t):
            u = 1 - t
            return (u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1])
        self._add_curve(f, ctrl)

    def quadratic(self, p1, p2):
        p0 = self.cur[0][-1] if self.cur else self.start
        ctrl = math.dist(p0, p1) + math.dist(p1, p2)

        def f(t):
            u = 1 - t
            return (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])
        self._add_curve(f, ctrl)

    def flush(self, closed: bool):
        if self.cur is None:
            return
        pts, corners = self.cur
        self.cur = None
        clean_p, clean_c = [pts[0]], [corners[0]]
        for p, c in zip(pts[1:], corners[1:]):
            if math.dist(p, clean_p[-1]) > 1e-9:
                clean_p.append(p)
                clean_c.append(c)
        if closed and len(clean_p) > 1 and math.dist(clean_p[0], clean_p[-1]) <= 1e-9:
            clean_p.pop()
            clean_c.pop()
        self.subpaths.append((clean_p, clean_c, closed))


def flatten(d: str) -> list[tuple[list, list, bool]]:
    pen = _Flattener()
    try:
        for ev in path_events(d):
            if ev[0] == "M":
                pen.move(ev[1])
            elif ev[0] == "L":
                pen.line(ev[1])
            elif ev[0] == "C":
                pen.cubic(ev[1], ev[2], ev[3])
            elif ev[0] == "Q":
                pen.quadratic(ev[1], ev[2])
            else:                                   # "Z" closes, "E" ends an open subpath
                pen.flush(ev[0] == "Z")
        pen.flush(False)
    except Exception as exc:  # ValueError / IndexError / TypeError / AttributeError on malformed data
        raise ValueError(f"cannot parse path data ({exc})") from exc
    if not pen.subpaths:
        raise ValueError("path data draws nothing")
    return pen.subpaths


@dataclasses.dataclass
class Part:
    """One path of a sign: SVG path data on the 24-unit grid, stroked or filled."""
    d: str
    paint: str                 # "stroke" | "fill"
    width: float = 3.0         # stroke width in grid units (base master)
    cap: str = "round"
    join: str = "round"
    fill_rule: str = "nonzero"
    subpaths: list = dataclasses.field(default_factory=list, repr=False)

    def scaled(self, k: float) -> "Part":
        return dataclasses.replace(self, width=self.width * k) if self.paint == "stroke" and k != 1 else self


@dataclasses.dataclass
class Glyph:
    parts: list[Part]

    def master(self, k: float) -> "Glyph":
        """The same sign with every stroke width multiplied by k (a small master)."""
        return Glyph([p.scaled(k) for p in self.parts]) if k != 1 else self

    def polygons(self) -> list[tuple[str, Any]]:
        """[('stroke', polygon) | ('fill', (subpath polygons, rule))] in grid units."""
        out = []
        for p in self.parts:
            if p.paint == "stroke":
                for pts, corners, closed in p.subpaths:
                    for poly in stroke_polygons(pts, corners, closed, p.width, p.cap, p.join):
                        out.append(("stroke", poly))
            else:
                out.append(("fill", ([sp[0] for sp in p.subpaths if len(sp[0]) >= 3], p.fill_rule)))
        return out

    def ink_bounds(self) -> tuple[float, float, float, float] | None:
        xs, ys = [], []
        for kind, item in self.polygons():
            polys = [item] if kind == "stroke" else item[0]
            for poly in polys:
                xs += [q[0] for q in poly]
                ys += [q[1] for q in poly]
        return (min(xs), min(ys), max(xs), max(ys)) if xs else None

    def overshoot(self) -> float:
        """How far the ink leaves the 24-unit box on its worst side (0 when it stays inside)."""
        b = self.ink_bounds()
        if not b:
            return 0.0
        return max(0.0, -b[0], -b[1], b[2] - BOX, b[3] - BOX)

    def view(self) -> tuple[float, float, float]:
        """(x0, y0, side): the box, widened symmetrically when a heavier small master overshoots it."""
        m = self.overshoot()
        m = 0.0 if m <= BOX_TOL else m
        return (-m, -m, BOX + 2 * m)

    def svg_elements(self, colour: str = "currentColor", precision: int = 3) -> str:
        els = []
        for p in self.parts:
            if p.paint == "stroke":
                els.append(f'<path d="{esc(p.d)}" fill="none" stroke="{colour}" stroke-width="{fmt(p.width, precision)}" '
                           f'stroke-linecap="{p.cap}" stroke-linejoin="{p.join}"/>')
            else:
                rule = ' fill-rule="evenodd"' if p.fill_rule == "evenodd" else ""
                els.append(f'<path d="{esc(p.d)}" fill="{colour}"{rule}/>')
        return "".join(els)

    def svg(self, *, colour: str = "currentColor", title: str | None = None, view: tuple | None = None) -> str:
        x0, y0, side = view or self.view()
        vb = f"{fmt(x0)} {fmt(y0)} {fmt(side)} {fmt(side)}"
        t = f"<title>{esc(title)}</title>" if title else ""
        role = ' role="img"' if title else ' aria-hidden="true"'
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{fmt(side)}" height="{fmt(side)}"{role}>'
                f'{t}{self.svg_elements(colour)}</svg>\n')


def _unit(dx: float, dy: float) -> tuple[float, float]:
    n = math.hypot(dx, dy)
    return (dx / n, dy / n) if n > 1e-12 else (0.0, 0.0)


def _disc(c, r: float, n: int = 32) -> list[tuple[float, float]]:
    return [(c[0] + r * math.cos(2 * math.pi * i / n), c[1] + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def stroke_polygons(pts, corners, closed, w, cap, join, miterlimit: float = 4.0) -> list[list[tuple[float, float]]]:
    """A stroke as a union of convex polygons: one quad per segment, join pieces at corners (round, miter within the
    SVG miter limit, else bevel), round discs at smooth (flattened-curve) vertices, caps at the ends of open paths."""
    h = w / 2.0
    if h <= 0 or not pts:
        return []
    polys: list[list[tuple[float, float]]] = []
    if len(pts) == 1:                                   # a dot: only round and square caps paint it (SVG)
        x, y = pts[0]
        if cap == "round":
            polys.append(_disc(pts[0], h))
        elif cap == "square":
            polys.append([(x - h, y - h), (x + h, y - h), (x + h, y + h), (x - h, y + h)])
        return polys
    n = len(pts)
    segs = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
    for a, b in segs:
        ux, uy = _unit(b[0] - a[0], b[1] - a[1])
        nx, ny = -uy * h, ux * h
        polys.append([(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)])
    verts = range(n) if closed else range(1, n - 1)
    for i in verts:
        v, prev, nxt = pts[i], pts[i - 1], pts[(i + 1) % n]
        if not corners[i]:
            polys.append(_disc(v, h, 16))
            continue
        if join == "round":
            polys.append(_disc(v, h))
            continue
        d1 = _unit(v[0] - prev[0], v[1] - prev[1])
        d2 = _unit(nxt[0] - v[0], nxt[1] - v[1])
        for s in (1.0, -1.0):
            a1 = (v[0] - d1[1] * h * s, v[1] + d1[0] * h * s)
            a2 = (v[0] - d2[1] * h * s, v[1] + d2[0] * h * s)
            tip = None
            if join == "miter":
                den = d1[0] * d2[1] - d1[1] * d2[0]
                if abs(den) > 1e-9:
                    t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den
                    cand = (a1[0] + d1[0] * t, a1[1] + d1[1] * t)
                    if math.dist(cand, v) <= miterlimit * h + 1e-9:
                        tip = cand
            polys.append([v, a1, tip, a2] if tip else [v, a1, a2])
    if not closed:
        for end, nb in ((pts[0], pts[1]), (pts[-1], pts[-2])):
            if cap == "round":
                polys.append(_disc(end, h))
            elif cap == "square":
                ux, uy = _unit(end[0] - nb[0], end[1] - nb[1])
                nx, ny = -uy * h, ux * h
                e2 = (end[0] + ux * h, end[1] + uy * h)
                polys.append([(end[0] + nx, end[1] + ny), (e2[0] + nx, e2[1] + ny), (e2[0] - nx, e2[1] - ny),
                              (end[0] - nx, end[1] - ny)])
    return polys


# ============================================================================= parts from JSON

def part_from_json(obj: Any, where: str, defaults: dict) -> tuple[Part | None, list[str]]:
    """One glyph path from signs.json (or a candidate file); returns (part, problems)."""
    probs: list[str] = []
    if not isinstance(obj, dict):
        return None, [f"{where}: a glyph path must be an object"]
    unknown = set(obj) - {"d", "paint", "width", "cap", "join", "fillRule"}
    if unknown:
        probs.append(f"{where}: unknown keys {sorted(unknown)}")
    paint = obj.get("paint")
    if paint not in ("stroke", "fill"):
        probs.append(f"{where}: paint must be 'stroke' or 'fill', got {paint!r}")
    d = obj.get("d")
    if not isinstance(d, str) or not d.strip():
        probs.append(f"{where}: d (SVG path data) is required")
    width = obj.get("width", defaults.get("width", 3.0))
    if not isinstance(width, (int, float)) or isinstance(width, bool) or not 0 < width <= 12:
        probs.append(f"{where}: width must be a number in (0, 12], got {width!r}")
    cap = obj.get("cap", defaults.get("cap", "round"))
    join = obj.get("join", defaults.get("join", "round"))
    rule = obj.get("fillRule", "nonzero")
    if cap not in CAPS:
        probs.append(f"{where}: cap must be one of {CAPS}, got {cap!r}")
    if join not in JOINS:
        probs.append(f"{where}: join must be one of {JOINS}, got {join!r}")
    if rule not in ("nonzero", "evenodd"):
        probs.append(f"{where}: fillRule must be nonzero or evenodd, got {rule!r}")
    if paint == "fill" and any(k in obj for k in ("width", "cap", "join")):
        probs.append(f"{where}: width/cap/join belong to stroked paths only")
    if paint == "stroke" and "fillRule" in obj:
        probs.append(f"{where}: fillRule belongs to filled paths only")
    if probs:
        return None, probs
    try:
        subs = flatten(d)
    except ValueError as exc:
        return None, [f"{where}: {exc}"]
    return Part(d.strip(), paint, float(width), cap, join, rule, subs), []


def glyph_from_json(obj: Any, where: str, defaults: dict) -> tuple[Glyph | None, list[str]]:
    if not isinstance(obj, list) or not obj:
        return None, [f"{where}: glyph must be a non-empty list of paths"]
    parts, probs = [], []
    for i, item in enumerate(obj):
        p, pr = part_from_json(item, f"{where}[{i}]", defaults)
        probs += pr
        if p:
            parts.append(p)
    return (Glyph(parts) if not probs else None), probs


# ============================================================================= stroke masters and drawings per size

class StrokeMasters:
    """The stroke width a render size uses (grammar.strokeBySize). A mixin for an object with `width` (the base
    stroke) and `by_size` (((maxPx, width), ...) ascending): signs.Grammar and Strokes below."""

    def width_at(self, px: float) -> float:
        for max_px, w in self.by_size:
            if px <= max_px:
                return w
        return self.width

    def master_scale(self, px: float) -> float:
        return self.width_at(px) / self.width


@dataclasses.dataclass
class Strokes(StrokeMasters):
    """The stroke rules of a sign grammar without the registry around them."""
    width: float = 3.0
    cap: str = "round"
    join: str = "round"
    by_size: tuple = ()             # ((maxPx, width), ...) ascending


class SizedGlyphs:
    """Which drawing a render size uses. A mixin for an object with `glyph` and `glyph_small`: signs.Product and
    Sign below."""

    def glyph_for(self, px: float | None) -> Glyph | None:
        """The drawing used at px: glyphSmall at SMALL_GLYPH_MAX_PX and below when the product has one, else glyph."""
        if px is not None and px <= SMALL_GLYPH_MAX_PX and self.glyph_small is not None:
            return self.glyph_small
        return self.glyph

    def glyph_at(self, g: StrokeMasters, px: float) -> Glyph:
        """glyph_for(px) with the stroke master of that size."""
        return self.glyph_for(px).master(g.master_scale(px))


@dataclasses.dataclass
class Sign(SizedGlyphs):
    """A sign's drawings without the registry entry around them."""
    glyph: Glyph
    glyph_small: Glyph | None = None


# ============================================================================= the tile with the fixed foot

# D143/D144, bogen2.py t2("fuss"): one geometry source, in the visible 72-unit tile.
FOOT_LAYOUT = {"base": (17.4, 6.5, 37.2, 51.0, 54.0, 53.5),
               "small": (16.2, 4.5, 39.6, 49.0, 53.5, 53.0)}


def resolve_foot(config: dict, tokens: dict | None) -> dict:
    """Brand opt-in names generated tokens, never colours or mode-dependent roles."""
    if (not isinstance(config, dict) or set(config) != {"band", "line"}
            or any(not isinstance(v, str) for v in config.values())):
        raise ValueError("signs.foot must contain band and line token names")
    values = (tokens or {}).get("signFoot", {})
    if any(config[k] not in values for k in ("band", "line")):
        raise ValueError("signs.foot needs generated signFoot tokens (TOKEN-CONTRACT 1.11)")
    out = {k: values[config[k]] for k in ("band", "line")}
    if any(not isinstance(v, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", v) for v in out.values()):
        raise ValueError("signFoot colours must be opaque six-digit hex tokens")
    return out


def foot_elements(foot: dict, *, small: bool = False, adaptive: bool = False, mono: str | None = None) -> str:
    """Full-bleed background paints; monochrome keeps the band and leaves the line as a gap."""
    _, _, _, top, bottom, band = FOOT_LAYOUT["small" if small else "base"]
    offset, width, end = (18, 108, 108) if adaptive else (0, 72, 72)
    if mono is not None:
        return f'<rect y="{fmt(band + offset)}" width="{width}" height="{fmt(end - band - offset)}" fill="{mono}"/>'
    return (f'<rect y="{fmt(top + offset)}" width="{width}" height="{fmt(bottom-top)}" fill="{foot["line"]}"/>'
            f'<rect y="{fmt(band + offset)}" width="{width}" height="{fmt(end-band-offset)}" fill="{foot["band"]}"/>')


def foot_symbol(p: SizedGlyphs | Glyph, colour: str, *, small: bool = False, grammar: StrokeMasters | None = None,
                adaptive: bool = False) -> str:
    x, y, size, *_ = FOOT_LAYOUT["small" if small else "base"]
    offset = 18 if adaptive else 0
    gl = p if isinstance(p, Glyph) else (p.glyph_at(grammar, 16) if small and grammar else p.glyph)
    return (f'<g transform="translate({fmt(x+offset)} {fmt(y+offset)}) scale({fmt(size/BOX)})">'
            f'{gl.svg_elements(colour)}</g>')


def foot_tile(p: SizedGlyphs | Glyph, foot: dict, tile: str, ink: str, radius: float, *, small: bool = False,
              grammar: StrokeMasters | None = None, mono: str | None = None) -> str:
    """A 72-unit rounded tile; bottom arcs cut the band exactly like the tile's mask.

    Explicit path geometry keeps the result inside the Android VectorDrawable SVG subset.
    Foot tiles require radius <= 0.25, so both stripe tops precede the bottom arcs.
    """
    _, _, _, top, bottom, band = FOOT_LAYOUT["small" if small else "base"]
    r = radius * 72
    if r > 18:
        raise ValueError("foot tile radius must be <= 0.25")
    band_path = (f"M0 {fmt(band)}H72V{fmt(72-r)}Q72 72 {fmt(72-r)} 72H{fmt(r)}Q0 72 0 {fmt(72-r)}Z"
                 if r else f"M0 {fmt(band)}H72V72H0Z")
    # Quadratic corners would differ from rect rx; use exact circular arcs instead.
    if r:
        band_path = (f"M0 {fmt(band)}H72V{fmt(72-r)}A{fmt(r)} {fmt(r)} 0 0 1 {fmt(72-r)} 72"
                     f"H{fmt(r)}A{fmt(r)} {fmt(r)} 0 0 1 0 {fmt(72-r)}Z")
    if mono is not None:
        return f'<path d="{band_path}" fill="{mono}"/>' + foot_symbol(p, mono, small=small, grammar=grammar)
    return (f'<rect width="72" height="72" rx="{fmt(r,4)}" fill="{tile}"/>'
            f'<rect y="{fmt(top)}" width="72" height="{fmt(bottom-top)}" fill="{foot["line"]}"/>'
            f'<path d="{band_path}" fill="{foot["band"]}"/>'
            f'{foot_symbol(p, ink, small=small, grammar=grammar)}')
