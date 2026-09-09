"""Étendue (AABB) des pièces posées dans un SVG de tôle — verrou L4 du plan
« dernière tôle » (docs/PLAN-DERNIERE-TOLE-2026-09-09.md §4).

Le SVG de tôle porte un `<path>` par pièce, avec
`transform="translate(tx ty) scale(1 -1) rotate(deg)"` (mêmes conventions
que `check_svg_dir.py`). On applique la transformation aux SOMMETS de
l'anneau externe : pour un polygone, l'AABB des sommets transformés est
exacte (les arcs sont déjà échantillonnés à l'export).

Aucune dépendance : tourne sur le poste, hors image worker.

Usage :
    python workers/nesting/bench/svg_extent.py <fichier.svg | dossier> [...]

Sortie : une ligne par fichier — pièces, xMin xMax yMin yMax (mm).
"""
import json
import math
import os
import re
import sys

NUM = r'-?\d+(?:\.\d+)?(?:[eE]-?\d+)?'
PATH_RE = re.compile(r'<path d="([^"]+)"([^>]*)>')
TR_RE = re.compile(r'translate\((' + NUM + r')[ ,]+(' + NUM + r')\)')
ROT_RE = re.compile(r'rotate\((' + NUM + r')')


def outer_ring(d_attr):
    """Premier sous-chemin M…Z = anneau externe."""
    subs = re.findall(r'M([^MZz]+)', d_attr)
    if not subs:
        return []
    nums = [float(v) for v in re.findall(NUM, subs[0])]
    return list(zip(nums[0::2], nums[1::2]))


def extent(svg_text):
    xs, ys, n = [], [], 0
    for m in PATH_RE.finditer(svg_text):
        d_attr, attrs = m.group(1), m.group(2)
        tm = TR_RE.search(attrs)
        if not tm:
            continue                      # contour de tôle, axes, etc.
        ring = outer_ring(d_attr)
        if len(ring) < 3:
            continue
        tx, ty = float(tm.group(1)), float(tm.group(2))
        rm = ROT_RE.search(attrs)
        th = math.radians(float(rm.group(1)) if rm else 0.0)
        c, s = math.cos(th), math.sin(th)
        for (px, py) in ring:
            # rotate(th) puis scale(1,-1) puis translate(tx,ty)
            rx = px * c - py * s
            ry = px * s + py * c
            xs.append(tx + rx)
            ys.append(ty - ry)
        n += 1
    if not xs:
        return None
    return {"parts": n, "xMin": min(xs), "xMax": max(xs),
            "yMin": min(ys), "yMax": max(ys)}


def files_of(arg):
    if os.path.isdir(arg):
        return [os.path.join(arg, f) for f in sorted(os.listdir(arg))
                if f.lower().endswith('.svg')]
    return [arg]


def main(args):
    out = {}
    for arg in args:
        for path in files_of(arg):
            with open(path, encoding='utf-8') as fh:
                e = extent(fh.read())
            name = os.path.basename(path)
            out[name] = e
            if e is None:
                print(f'{name:40} (aucune pièce)')
            else:
                print(f'{name:40} pièces {e["parts"]:>4}  '
                      f'x [{e["xMin"]:8.1f} ; {e["xMax"]:8.1f}]  '
                      f'y [{e["yMin"]:8.1f} ; {e["yMax"]:8.1f}]')
    print('@@EXTENT@@' + json.dumps(out) + '@@END@@')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1:])
