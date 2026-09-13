import io
import os
import secrets
from worker_common.logger import setup_logger
from worker_common.mongo import db, get_bucket
from dxf_utils import read_dxf, scale_drawing, subset_drawing_bytes
from ezdxf.document import Drawing
from core.svg_generator import create_svg_from_doc

from datetime import datetime, timedelta, timezone
from typing import List
from ezdxf.document import Drawing
from shapely.geometry import Point
import time

from core.geometry.build_geometry import build_geometry
from core.import_budget import (
    Deadline,
    ImportTooHeavy,
    REASON_ENTITIES,
    max_entity_limit_from_env,
    time_budget_s_from_env,
)
from worker_common.geometry.import_findings import build_findings, empty_stats
from core.format_detect import detect_format
from core.svg_to_drawing import svg_bytes_to_drawing
from core.dwg_convert import dwg_bytes_to_dxf_bytes
from worker_common.colors import pick_colors
from worker_common.crypto import (
    encrypt_polygon_parts,
    get_dek,
    read_gridfs,
    resolve_polygon_parts,
    write_gridfs,
)

user_dxf_bucket = get_bucket("userDxf")
valid_dxf_bucket = get_bucket("validDxf")
user_dxf_files_svg_bucket = get_bucket("userDxfFilesSvg")

_drawing_cache = {}

def _getting_drawing(doc) -> Drawing:
    logger = setup_logger("getting_drawing")
    dxf_file_slug = doc["slug"]
    
    logger.info("Getting drawing", extra={"slug": dxf_file_slug})
    
    if dxf_file_slug in _drawing_cache:
        return _drawing_cache[dxf_file_slug]
    
    if not doc.get("isDxfCopyExist", False):
        raise Exception("Dxf copy not exists")
    
    dek = get_dek(db, doc)
    dxf_bytes = read_gridfs(valid_dxf_bucket, dxf_file_slug, doc["ownerId"], dek)

    # The valid bucket holds pipeline-produced copies — already canonical mm
    # (copies written before the units feature even declare meters while
    # holding mm numbers). Never re-normalize them.
    drawing = read_dxf(io.BytesIO(dxf_bytes), normalize_units=False)
    _drawing_cache[dxf_file_slug] = drawing
    
    return drawing

def _make_dxf_copy(doc) -> Drawing:
    logger = setup_logger("dxf_copy_maker")
    dxf_file_slug = doc["slug"]

    if doc.get("isDxfCopyExist", False):
        logger.info("Dxf copy already exists", extra={"dxf_file_slug": dxf_file_slug})
        return

    user_id = doc["ownerId"]

    logger.info("Making dxf copy", extra={"dxf_file_slug": dxf_file_slug})

    dek = get_dek(db, doc)
    dxf_bytes = read_gridfs(user_dxf_bucket, dxf_file_slug, user_id, dek)

    # SVG and DWG uploads are normalized at this boundary: whatever the
    # source, the canonical copy written to validDxf is ALWAYS a DXF in mm,
    # so polygonization/colors/previews/nesting never see the difference.
    source_format = detect_format(dxf_bytes)
    if source_format == "svg":
        logger.info("SVG source detected, converting", extra={"slug": dxf_file_slug})
        dxf_copy = svg_bytes_to_drawing(dxf_bytes)
    elif source_format == "dwg":
        logger.info("DWG source detected, converting", extra={"slug": dxf_file_slug})
        dxf_copy = read_dxf(io.BytesIO(dwg_bytes_to_dxf_bytes(dxf_bytes)))
    else:
        dxf_copy = read_dxf(io.BytesIO(dxf_bytes))

    if dxf_copy is None:
        # read_dxf returns None on IOError/DXFStructureError (recover a
        # échoué). Un crash brut "'NoneType' object has no attribute
        # 'modelspace'" n'aide personne — échouer proprement avec un
        # message actionnable.
        raise Exception(
            "The uploaded file could not be read as a DXF"
            + (" (the DWG conversion produced an unreadable file)"
               if source_format == "dwg" else "")
            + ". Check that the file is a valid DXF/DWG export."
        )

    logger.info("Make a copy Drawing info", extra={"entity_count": len(dxf_copy.modelspace())})
    
    dxf_copy_text_stream = io.StringIO()
    dxf_copy.write(dxf_copy_text_stream)
    dxf_copy_text = dxf_copy_text_stream.getvalue()
    dxf_copy_text_stream.close()
    
    dxf_copy_bytes = dxf_copy_text.encode('utf-8')
 
    try:
        valid_dxf_bucket.delete_by_name(filename=dxf_file_slug)
    except Exception as e:
        logger.info("Error deleting dxf file", extra={"error": e})
        
    write_gridfs(valid_dxf_bucket, dxf_file_slug, dxf_copy_bytes, user_id, dek)
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "isDxfCopyExist": True,
            # Declared drawing units of the SOURCE file ($INSUNITS code,
            # 0 = unitless). Geometry is normalized to mm at import; this is
            # pure traceability for support/debugging.
            "sourceUnits": getattr(dxf_copy, "source_insunits", 0),
        }}
    )
    doc["isDxfCopyExist"] = True
    
    logger.info("Dxf copy made", extra={"dxf_file_slug": dxf_file_slug})

def _make_svg_file(doc):
    logger = setup_logger("svg_file_maker")
    #if doc.get("isSvgFileExist", False):
    #    logger.info("Svg file already exists", extra={"slug": doc["slug"]})
    #    return
    
    drawing = _getting_drawing(doc)

    slug = doc["slug"]
    owner_id = doc["ownerId"]
    dek = get_dek(db, doc)
    closed_parts = resolve_polygon_parts(db, doc, dek)
    # Strip the source extension whatever the upload format (.dxf/.svg/.dwg).
    svg_slug = slug.rsplit(".", 1)[0] + "-origin.svg"

    svg_string = create_svg_from_doc(drawing, closed_parts)
    svg_bytes = svg_string.encode("utf-8")

    write_gridfs(user_dxf_files_svg_bucket, svg_slug, svg_bytes, owner_id, dek)
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "isSvgFileExist": True,
            "svgFileSlug": svg_slug
        }}
    )
    doc["isSvgFileExist"] = True
    doc["svgFileSlug"] = svg_slug
    
def _check_handle_coverage(drawing, polygon_parts, logger, slug):
    """
    Compare how many drawing handles ended up in the saved polygonParts.

    Every entity should be attached to the part that contains it. A handle
    present in the drawing but missing from the saved parts means an entity
    was dropped (e.g. it fell outside every part contour, or its type is not
    convertible). Logged as a warning — not raised — because some entities
    can legitimately sit outside all parts; the warning surfaces real
    coverage gaps for inspection.
    """
    origin_handles = {entity.dxf.handle for entity in drawing.modelspace()}

    saved_handles = set()
    for part in polygon_parts:
        saved_handles.update(part.get("handles", []))

    missing = origin_handles - saved_handles

    logger.info(
        "handle_coverage_check",
        extra={
            "slug": slug,
            "origin_handles": len(origin_handles),
            "saved_handles": len(saved_handles),
            "missing_handles": len(missing),
        },
    )

    if missing:
        logger.warning(
            "handle_coverage_incomplete",
            extra={
                "slug": slug,
                "missing_count": len(missing),
                "missing_handles": sorted(missing),
            },
        )


def _parts_extent(parts):
    """Etendue du DESSIN COMPLET (bbox de toutes les pieces), en mm — miroir
    de `drawingExtent` du navigateur."""
    if not parts:
        return {"width": 0.0, "height": 0.0}
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for part in parts:
        x0, y0, x1, y1 = part.geometry.bounds
        minx = min(minx, x0)
        miny = min(miny, y0)
        maxx = max(maxx, x1)
        maxy = max(maxy, y1)
    return {"width": maxx - minx, "height": maxy - miny}


def resolve_import_scale(doc, parts) -> float:
    """Facteur d'echelle demande a la depose (lot E2) — miroir EXACT de
    `resolveScale` du navigateur.

    Soit un facteur donne (`importScale`), soit une cible en millimetres
    (`importScaleTarget`) resolue sur l'etendue MESUREE du dessin : on ne
    connait la taille d'un dessin qu'apres l'avoir lu. Rend 1.0 quand la
    demande n'a pas de sens — on ne multiplie jamais une geometrie par
    l'infini.
    """
    if doc.get("importScaleApplied"):
        # Le worker peut reprendre un fichier (reprise de file, relance) : un
        # facteur deja applique ne se rejoue pas, sinon le dessin double de
        # taille a chaque passage.
        return 1.0
    target = doc.get("importScaleTarget") or None
    if isinstance(target, dict):
        try:
            mm = float(target.get("mm"))
        except (TypeError, ValueError):
            return 1.0
        extent = _parts_extent(parts)
        span = extent["height"] if target.get("mode") == "height" else extent["width"]
        if mm <= 0 or span <= 1e-9:
            return 1.0
        return mm / span
    try:
        factor = float(doc.get("importScale") or 1.0)
    except (TypeError, ValueError):
        return 1.0
    return factor if factor > 0 else 1.0


def _rewrite_scaled_copy(doc, drawing, factor, logger):
    """Met la copie canonique a l'echelle et la REECRIT dans validDxf.

    Miroir du navigateur : c'est le DXF canonique qui est mis a l'echelle,
    puis relu par l'import ordinaire — l'aval (polygonisation, apercu, export
    par handle) ne voit qu'un dessin comme un autre.
    """
    refused = scale_drawing(drawing, factor)
    stream = io.StringIO()
    drawing.write(stream)
    scaled_bytes = stream.getvalue().encode("utf-8")
    stream.close()
    dek = get_dek(db, doc)
    try:
        valid_dxf_bucket.delete_by_name(filename=doc["slug"])
    except Exception as exc:  # noqa: BLE001
        logger.info("scaled copy: delete failed", extra={"error": str(exc)[:120]})
    write_gridfs(valid_dxf_bucket, doc["slug"], scaled_bytes, doc["ownerId"], dek)
    # Le cache de lecture porte l'ANCIEN document : le vider, sinon la
    # relecture rendrait le dessin non mis a l'echelle.
    _drawing_cache.pop(doc["slug"], None)
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "importScale": round(float(factor), 6),
            "importScaleApplied": True,
        }},
    )
    doc["importScale"] = round(float(factor), 6)
    doc["importScaleApplied"] = True
    logger.info("scaled canonical copy", extra={
        "slug": doc["slug"], "factor": factor, "entities_refused": refused})
    return refused


def _close_polygon_from_dxf(doc, logger_tag: str):
    logger = setup_logger(logger_tag)
     
    if doc.get("polygonParts") or doc.get("encPolygonParts"):
        logger.info("polygon_parts_already_exist", extra={"slug": doc["slug"]})
     
    tolerance = doc["flattening"]
 
    start_time = time.time()
    drawing = _getting_drawing(doc)
    # Constats d'import (lot 2c) : ceux de la lecture (unités, entités
    # supprimées, blocs, splines — portés par le document reconstruit) plus
    # ceux de l'assemblage, remplis ci-dessous.
    stats = dict(getattr(drawing, "import_stats", None) or empty_stats())
    stats.setdefault("skipped", {})
    closed_parts = build_geometry(
        drawing,
        tolerance,
        deadline=Deadline(import_time_budget_s, len(drawing.modelspace())),
        stats=stats,
    )
    
    # Lot E2 : ECHELLE demandee a la depose. Miroir du navigateur — mesurer
    # (l'import qu'on vient de faire), mettre le DXF canonique a l'echelle,
    # RELIRE. Une seule chaine de code : aucune branche « geometrie mise a
    # l'echelle a la main ».
    factor = resolve_import_scale(doc, closed_parts)
    if factor != 1.0 and closed_parts:
        _rewrite_scaled_copy(doc, drawing, factor, logger)
        drawing = _getting_drawing(doc)
        stats = dict(getattr(drawing, "import_stats", None) or empty_stats())
        stats.setdefault("skipped", {})
        closed_parts = build_geometry(
            drawing,
            tolerance,
            deadline=Deadline(import_time_budget_s, len(drawing.modelspace())),
            stats=stats,
        )
    # Le constat de mise a l'echelle est lu sur le DOCUMENT, pas sur ce
    # passage : une fiche issue d'un eclatement herite du facteur du dessin
    # d'origine (deja applique a ses octets) et doit le dire quand meme —
    # c'est ce que fait le navigateur pour chacune de ses fiches.
    inherited = float(doc.get("importScale") or 1.0)
    if doc.get("importScaleApplied") and inherited != 1.0:
        stats["scaleApplied"] = inherited

    logger.info("result", extra={
        "closed_parts": len(closed_parts),
    })
    
    if len(closed_parts) == 0:
        raise Exception("Closed parts is 0")
    
    polygon_parts = []
    # One random display color per part, sampled without replacement first so
    # parts of the same file look distinct in the viewer and result SVG.
    for part, color in zip(closed_parts, pick_colors(len(closed_parts))):
        mongo_dict = part.to_mongo_dict(color=color, stats=stats)
        if mongo_dict is not None:
            polygon_parts.append(mongo_dict)
        else:
            # Corps écarté à l'émission (côté sous 0,1 mm) : une pièce qui
            # n'arrivera jamais sur la tôle — constat lot 2c.
            stats["droppedParts"] = stats.get("droppedParts", 0) + 1

    _check_handle_coverage(drawing, polygon_parts, logger, doc["slug"])

    # Champ ADDITIF `importReport` (lot 2c) : les constats de cet import, avec
    # leur niveau et leur compte. Les fichiers déjà en base n'en ont pas et
    # continuent de s'afficher sans (même discipline que le rapport de
    # nesting, piège #19b). Une liste VIDE veut dire « rien à signaler ».
    findings = build_findings(stats)
    logger.info("import findings", extra={"findings": findings})
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"importReport": {"findings": findings}}},
    )
    
    dek = get_dek(db, doc)
    if dek is not None:
        # Vault enabled: geometry is stored encrypted; the plaintext parts
        # only live in memory for the rest of this processing run.
        db["user_dxf_files"].update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "encPolygonParts": encrypt_polygon_parts(dek, doc["slug"], doc["ownerId"], polygon_parts)
                },
                "$unset": {"polygonParts": ""}
            }
        )
    else:
        db["user_dxf_files"].update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "polygonParts": polygon_parts
                }
            }
        )

    doc["polygonParts"] = polygon_parts

    end_time = time.time()
    logger.info("time taken", extra={"time": end_time - start_time})
    # Le dessin (mis a l'echelle le cas echeant) et ses pieces : l'eclatement
    # du lot E2 a besoin des handles, connus d'ici seulement.
    return drawing, closed_parts

def _exploded_names(name, total):
    """Noms des fiches d'un dessin eclate — miroir EXACT du navigateur :
    « nom (k/N).dxf », l'extension en fin de nom."""
    dot = name.rfind(".")
    base = name[:dot] if dot >= 0 else name
    suffix = name[dot:] if dot >= 0 else ""
    return [f"{base} ({k + 1}/{total}){suffix}" for k in range(total)]


def _explode_into_parts(doc, drawing, parts, logger):
    """Eclatement SERVEUR (lot E2) : une fiche fichier par piece.

    Miroir du navigateur (`localImport.importLocalFiles`) : un DXF canonique
    par piece, ecrit depuis SES handles, puis repasse par l'import
    ORDINAIRE — ce sont des fiches normales (quantite, rotations, couleur,
    apercu, suppression, export par handle), pas un affichage decoupe.

    Ici, « repasser par l'import ordinaire » veut dire : deposer les octets
    du sous-ensemble comme un fichier depose, et laisser la boucle du worker
    le traiter. Aucune branche de polygonisation parallele.

    Le dessin d'origine reste en base, marque `explodedInto` — la liste du
    projet l'ecarte (il n'a jamais ete une fiche cote navigateur non plus) et
    la purge 24 h emporte ses octets comme ceux de n'importe quel fichier.

    Rend la liste des slugs crees ; vide quand il n'y a rien a eclater.
    """
    total = len(parts)
    if total < 2:
        # Un seul contour : rien a eclater, la fiche unique garde son nom.
        logger.info("explode: single part, nothing to do", extra={"slug": doc["slug"]})
        return []

    dek = get_dek(db, doc)
    names = _exploded_names(str(doc.get("name") or "part.dxf"), total)
    # `uploadAt` porte l'ordre d'affichage (la liste du projet trie dessus) :
    # une milliseconde par piece, sinon dix-sept fiches ecrites dans la meme
    # milliseconde s'affichent dans un ordre arbitraire.
    base_time = doc.get("uploadAt") or datetime.now(timezone.utc)
    children = []
    records = []
    for k, part in enumerate(parts):
        handles = list(getattr(part, "handles", None) or [])
        payload = subset_drawing_bytes(drawing, handles)
        if not payload:
            # Une piece sans handles (ou dont aucune entite ne repond) ne
            # peut pas devenir un fichier : on le DIT, on ne livre pas une
            # fiche vide.
            logger.warning("explode: empty subset, part skipped", extra={
                "slug": doc["slug"], "part": k, "handles": len(handles)})
            continue
        child_slug = f"f-{secrets.token_hex(8)}.dxf"
        write_gridfs(user_dxf_bucket, child_slug, payload, doc["ownerId"], dek)
        records.append({
            "slug": child_slug,
            "name": names[k],
            "processingStatus": "pending",
            "projectSlug": doc.get("projectSlug"),
            "ownerId": doc["ownerId"],
            "uploadAt": base_time + timedelta(milliseconds=k + 1),
            "flattening": doc.get("flattening", 0.01),
            "worker_tag": doc.get("worker_tag", "normal"),
            # Provenance (champs ADDITIFS) : d'ou vient cette fiche.
            "explodedFrom": doc.get("name"),
            "explodedIndex": k + 1,
            # Le facteur est DEJA dans ses octets (le sous-ensemble sort du
            # dessin mis a l'echelle) : le marquer applique, sinon le worker
            # le rejouerait sur la fille.
            **({"importScale": doc["importScale"], "importScaleApplied": True}
               if doc.get("importScaleApplied") else {}),
        })
        children.append(child_slug)

    if not records:
        logger.warning("explode: no part could be written", extra={"slug": doc["slug"]})
        return []

    db["user_dxf_files"].insert_many(records)
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"explodedInto": children, "explodedParts": len(children)}},
    )
    doc["explodedInto"] = children
    logger.info("explode: parts created", extra={
        "slug": doc["slug"], "parts": len(children), "requested": total})
    return children


def _set_valid_entity_count(doc):
    drawing = _getting_drawing(doc)
    entity_count = len(drawing.modelspace())
    
    if entity_count == 0:
        raise Exception("Entity count is 0")
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "validEntityCount": entity_count
            }
        }
    )
    
    return entity_count

# Lot 2a (docs/PLAN-IMPORT-2026-09-09.md §9.2) : plafond d'entités relevé à
# 10 000 (999 refusait 11 fichiers réels que ce worker lit) et budget de temps
# de 20 s par fichier, contrôlé PENDANT le travail. Miroirs navigateur :
# geometryClient.IMPORT_MAX_ENTITIES / IMPORT_TIME_BUDGET_MS.
max_entity_limit = max_entity_limit_from_env()
import_time_budget_s = time_budget_s_from_env()

settings_logger = setup_logger('settings_logger')
settings_logger.info("Max entity limit set", extra={"max_entity_limit": max_entity_limit})
settings_logger.info("Import time budget set", extra={"import_time_budget_s": import_time_budget_s})


def _park_too_heavy(doc, heavy, logger):
    """Fichier refusé par une borne d'import : le tag de reroute reste
    INCHANGÉ (`1k_entity_count`, connu de la file et de l'UI) et le détail
    chiffré part dans un champ ADDITIF (piège #19b)."""
    logger.warning("Import refused: too heavy", extra=heavy.as_dict())
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "worker_tag": "1k_entity_count",
            "importRefusal": heavy.as_dict(),
        }}
    )

def process_file(doc):
    _drawing_cache.clear()
    
    start_time = time.time()
    logger = setup_logger("core_fileprocessing")
    logger.info("Processing file", extra={"doc": doc["slug"]})
    
    _make_dxf_copy(doc)
    entity_count = _set_valid_entity_count(doc)
    
    if entity_count > max_entity_limit:
        _park_too_heavy(
            doc,
            ImportTooHeavy(
                REASON_ENTITIES,
                entity_count=entity_count,
                max_entities=max_entity_limit,
            ),
            logger,
        )
        return False
    
    try:
        drawing, closed_parts = _close_polygon_from_dxf(doc, "dxf_polygonizer")
    except ImportTooHeavy as heavy:
        _park_too_heavy(doc, heavy, logger)
        return False

    # Lot E2 : ECLATEMENT demande a la depose. Les fiches filles repartent
    # dans la file comme des fichiers deposes ; le dessin d'origine est
    # marque et disparait de la liste du projet — inutile donc de lui
    # fabriquer un apercu.
    exploded = []
    if doc.get("explodeRequested") and not doc.get("explodedInto"):
        exploded = _explode_into_parts(doc, drawing, closed_parts, logger)
    if not exploded:
        _make_svg_file(doc)
    
    end_time = time.time()
    logger.info("time taken", extra={"time": end_time - start_time})
    
    original_processing_time = doc.get("processingTime", 0)
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "processingTime": original_processing_time + (end_time - start_time),
            }
        }
    )
    
    return True
    