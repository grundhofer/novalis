#!/usr/bin/env python3
"""Write `app-icon.png`, the 1024x1024 source `cargo tauri icon` expands.

GENERATED SOURCE — placeholder. Regenerate the whole icon set with:

    python3 apps/desktop/src-tauri/icons/gen-app-icon.py
    cd apps/desktop && cargo tauri icon src-tauri/icons/app-icon.png

No Pillow, no dependencies: a PNG is a zlib-compressed scanline stream plus
three chunks, which is less code than an image library would be to install.

The mark is the Dev-Noir board glyph (a two-column frame) in the accent teal on
the canvas grey, so a placeholder icon is at least in the right palette
(packages/tokens/tokens.css). It is not a designed logo and is expected to be
replaced.
"""

import struct
import zlib
from pathlib import Path

SIZE = 1024
CANVAS = (0x08, 0x08, 0x0B)  # --ds-color-bg-canvas, dark
ACCENT = (0x4F, 0xB3, 0xBF)  # --ds-color-accent-default, dark

# The rounded square that macOS icons live inside: Apple's grid puts the
# artwork in roughly the middle 80% of the canvas.
MARGIN = 176
RADIUS = 180
STROKE = 56
DIVIDER = 40


def rounded_rect(x: int, y: int, size_x: int, size_y: int, radius: int):
    """Return a predicate: is (px, py) inside this rounded rectangle?"""
    x0, y0, x1, y1 = x, y, x + size_x, y + size_y

    def inside(px: int, py: int) -> bool:
        if not (x0 <= px < x1 and y0 <= py < y1):
            return False
        cx = min(max(px, x0 + radius), x1 - radius - 1)
        cy = min(max(py, y0 + radius), y1 - radius - 1)
        dx, dy = px - cx, py - cy
        return dx * dx + dy * dy <= radius * radius

    return inside


def build_rows() -> bytes:
    outer = rounded_rect(MARGIN, MARGIN, SIZE - 2 * MARGIN, SIZE - 2 * MARGIN, RADIUS)
    inner = rounded_rect(
        MARGIN + STROKE,
        MARGIN + STROKE,
        SIZE - 2 * (MARGIN + STROKE),
        SIZE - 2 * (MARGIN + STROKE),
        max(RADIUS - STROKE, 0),
    )
    divider_x0 = (SIZE - DIVIDER) // 2
    divider_x1 = divider_x0 + DIVIDER

    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type 0 (None) for this scanline
        for x in range(SIZE):
            frame = outer(x, y) and not inner(x, y)
            divider = inner(x, y) and divider_x0 <= x < divider_x1
            raw.extend(ACCENT if frame or divider else CANVAS)
    return bytes(raw)


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def main() -> None:
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(build_rows(), 9))
        + chunk(b"IEND", b"")
    )
    out = Path(__file__).with_name("app-icon.png")
    out.write_bytes(png)
    print(f"wrote {out} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
