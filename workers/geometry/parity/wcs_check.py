"""Confronte à ezdxf, en coordonnées MONDE, ce que le chemin Rust ÉCRIT.

compare.py ne juge que les anneaux de nesting : les arcs d'une polyligne y sont
des cordes (D-IMP-8), donc un bulge perdu ou de mauvais signe, ou un arc du
mauvais côté dans un fichier de coupe, ne s'y voit pas. Ici, chaque entité du
DXF canonique et du DXF exporté est relue par ezdxf et aplatie avec ses arcs,
puis comparée à la même entité sortie du pipeline Python.

Le chemin Rust ramène tout en WCS (extrusion +Z, plus de 210/220/230) là où
ezdxf garde l'OCS et l'extrusion de l'entité : les valeurs brutes diffèrent, la
courbe non. C'est donc la courbe qu'on compare (distance de Hausdorff).

Run from repo root:
    python workers/geometry/parity/wcs_check.py [fichier ...]
"""
import json
import math
import os
import subprocess
import sys
import tempfile

# Prod parity: no scipy in the worker image.
sys.modules["scipy"] = None
sys.modules["scipy.integrate"] = None
sys.modules["scipy.special"] = None

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "workers", "common"))
sys.path.insert(0, os.path.join(REPO, "workers", "fileprocessing"))

import logging  # noqa: E402

import ezdxf  # noqa: E402
from ezdxf import path as ezpath  # noqa: E402
from ezdxf import recover  # noqa: E402
from ezdxf.math import Matrix44  # noqa: E402
from shapely.geometry import LineString, Point  # noqa: E402

logging.disable(logging.CRITICAL)

GEO = os.path.join(REPO, "workers", "geometry")
EXE = ".exe" if os.name == "nt" else ""
IMPORT_CLI = os.path.join(GEO, "target", "release", "nest-import-cli" + EXE)
EXPORT_CLI = os.path.join(GEO, "target", "release", "nest-export-cli" + EXE)
CORPUS = os.path.join(GEO, "parity", "corpus_extra")

CUT_TYPES = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "POINT"}
# Hors périmètre, comme dans compare.py : HATCH->lignes côté Python seulement.
SKIP = {"hatch_pattern.dxf", "hatch_solid.dxf"}
# Écart admis sur une courbe (mm) : deux aplatissements à 0,002 mm du même arc.
TOLERANCE_MM = 0.01
# Placement non trivial de la tôle : rotation + translation, comme build_part.
PLACEMENTS = [(0.0, 0.0, 0.0), (math.radians(37.0), 20.0, 10.0)]


def curve(entity):
    """La courbe d'une entité en coordonnées monde, arcs compris."""
    if entity.dxftype() == "POINT":
        loc = entity.dxf.location
        return Point(loc.x, loc.y)
    pts = [(v.x, v.y) for v in ezpath.make_path(entity).flattening(0.002, segments=8)]
    if len(pts) < 2:
        return Point(pts[0]) if pts else None
    return LineString(pts)


def cut_entities(doc):
    return [e for e in doc.modelspace() if e.dxftype() in CUT_TYPES]


def compare_entities(ref, got):
    """Rend la première différence, None si les deux listes tracent la même chose."""
    if len(ref) != len(got):
        return f"{len(ref)} entités ezdxf contre {len(got)}"
    for i, (a, b) in enumerate(zip(ref, got)):
        ca, cb = curve(a), curve(b)
        if ca is None or cb is None:
            if ca is not cb:
                return f"#{i} {a.dxftype()} : courbe vide d'un seul côté"
            continue
        d = ca.hausdorff_distance(cb)
        if d > TOLERANCE_MM:
            return f"#{i} {a.dxftype()} contre {b.dxftype()} : écart {d:.4f} mm"
    return None


def read_written(path):
    return recover.readfile(path)[0]


def rust_canonical(src, out):
    r = subprocess.run([IMPORT_CLI, src, "--canonical"], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[:200])
    with open(out, "wb") as f:
        f.write(r.stdout)


def rust_export(canon_path, handles, placement, out):
    angle, x, y = placement
    spec = {
        "mode": "dxf",
        "sources": {"src": canon_path},
        "transforms": [{"item_id": "p", "file_slug": "src", "handles": handles,
                        "angle": angle, "x": x, "y": y, "color": None}],
        "output_unit": "mm",
    }
    r = subprocess.run([EXPORT_CLI], input=json.dumps(spec).encode(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[:200])
    with open(out, "wb") as f:
        f.write(r.stdout)
    # Lecture stricte, comme exports_check.py : la sortie doit rester un DXF valide.
    return ezdxf.readfile(out)


def python_export(entities, placement):
    """Réplique de build_part : copie par handle, rotation puis translation."""
    angle, x, y = placement
    m = Matrix44.z_rotate(angle) * Matrix44.translate(x, y, 0)
    out = []
    for e in entities:
        c = e.copy()
        c.transform(m)
        out.append(c)
    return out


def check_file(path, tmp):
    from dxf_utils import read_dxf_file

    name = os.path.basename(path)
    try:
        ref_doc = read_dxf_file(path)
        ref_error = None if ref_doc is not None else "illisible"
    except Exception as exc:  # refus du pipeline Python : le Rust doit refuser aussi
        ref_doc, ref_error = None, str(exc)

    canon_path = os.path.join(tmp, name + ".canon.dxf")
    imported = subprocess.run([IMPORT_CLI, path], capture_output=True)
    if ref_error is not None:
        if imported.returncode != 0:
            return None
        return f"Python refuse ({ref_error[:60]}), Rust accepte"
    if imported.returncode != 0:
        return f"Rust refuse : {imported.stderr.decode('utf-8', 'replace')[:80]}"

    rust_canonical(path, canon_path)
    ref = cut_entities(ref_doc)
    canon_doc = read_written(canon_path)
    got = cut_entities(canon_doc)
    err = compare_entities(ref, got)
    if err:
        return f"canonique : {err}"
    if not got:
        return None

    handles = [e.dxf.handle for e in got]
    for k, placement in enumerate(PLACEMENTS):
        out_path = os.path.join(tmp, f"{name}.export{k}.dxf")
        doc = rust_export(canon_path, handles, placement, out_path)
        err = compare_entities(python_export(ref, placement), cut_entities(doc))
        if err:
            return f"export {k} : {err}"
    return None


def main():
    if sys.argv[1:]:
        files = sys.argv[1:]
    else:
        files = [os.path.join(CORPUS, n) for n in sorted(os.listdir(CORPUS))
                 if n.lower().endswith(".dxf") and n not in SKIP]
    failed = 0
    with tempfile.TemporaryDirectory() as tmp:
        for path in files:
            err = check_file(path, tmp)
            if err:
                failed += 1
                print(f"  ECART {os.path.basename(path)} : {err}")
    print(f"\n=== WCS : {len(files) - failed}/{len(files)} fichiers tracent la même chose qu'ezdxf ===")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
