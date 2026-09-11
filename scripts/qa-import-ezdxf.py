#!/usr/bin/env python3
"""
Coureur ezdxf du lot C — PLAN-IMPORT-2026-09-09 §3 / §4.

Mesure, fichier par fichier, ce que fait la chaîne d'import PRODUCTION du
worker fileprocessing (`dxf_utils.read_dxf_file` puis
`core.geometry.build_geometry.build_geometry`, exactement comme
`core/main.py`) et écrit un JSON par fichier selon la grille du §4.

AUCUN code produit n'est modifié : ce script n'est qu'un observateur.

Il DOIT tourner dans l'image docker fileprocessing (ezdxf + shapely +
worker_common n'existent pas sur le poste) :

    docker run --rm -i \
      -v "//c/…/Nestorcut/.testparts:/data:ro" \
      -v "//c/…/Nestorcut/docs/qa/import-2026-09-09/ezdxf:/out" \
      nest2d-file-processing-worker:dev \
      python - /data --out /out --version <commit> < scripts/qa-import-ezdxf.py

Le code du worker vit dans /app (WORKDIR de l'image) et sys.path[0] == ''
→ `import dxf_utils` et `import core.geometry.build_geometry` résolvent
les modules de production sans copie ni PYTHONPATH.

Une exception sur un fichier = statut `refused` avec le message dans le
JSON ; le coureur ne s'arrête JAMAIS.

Sorties : le résumé lisible va sur stdout, les logs JSON de worker_common
sur stderr (ajouter `2>/dev/null` pour ne garder que le résumé).

--- Définitions des champs mesurés (grille §4) ------------------------------

id                  radical du nom de fichier, assaini [A-Za-z0-9._-]
importer            "ezdxf"
version             --version (commit du dépôt), sinon "unknown"
status              read      : lu sans rien réparer
                    repaired  : lu, mais l'auditeur ezdxf a corrigé quelque
                                chose et/ou du linework est resté pendant
                                (dangles) et/ou une entité n'a pas pu être
                                convertie
                    refused   : exception, document illisible, modelspace
                                vide (le worker lève « Entity count is 0 »)
                                ou 0 pièce fermée (« Closed parts is 0 »)
error               message d'exception (type: texte), sinon null
failingEntity       "TYPE#handle" de la première entité dont la conversion
                    shapely a levé, sinon null
unitDeclared        $INSUNITS du document SOURCE (0 = sans unité) ; null si
                    la source n'est pas un DXF (SVG)
unitDetected        nom de l'unité déduite du code ($INSUNITS) ; "unitless"
                    si 0 — la chaîne ezdxf traite alors le fichier comme mm
scaleApplied        facteur appliqué vers le mm canonique (insunits_to_mm)
entities            comptes par dxftype() dans le modelspace SOURCE
parts               pièces fermées retenues (build_geometry + to_mongo_dict,
                    filtre bbox < 0,1 mm compris) — le compte que le worker
                    écrit dans polygonParts
holes               somme des anneaux intérieurs de ces pièces
openContours        segments de linework restés PENDANTS après nodage et
                    polygonisation (shapely polygonize_full → dangles) :
                    du trait qui n'a fermé aucune face
openContoursClosed  null — la chaîne ezdxf n'a pas d'étape de fermeture
                    comptable (la grille GRID_SIZE=1e-4 recolle des
                    micro-jointures sans jamais les dénombrer)
blocksFlattened     nombre d'INSERT de premier niveau du modelspace source
                    (decompose_bounded les résout récursivement)
splines             nombre de SPLINE du modelspace source
splinesHandled      "sampled" si splines > 0 (flattening distance=tolérance),
                    null sinon — la chaîne ezdxf ne refuse jamais un spline
ms                  durée de l'import PRODUCTION seule (read_dxf_file +
                    build_geometry + to_mongo_dict), instrumentation exclue
"""

import argparse
import json
import os
import re
import sys
import tempfile
import time
import traceback

# --- modules de production (image fileprocessing, WORKDIR /app) -------------
import ezdxf
from ezdxf import recover

from dxf_utils import read_dxf_file
from core.geometry.build_geometry import GRID_SIZE, build_geometry
# Lot 2a : les bornes d'import de PRODUCTION (plafond d'entités + budget de
# temps). Le coureur doit refuser ce que le worker refuse, pas autre chose.
from core.import_budget import (
    Deadline,
    ImportTooHeavy,
    max_entity_limit_from_env,
    time_budget_s_from_env,
)
from core.format_detect import detect_format
from worker_common.geometry.dxf_parser import convert_entity_to_shapely
from worker_common.geometry.units import (
    insunits_code,
    insunits_detail,
    insunits_to_mm,
    unit_name,
)

from shapely import set_precision, unary_union
from shapely.geometry import LineString
from shapely.ops import polygonize_full

# Tolérance de flattening du produit : server/core/project/dxf.js écrit
# `flattening: 0.01` sur chaque fichier uploadé.
DEFAULT_TOLERANCE = 0.01

# Les noms d'unité viennent de la PRODUCTION (worker_common.geometry.units,
# `unit_name`) — pas d'une table locale : le verrou de parité du lot 2b
# compare `unitDetected` entre les deux importeurs, il doit comparer ce que
# le produit dit, pas ce que le coureur redéfinit.

GRID_FIELDS = [
    "id", "importer", "version", "status", "error", "failingEntity",
    "unitDeclared", "unitDetected", "scaleApplied", "entities", "parts",
    "holes", "openContours", "openContoursClosed", "blocksFlattened",
    "splines", "splinesHandled", "ms",
    # ADDITIF lot 2b : constats d'unité (texte identique côté wasm).
    "unitWarnings",
]


def blank_record(file_id: str, version: str) -> dict:
    """Grille §4 complète — tout champ non mesurable reste à null."""
    return {
        "id": file_id,
        "importer": "ezdxf",
        "version": version,
        "status": "refused",
        "error": None,
        "failingEntity": None,
        "unitDeclared": None,
        "unitDetected": None,
        "scaleApplied": None,
        "entities": None,
        "parts": None,
        "holes": None,
        "openContours": None,
        "openContoursClosed": None,
        "blocksFlattened": None,
        "splines": None,
        "splinesHandled": None,
        "ms": None,
        "unitWarnings": None,
    }


def sanitize_id(name: str) -> str:
    stem = os.path.splitext(os.path.basename(name))[0]
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_")
    return stem or "unnamed"


def count_entities(msp) -> dict:
    counts = {}
    for entity in msp:
        kind = entity.dxftype()
        counts[kind] = counts.get(kind, 0) + 1
    return dict(sorted(counts.items()))


def probe_source(path: str) -> dict:
    """Lecture SOURCE (avant nettoyage) : unités déclarées, entités, auditeur."""
    doc, auditor = recover.readfile(path)
    msp = doc.modelspace()
    counts = count_entities(msp)
    declared, name, factor, unit_warnings = insunits_detail(doc)
    return {
        "unitDeclared": declared,
        "unitDetected": name,
        "scaleApplied": float(factor),
        "unitWarnings": unit_warnings,
        "entities": counts,
        "blocksFlattened": counts.get("INSERT", 0),
        "splines": counts.get("SPLINE", 0),
        "auditorErrors": len(auditor.errors),
        "auditorFixes": len(auditor.fixes),
    }


def measure_linework(drawing, tolerance: float) -> dict:
    """
    Reprend le linework EXACTEMENT comme build_geometry (mêmes conversions,
    même GRID_SIZE) mais garde les rebuts : `dangles` = trait qui n'a fermé
    aucune face — la mesure « contours ouverts » de la grille.

    Instrumentation pure : hors du chronomètre `ms`.
    """
    linework = []
    failing_entity = None
    conversion_failures = 0

    for entity in drawing.modelspace():
        try:
            dxf_geometry = convert_entity_to_shapely(entity, tolerance)
        except Exception:
            conversion_failures += 1
            if failing_entity is None:
                handle = getattr(entity.dxf, "handle", "?")
                failing_entity = f"{entity.dxftype()}#{handle}"
            continue
        if dxf_geometry is None or dxf_geometry.geometry.is_empty:
            continue
        geometry = dxf_geometry.geometry
        if geometry.geom_type == "Polygon":
            linework.append(LineString(geometry.exterior.coords))
        elif geometry.geom_type == "LineString":
            linework.append(geometry)

    open_contours = 0
    if linework:
        noded = unary_union(set_precision(unary_union(linework), GRID_SIZE))
        _faces, _cuts, dangles, _invalid = polygonize_full(noded)
        open_contours = len(getattr(dangles, "geoms", []))

    return {
        "openContours": open_contours,
        "failingEntity": failing_entity,
        "conversionFailures": conversion_failures,
    }


def run_one(path: str, file_id: str, version: str, tolerance: float) -> dict:
    record = blank_record(file_id, version)

    try:
        with open(path, "rb") as handle:
            head = handle.read(2048)
        source_format = detect_format(head)
    except Exception as exc:
        record["error"] = f"{type(exc).__name__}: {exc}"
        return record

    tmp_path = None
    elapsed = 0.0
    probe_path = path

    # 0. DWG : conversion dwgread AVANT tout (miroir de `_make_dxf_copy`).
    #    Le DXF produit devient la source mesurée (unités, entités, auditeur).
    if source_format == "dwg":
        try:
            from core.dwg_convert import dwg_bytes_to_dxf_bytes

            started = time.perf_counter()
            with open(path, "rb") as handle:
                dxf_bytes = dwg_bytes_to_dxf_bytes(handle.read())
            elapsed += time.perf_counter() - started
            tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
            tmp.write(dxf_bytes)
            tmp.close()
            tmp_path = probe_path = tmp.name
        except Exception as exc:
            record["ms"] = round(elapsed * 1000)
            record["error"] = f"dwg {type(exc).__name__}: {exc}"
            return record

    # 1. Sonde du document source (unités déclarées, entités, auditeur).
    probe = None
    if source_format in ("dxf", "dwg"):
        try:
            probe = probe_source(probe_path)
        except Exception as exc:
            record["ms"] = round(elapsed * 1000)
            record["error"] = f"probe {type(exc).__name__}: {exc}"
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
            return record
        for key in ("unitDeclared", "unitDetected", "scaleApplied", "unitWarnings",
                    "entities", "blocksFlattened", "splines"):
            record[key] = probe[key]
        record["splinesHandled"] = "sampled" if probe["splines"] else None

    # 2. Chaîne d'import de production, chronométrée.
    try:
        started = time.perf_counter()
        if source_format == "svg":
            from core.svg_to_drawing import svg_bytes_to_drawing

            with open(path, "rb") as handle:
                drawing = svg_bytes_to_drawing(handle.read())
        else:
            drawing = read_dxf_file(probe_path)
        elapsed += time.perf_counter() - started
    except Exception as exc:
        record["ms"] = round(elapsed * 1000)
        record["error"] = f"{type(exc).__name__}: {exc}"
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return record

    if drawing is None:
        # read_dxf_file rend None sur IOError / DXFStructureError : le worker
        # lève alors « The uploaded file could not be read as a DXF ».
        record["ms"] = round(elapsed * 1000)
        record["error"] = "read_dxf_file returned None (unreadable DXF)"
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return record

    try:
        if source_format == "svg":
            # Pas de $INSUNITS source pour un SVG : svgelements normalise en
            # px CSS 96 dpi puis la conversion écrit du mm canonique.
            counts = count_entities(drawing.modelspace())
            record["entities"] = counts
            record["blocksFlattened"] = counts.get("INSERT", 0)
            record["splines"] = counts.get("SPLINE", 0)
            record["splinesHandled"] = "sampled" if record["splines"] else None
            record["unitDetected"] = "mm"
            record["scaleApplied"] = 1.0
            record["unitWarnings"] = []

        entity_count = len(drawing.modelspace())
        if entity_count == 0:
            # Miroir de `_set_valid_entity_count` : le worker échoue ici,
            # avant toute polygonisation.
            record["ms"] = round(elapsed * 1000)
            record["status"] = "refused"
            record["error"] = "Entity count is 0"
            return record

        # Miroir du plafond d'entités de production (lot 2a) : posé AVANT la
        # polygonisation, il porte le nombre.
        max_entities = max_entity_limit_from_env()
        if entity_count > max_entities:
            record["ms"] = round(elapsed * 1000)
            record["status"] = "refused"
            record["error"] = (
                f"gate: MAX_ENTITY_LIMIT ({entity_count} > {max_entities})"
            )
            return record

        # 3. Instrumentation (hors chrono) : contours pendants, entité fautive.
        try:
            linework = measure_linework(drawing, tolerance)
        except Exception as exc:  # l'instrumentation ne doit rien casser
            linework = {"openContours": None, "failingEntity": None,
                        "conversionFailures": 0}
            record["error"] = f"linework probe failed: {type(exc).__name__}: {exc}"
        record["openContours"] = linework["openContours"]
        record["failingEntity"] = linework["failingEntity"]

        # 4. Polygonisation : le compte que le worker écrit dans polygonParts,
        #    SOUS le budget de temps de production (lot 2a) — un dépassement
        #    est un refus, comme en prod, pas une mesure de 57 secondes.
        started = time.perf_counter()
        try:
            closed_parts = build_geometry(
                drawing,
                tolerance,
                deadline=Deadline(time_budget_s_from_env(), entity_count),
            )
        except ImportTooHeavy as heavy:
            elapsed += time.perf_counter() - started
            record["ms"] = round(elapsed * 1000)
            record["status"] = "refused"
            record["error"] = f"gate: IMPORT_TIME_BUDGET_S ({heavy})"
            return record
        mongo_parts = [part.to_mongo_dict() for part in closed_parts]
        mongo_parts = [part for part in mongo_parts if part is not None]
        elapsed += time.perf_counter() - started

        record["ms"] = round(elapsed * 1000)
        record["parts"] = len(mongo_parts)
        record["holes"] = sum(len(part.get("holes", [])) for part in mongo_parts)

        if record["parts"] == 0:
            record["status"] = "refused"
            record["error"] = "Closed parts is 0"
            return record

        repaired = bool(
            (probe and (probe["auditorErrors"] or probe["auditorFixes"]))
            or (record["openContours"] or 0) > 0
            or linework["conversionFailures"] > 0
            # Lot 2b : une unité supposée ou invraisemblable est un CONSTAT,
            # comme côté wasm (où elle entre dans `warnings`).
            or bool(record.get("unitWarnings"))
        )
        record["status"] = "repaired" if repaired else "read"
        return record
    except Exception as exc:
        record["ms"] = round(elapsed * 1000)
        record["status"] = "refused"
        record["error"] = f"{type(exc).__name__}: {exc}"
        return record
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Coureur ezdxf (lot C)")
    parser.add_argument("input", nargs="?", default="/data",
                        help="dossier des fichiers à mesurer (défaut /data)")
    parser.add_argument("--out", default="/out",
                        help="dossier des JSON de sortie (défaut /out)")
    parser.add_argument("--version", default=os.environ.get("QA_VERSION", "unknown"),
                        help="commit du dépôt, écrit tel quel dans chaque JSON")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE,
                        help=f"flattening (défaut {DEFAULT_TOLERANCE}, = celui du produit)")
    args = parser.parse_args()

    if not os.path.isdir(args.input):
        print(f"ERREUR: dossier d'entrée introuvable: {args.input}", file=sys.stderr)
        return 2
    os.makedirs(args.out, exist_ok=True)

    names = sorted(
        name for name in os.listdir(args.input)
        if os.path.isfile(os.path.join(args.input, name)) and not name.startswith(".")
    )
    if not names:
        print(f"ERREUR: aucun fichier dans {args.input}", file=sys.stderr)
        return 2

    print(f"ezdxf {ezdxf.__version__} — {len(names)} fichier(s), "
          f"tolérance {args.tolerance}, version {args.version}", flush=True)

    seen = {}
    tally = {"read": 0, "repaired": 0, "refused": 0}
    for name in names:
        path = os.path.join(args.input, name)
        file_id = sanitize_id(name)
        # Deux fichiers de radical identique ne doivent pas s'écraser.
        if file_id in seen:
            seen[file_id] += 1
            file_id = f"{file_id}-{seen[file_id]}"
        else:
            seen[file_id] = 0

        try:
            record = run_one(path, file_id, args.version, args.tolerance)
        except BaseException as exc:  # filet ultime : jamais d'arrêt du coureur
            record = blank_record(file_id, args.version)
            record["error"] = f"runner {type(exc).__name__}: {exc}"
            print(traceback.format_exc(), file=sys.stderr)

        # La grille est un contrat : aucun champ omis, aucun champ en trop.
        record = {key: record.get(key) for key in GRID_FIELDS}
        tally[record["status"]] = tally.get(record["status"], 0) + 1

        out_path = os.path.join(args.out, f"{file_id}.json")
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2, ensure_ascii=False, sort_keys=False)
            handle.write("\n")

        print(
            f"{record['status']:>8}  {file_id:<28} "
            f"parts={record['parts']} holes={record['holes']} "
            f"open={record['openContours']} splines={record['splines']} "
            f"unit={record['unitDetected']}({record['unitDeclared']}) "
            f"scale={record['scaleApplied']} ms={record['ms']}"
            + (f"  err={record['error']}" if record["error"] else ""),
            flush=True,
        )

    print(f"TOTAL {len(names)} — read={tally['read']} "
          f"repaired={tally['repaired']} refused={tally['refused']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
