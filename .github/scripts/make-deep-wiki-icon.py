"""Render the deep-wiki plugin icon: a 1024x1024 RGBA PNG drawn with numpy signed-distance shapes.

A wiki page carrying a small Mermaid-style diagram and text lines, in the colors of the
dark VitePress theme the plugin generates. Needs only numpy; the PNG is encoded by hand,
so no image library is required.

Usage (from the repository root):
    python .github/scripts/make-deep-wiki-icon.py [output.png]

The output defaults to plugins/deep-wiki/.claude-plugin/icon.png. The plugin directory takes
the icon only on the plugin's first save or submission, so later changes do not update the listing.
"""
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

DEFAULT_OUT = Path(__file__).resolve().parents[2] / 'plugins/deep-wiki/.claude-plugin/icon.png'

N = 1024
y, x = np.mgrid[0:N, 0:N].astype(np.float32) + 0.5


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def cover(sdf):
    return np.clip(0.5 - sdf, 0.0, 1.0)


def rounded_rect(cx, cy, hw, hh, r):
    qx = np.abs(x - cx) - (hw - r)
    qy = np.abs(y - cy) - (hh - r)
    out = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
    return out + np.minimum(np.maximum(qx, qy), 0) - r


def segment(ax, ay, bx, by, w):
    px, py = x - ax, y - ay
    dx, dy = bx - ax, by - ay
    t = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - t * dx, py - t * dy) - w / 2


rgb = np.zeros((N, N, 3), np.float32)


def paint(sdf, color, alpha=1.0):
    a = (cover(sdf) * alpha)[..., None]
    rgb[:] = rgb * (1 - a) + hexrgb(color) * a


# Background: the theme's dark surfaces as a diagonal gradient inside a rounded square.
t = np.clip((x + y) / (2 * N), 0, 1)[..., None]
rgb[:] = hexrgb('#1C2333') * (1 - t) + hexrgb('#0D1117') * t
mask = cover(rounded_rect(512, 512, 512, 512, 224))

# A violet page behind, then the front page.
paint(rounded_rect(560, 548, 250, 318, 52), '#6D5DFC')
paint(rounded_rect(476, 488, 250, 318, 52), '#0D1117', 0.55)
paint(rounded_rect(468, 476, 250, 318, 52), '#E6EDF3')

# Mermaid-style diagram: a root node feeding two children.
root, left, right = (468, 300), (360, 470), (576, 470)
for cx, cy in (left, right):
    paint(segment(root[0], root[1] + 40, cx, cy - 40, 18), '#8B949E')
paint(rounded_rect(*root, 92, 50, 22), '#6D5DFC')
paint(rounded_rect(*left, 74, 46, 22), '#2DD4BF')
paint(rounded_rect(*right, 74, 46, 22), '#FBBF24')

# Text lines below the diagram.
for ly, x2 in ((616, 646), (680, 610), (744, 530)):
    paint(segment(290, ly, x2, ly, 28), '#8B949E')

rgba = np.dstack([rgb, mask])
data = (np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)
raw = b''.join(b'\x00' + row.tobytes() for row in data)


def chunk(tag, body):
    return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)


png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9))
       + chunk(b'IEND', b''))
out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
out.write_bytes(png)
print(f'wrote {out} ({len(png)} bytes)')
