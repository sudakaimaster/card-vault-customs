"""Recolor the Card Vault Customs emblem: purple accents -> site navy.
Keeps gold + silver. Preserves internal shading by mapping each purple
pixel's brightness onto a dark->light navy ramp.
"""
from PIL import Image
import sys

SRC = sys.argv[1]
OUT = sys.argv[2]

img = Image.open(SRC).convert("RGBA")
px = img.load()
w, h = img.size

# navy ramp (matches site: deep #0c1322 -> accent #27437a)
DARK = (8, 14, 30)
LIGHT = (44, 74, 138)

def is_purple(r, g, b):
    # violet/purple: blue dominant, red present, green lowest; excludes neutral grays
    # (bg texture has r~=g~=b so b-g stays small) and gold (b low).
    return (b > g + 12) and (r > g + 3) and (b > 38) and (b - g > 14)

def lerp(a, b, t):
    return int(a + (b - a) * t)

changed = 0
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        if is_purple(r, g, b):
            v = max(r, g, b)
            t = max(0.0, min(1.0, (v - 55) / (255 - 55)))
            nr = lerp(DARK[0], LIGHT[0], t)
            ng = lerp(DARK[1], LIGHT[1], t)
            nb = lerp(DARK[2], LIGHT[2], t)
            px[x, y] = (nr, ng, nb, a)
            changed += 1

img.save(OUT)
print("recolored pixels:", changed, "->", OUT, img.size)
