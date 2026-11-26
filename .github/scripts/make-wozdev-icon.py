"""Render the wozdev plugin icon: a 1024x1024 RGBA PNG drawn with numpy signed-distance shapes.

Needs only numpy; the PNG is encoded by hand, so no image library is required.

Usage (from the repository root):
    python .github/scripts/make-wozdev-icon.py [output.png]

The output defaults to plugins/wozdev/.claude-plugin/icon.png. The plugin directory takes
the icon only on the plugin's first save or submission, so later changes do not update the listing.
"""
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

DEFAULT_OUT = Path(__file__).resolve().parents[2] / 'plugins/wozdev/.claude-plugin/icon.png'

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


def circle(cx, cy, r):
    return np.hypot(x - cx, y - cy) - r


rgb = np.zeros((N, N, 3), np.float32)


def paint(sdf, color, alpha=1.0):
    a = (cover(sdf) * alpha)[..., None]
    rgb[:] = rgb * (1 - a) + hexrgb(color) * a


# Background: diagonal indigo gradient inside a rounded square.
t = np.clip((x + y) / (2 * N), 0, 1)[..., None]
rgb[:] = hexrgb('#312E81') * (1 - t) + hexrgb('#1E1B4B') * t
mask = cover(rounded_rect(512, 512, 512, 512, 224))

# Fan-out branches from the hub to three agent nodes.
hub = (560, 512)
nodes = [((800, 300), '#2DD4BF'), ((830, 512), '#FBBF24'), ((800, 724), '#F472B6')]
for (nx, ny), _ in nodes:
    paint(segment(*hub, nx, ny, 34), '#C7D2FE', 0.85)

# Prompt chevron.
paint(np.minimum(segment(230, 320, 420, 512, 88), segment(420, 512, 230, 704, 88)), '#F8FAFC')

# Hub and nodes, each node with a dark ring so it separates from its branch.
paint(circle(*hub, 44), '#F8FAFC')
for (nx, ny), color in nodes:
    paint(circle(nx, ny, 84), '#1E1B4B')
    paint(circle(nx, ny, 66), color)

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
