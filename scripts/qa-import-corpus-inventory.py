"""Lot A (docs/PLAN-IMPORT-2026-09-09.md §3) — inventaire du corpus d'import.

Lit chaque fichier de /data/corpus (monté depuis .testparts/corpus) et sort
sur stdout un JSON : sha256, taille, encodage (ascii/binaire), $ACADVER
(+ nom de version), $INSUNITS, compteurs d'entités modelspace et blocs,
et quelques indicateurs de famille MESURÉS (splines, inserts imbriqués,
contours ouverts, textes/cotes, calques).

À lancer DANS l'image fileprocessing (ezdxf n'est pas sur le poste) :

  docker run --rm -i \
    -v "//c/Users/<user>/.../Nestorcut/.testparts:/data" \
    nest2d-file-processing-worker:dev python - < scripts/qa-import-corpus-inventory.py

Aucun accès réseau, aucune écriture : lecture seule + stdout.
"""
import hashlib
import json
import os
import sys
import traceback
from collections import Counter

import ezdxf
from ezdxf import recover

SRC = os.environ.get("CORPUS_DIR", "/data/corpus")

ACAD = {
    "MC0.0": "R1.0", "AC1.2": "R1.2", "AC1.40": "R1.40", "AC1.50": "R2.05",
    "AC2.10": "R2.10", "AC2.21": "R2.21", "AC2.22": "R2.22", "AC1001": "R2.22",
    "AC1002": "R2.50", "AC1003": "R2.60", "AC1004": "R9", "AC1006": "R10",
    "AC1009": "R11/R12", "AC1012": "R13", "AC1014": "R14", "AC1015": "R2000",
    "AC1018": "R2004", "AC1021": "R2007", "AC1024": "R2010", "AC1027": "R2013",
    "AC1032": "R2018",
}
INSUNITS = {
    0: "unitless", 1: "in", 2: "ft", 3: "mi", 4: "mm", 5: "cm", 6: "m",
    7: "km", 8: "uin", 9: "mil", 10: "yd", 11: "A", 12: "nm", 13: "um",
    14: "dm", 15: "dam", 16: "hm", 17: "Gm", 18: "au", 19: "ly", 20: "pc",
}


def raw_acadver(blob):
    """$ACADVER lu dans les octets bruts (marche même si ezdxf refuse)."""
    for enc in ("utf-8", "latin-1"):
        try:
            txt = blob[:400000].decode(enc, errors="ignore")
        except Exception:
            continue
        i = txt.find("$ACADVER")
        if i < 0:
            continue
        tail = txt[i:i + 200].splitlines()
        for j, line in enumerate(tail):
            if line.strip() == "1" and j + 1 < len(tail):
                return tail[j + 1].strip()
    return None


def scan(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    rec = {
        "file": os.path.basename(path),
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "binary": blob.startswith(b"AutoCAD Binary DXF"),
        "acadverRaw": raw_acadver(blob),
        "readable": False,
        "reader": None,
        "readError": None,
        "recoverErrors": 0,
        "insunits": None,
        "insunitsName": None,
        "measurement": None,
        "layers": None,
        "blocks": None,
        "entitiesModelspace": {},
        "entitiesBlocks": {},
        "insertsInModelspace": 0,
        "insertsNested": 0,
        "insertsScaled": 0,
        "insertsRotated": 0,
        "openPolylines": 0,
        "closedPolylines": 0,
        "splines": 0,
        "ellipses": 0,
        "bulgeVertices": 0,
        "textLike": 0,
        "dimLike": 0,
        "hatches": 0,
    }
    rec["acadverName"] = ACAD.get(rec["acadverRaw"] or "", None)

    doc = None
    try:
        doc = ezdxf.readfile(path)
        rec["reader"] = "readfile"
    except Exception as exc:
        rec["readError"] = f"{type(exc).__name__}: {exc}"
        try:
            doc, auditor = recover.readfile(path)
            rec["reader"] = "recover"
            rec["recoverErrors"] = len(auditor.errors)
        except Exception as exc2:
            rec["readError"] = f"{rec['readError']} | recover: {type(exc2).__name__}: {exc2}"
            return rec
    if doc is None:
        return rec

    rec["readable"] = True
    hdr = doc.header
    rec["insunits"] = hdr.get("$INSUNITS", None)
    rec["insunitsName"] = INSUNITS.get(rec["insunits"], None)
    rec["measurement"] = hdr.get("$MEASUREMENT", None)
    if rec["acadverRaw"] is None:
        rec["acadverRaw"] = hdr.get("$ACADVER", None)
        rec["acadverName"] = ACAD.get(rec["acadverRaw"] or "", None)
    try:
        rec["layers"] = len(doc.layers)
    except Exception:
        pass

    block_names = []
    try:
        block_names = [b.name for b in doc.blocks
                       if not b.name.startswith(("*Model_Space", "*Paper_Space"))]
    except Exception:
        pass
    rec["blocks"] = len(block_names)

    def tally(container, counter):
        for e in container:
            t = e.dxftype()
            counter[t] += 1
            if t in ("LWPOLYLINE", "POLYLINE"):
                try:
                    closed = bool(e.closed) if t == "LWPOLYLINE" else bool(e.is_closed)
                except Exception:
                    closed = False
                if closed:
                    rec["closedPolylines"] += 1
                else:
                    rec["openPolylines"] += 1
                if t == "LWPOLYLINE":
                    try:
                        rec["bulgeVertices"] += sum(
                            1 for p in e.get_points("xyseb") if abs(p[4]) > 1e-12)
                    except Exception:
                        pass
                else:
                    try:
                        rec["bulgeVertices"] += sum(
                            1 for v in e.vertices if abs(v.dxf.bulge) > 1e-12)
                    except Exception:
                        pass
            elif t == "SPLINE":
                rec["splines"] += 1
            elif t == "ELLIPSE":
                rec["ellipses"] += 1
            elif t in ("TEXT", "MTEXT", "ATTDEF", "ATTRIB"):
                rec["textLike"] += 1
            elif t in ("DIMENSION", "LEADER", "MLEADER", "MULTILEADER",
                       "TOLERANCE", "ARC_DIMENSION"):
                rec["dimLike"] += 1
            elif t == "HATCH":
                rec["hatches"] += 1

    msp_counter = Counter()
    try:
        tally(doc.modelspace(), msp_counter)
        rec["insertsInModelspace"] = msp_counter.get("INSERT", 0)
        for e in doc.modelspace():
            if e.dxftype() == "INSERT":
                try:
                    if abs(e.dxf.rotation) > 1e-9:
                        rec["insertsRotated"] += 1
                    sx, sy = e.dxf.xscale, e.dxf.yscale
                    if abs(sx - 1) > 1e-9 or abs(sy - 1) > 1e-9:
                        rec["insertsScaled"] += 1
                except Exception:
                    pass
    except Exception as exc:
        rec["readError"] = (rec["readError"] or "") + f" | msp: {exc}"

    blk_counter = Counter()
    try:
        for name in block_names:
            blk = doc.blocks.get(name)
            tally(blk, blk_counter)
            if any(e.dxftype() == "INSERT" for e in blk):
                rec["insertsNested"] += 1
    except Exception:
        pass

    rec["entitiesModelspace"] = dict(sorted(msp_counter.items()))
    rec["entitiesBlocks"] = dict(sorted(blk_counter.items()))
    return rec


def main():
    out = []
    for name in sorted(os.listdir(SRC)):
        path = os.path.join(SRC, name)
        if not os.path.isfile(path):
            continue
        try:
            out.append(scan(path))
        except Exception:
            out.append({"file": name, "fatal": traceback.format_exc()[-800:]})
        print(f"scanned {name}", file=sys.stderr)
    print(json.dumps(out, indent=1, ensure_ascii=False))


main()
