"""Diff pixel entre deux captures PNG (verrou « zero changement visuel »).

Usage :
    python scripts/png-diff.py A.png B.png [diff.png]

Sortie : nombre de pixels differents, boite englobante, et repartition par
bandes horizontales de 50 px (pour dire OU se situe l'ecart).
"""
import sys

from PIL import Image, ImageChops


def main(a_path, b_path, out_path=None):
    a = Image.open(a_path).convert('RGB')
    b = Image.open(b_path).convert('RGB')
    if a.size != b.size:
        print(f'TAILLES DIFFERENTES : {a.size} vs {b.size}')
        w = min(a.size[0], b.size[0])
        h = min(a.size[1], b.size[1])
        a = a.crop((0, 0, w, h))
        b = b.crop((0, 0, w, h))
    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    mask = diff.convert('L').point(lambda v: 255 if v > 8 else 0)
    px = mask.load()
    w, h = mask.size
    total = 0
    bands = {}
    for y in range(h):
        row = 0
        for x in range(w):
            if px[x, y]:
                row += 1
        if row:
            total += row
            bands[y // 50 * 50] = bands.get(y // 50 * 50, 0) + row
    print(f'taille        : {w} x {h}')
    print(f'pixels differents (seuil 8/255) : {total}')
    print(f'boite englobante : {bbox}')
    if bands:
        top = sorted(bands.items(), key=lambda kv: -kv[1])[:10]
        print('bandes horizontales (y -> pixels) :')
        for y, n in sorted(top):
            print(f'  y {y:4d}-{y + 49:4d} : {n}')
    if out_path:
        Image.merge('RGB', (mask, mask, mask)).save(out_path)
        print('masque ecrit :', out_path)
    return total


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
