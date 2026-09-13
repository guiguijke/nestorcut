from dataclasses import dataclass
from typing import Dict, List, Tuple

from worker_common.geometry.cleanup import is_micro_void, strip_spurs
from worker_common.geometry.dxf_parser import convert_entity_to_shapely

from ezdxf.document import Drawing
# Use the top-level shapely (2.0) functions — `shapely.ops.unary_union` does not
# support the `grid_size` argument.
from shapely import STRtree, set_precision, unary_union
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, polygonize, polygonize_full

from worker_common.logger import setup_logger

logger = setup_logger("build_geometry")

# Coordinate grid used to make near-coincident vertices exactly equal. This makes
# noding/polygonize robust (closes hairline gaps at corners) and lets unary_union
# reliably dissolve the shared edges of faces that an internal line split apart.
# Far below the flattening tolerance, so it does not affect contour accuracy.
GRID_SIZE = 1e-4

# Parts whose contours are this close (mm) or closer are merged into one polygon.
MERGE_DISTANCE = 0.1


def collect_footprints(drawing: Drawing, tolerance: float) -> List[Tuple[str, BaseGeometry]]:
    """(handle, geometry) for every convertible entity of the drawing.
    Used to attach original DXF handles to the part that contains them
    (outlines, holes, points, annotations, ...)."""
    msp = drawing.modelspace()
    footprints: List[Tuple[str, BaseGeometry]] = []
    for entity in msp:
        try:
            dxf_geometry = convert_entity_to_shapely(entity, tolerance)
        except Exception:
            # convert_entity_to_shapely already logs; unconvertible entities
            # simply carry no footprint.
            continue
        if dxf_geometry is None:
            continue
        geom = dxf_geometry.geometry
        if geom.is_empty:
            continue
        footprints.append((dxf_geometry.handle, geom))
    return footprints


def _merge_near_polygons(polygons: List[Polygon], distance: float, deadline=None) -> List[Polygon]:
    """
    Merge polygons that lie within `distance` of each other into single polygons.

    Polygons are clustered by proximity (union-find over pairwise distance). Each
    cluster of more than one polygon is welded into a single body with a
    morphological close (buffer out then in, mitre joins to keep corners sharp).
    Interior rings (holes) are preserved by the weld; only holes narrower than
    2 × distance can collapse, which is below any useful cutout size.
    Isolated polygons are returned untouched so their contours stay exact.
    """
    count = len(polygons)
    if count <= 1:
        return polygons

    parent = list(range(count))

    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return parent[node]

    def union(a, b):
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_a] = root_b

    for i in range(count):
        if deadline is not None:
            deadline.check(i)
        for j in range(i + 1, count):
            if polygons[i].distance(polygons[j]) <= distance:
                union(i, j)

    clusters = {}
    for i in range(count):
        clusters.setdefault(find(i), []).append(i)

    result: List[Polygon] = []
    for indices in clusters.values():
        if len(indices) == 1:
            result.append(polygons[indices[0]])
            continue

        group_union = unary_union([polygons[k] for k in indices])
        # Bridge the sub-distance gaps so the cluster becomes one body. The
        # buffer round-trip keeps interior rings (they shrink by `distance`).
        bridged = (
            group_union
            .buffer(distance, join_style="mitre", mitre_limit=5.0)
            .buffer(-distance, join_style="mitre", mitre_limit=5.0)
        )
        for geom in getattr(bridged, "geoms", [bridged]):
            if geom.geom_type == "Polygon" and not geom.is_empty:
                result.append(geom)

    return result


def _ring_key(ring) -> frozenset:
    """Canonical key for a closed ring, insensitive to start point, winding
    and (after grid rounding) to which side of the edge generated it. Two
    faces sharing an edge report the same cycle with the same key."""
    return frozenset(
        (round(x, 4), round(y, 4)) for x, y in ring.coords
    )


def _unique_ring_polygons(faces: List[Polygon]) -> List[Polygon]:
    """All distinct boundary cycles of the faces, as solid polygons.

    Every face contributes its exterior ring and its interior rings; the same
    cycle appears twice (once per adjacent face) and is deduplicated. These
    cycles are the basis of the even-odd containment rule below.
    """
    seen = set()
    rings: List[Polygon] = []
    for face in faces:
        for cycle in [face.exterior, *face.interiors]:
            key = _ring_key(cycle)
            if key in seen:
                continue
            seen.add(key)
            ring_poly = Polygon(cycle)
            if not ring_poly.is_empty and ring_poly.area > 1e-10:
                rings.append(ring_poly)
    return rings


def _material_faces(faces: List[Polygon]) -> List[Polygon]:
    """Selects the faces that represent actual material.

    Cutting semantics follow the even-odd rule: a region enclosed by an odd
    number of closed contours is material, an even number is a void (hole).
    A disk inside a square is a hole; an island inside that hole is material
    again (a separate part). The containment depth of each face is counted
    over the unique boundary cycles of the planar graph.
    """
    if len(faces) <= 1:
        return faces

    rings = _unique_ring_polygons(faces)
    ring_tree = STRtree(rings)

    material = []
    for face in faces:
        probe = face.representative_point()
        depth = 0
        for ring_idx in ring_tree.query(probe):
            if rings[ring_idx].contains(probe):
                depth += 1
        if depth % 2 == 1:
            material.append(face)
        else:
            logger.info(
                "Void region detected (hole)",
                extra={"area": face.area},
            )
    return material


@dataclass(slots=True)
class ClosedPolygon:
    geometry: Polygon
    handles: List[str]

    def to_mongo_dict(self, color: str | None = None, stats=None) -> Dict[str, List[List[float]]] :
        if not isinstance(self.geometry, Polygon):
            raise TypeError("The 'geometry' attribute must be a shapely Polygon.")

        bounding_box = self.geometry.bounds

        width = bounding_box[2] - bounding_box[0]
        height = bounding_box[3] - bounding_box[1]

        if (abs(width) < 0.1 or abs(height) < 0.1):
            return None

        def reduce_ring(ring) -> List[List[float]]:
            coords = list(zip(*ring.coords.xy))
            if not coords:
                return []
            reduced = [coords[0]]
            for point in coords[1:]:
                last = reduced[-1]
                if abs(point[0] - last[0]) > 0.01 or abs(point[1] - last[1]) > 0.01:
                    reduced.append(point)
            return [[p[0], p[1]] for p in reduced]

        exterior_coords, spurs = strip_spurs(reduce_ring(self.geometry.exterior))
        # Lot E1 : l'anneau nettoye doit encore fermer quelque chose.
        if len(exterior_coords) < 3:
            if stats is not None:
                stats["spursRemoved"] = stats.get("spursRemoved", 0) + spurs
            return None
        hole_rings = []
        micro_voids = 0
        for interior in self.geometry.interiors:
            ring, removed = strip_spurs(reduce_ring(interior))
            spurs += removed
            # Lot E1 : un micro-vide n'est plus un trou — il est rebouche
            # (retire de la liste, la matiere reprend sa place) et compte.
            if len(ring) < 3 or is_micro_void(ring):
                micro_voids += 1
                continue
            hole_rings.append(ring)
        if stats is not None:
            if micro_voids:
                stats["microVoids"] = stats.get("microVoids", 0) + micro_voids
            if spurs:
                stats["spursRemoved"] = stats.get("spursRemoved", 0) + spurs

        doc = {
            'coordinates': exterior_coords,
            # Interior rings (cutouts). Empty for legacy readers, which all
            # access it via .get() — the nesting post-pass uses them to place
            # small parts inside the holes of placed parts.
            'holes': hole_rings,
            'handles': self.handles,
            'width': width,
            'height': height
        }

        # Random display color assigned at import (screen rendering only).
        # Older documents lack the key — readers fall back to
        # worker_common.colors.color_for_part(slug, index).
        if color is not None:
            doc['color'] = color

        return doc


def build_geometry(drawing: Drawing, tolerance: float, deadline=None, stats=None) -> List[ClosedPolygon]:
    """
    Build accurate part contours from a DXF drawing.

    Unlike the former convex-hull based approach, this follows the real
    geometry:
      * Every entity is flattened to linework; closed contours and open
        segments are noded together and polygonized to recover the faces they
        enclose.
      * Faces are filtered by the even-odd rule: regions enclosed an even
        number of times are voids (holes) and are subtracted, so parts keep
        their concavities AND their cutouts.
      * Material faces are dissolved into one body per disjoint part; bodies
        closer than MERGE_DISTANCE are welded together.

    Original DXF handles are preserved: every entity whose bounding-box
    centre falls inside a part's silhouette (holes included) is attached to
    that part — smallest containing silhouette wins, so islands nested in a
    hole keep their own entities while the hole's contour travels with the
    enclosing part.

    `deadline` (lot 2a, `core/import_budget.Deadline`) borne le TEMPS : les
    boucles Python la contrôlent et lèvent `ImportTooHeavy` — l'import
    s'arrête au budget au lieu d'être payé en entier. Les appels shapely
    (unary_union, buffer) ne sont pas interruptibles : le contrôle encadre
    chaque étage, le dépassement possible est celui d'UN appel.

    `stats` (lot 2c, dict de `worker_common.geometry.import_findings`) est
    REMPLI au passage : entités non converties (matière perdue) et tracés
    ouverts qui ne referment aucune pièce. Sans lui, rien ne change.
    """
    msp = drawing.modelspace()

    linework: List[LineString] = []
    footprints: List[Tuple[str, BaseGeometry]] = []

    for entity_idx, entity in enumerate(msp):
        if deadline is not None:
            deadline.check(entity_idx)
        try:
            dxf_geometry = convert_entity_to_shapely(entity, tolerance)
        except Exception as e:
            logger.error("Error converting entity", extra={
                "entity": entity.dxftype(),
                "handle": entity.dxf.handle,
                "error": str(e),
            })
            raise e

        if dxf_geometry is None:
            # Entité non convertible : c'est une PERTE, et son type décide
            # du niveau du constat (matière vs annotation, lot 2c).
            if stats is not None:
                kind = entity.dxftype()
                stats["skipped"][kind] = stats["skipped"].get(kind, 0) + 1
            continue

        geometry = dxf_geometry.geometry
        if geometry.is_empty:
            continue

        footprints.append((dxf_geometry.handle, geometry))

        if geometry.geom_type == "Polygon":
            # Closed contours contribute their boundary to the planar graph;
            # whether the enclosed region is material or a hole is decided
            # later by the even-odd rule.
            linework.append(LineString(geometry.exterior.coords))
        elif geometry.geom_type == "LineString":
            linework.append(geometry)
        # Point geometries carry no contour; their footprint is enough.

    if not linework:
        logger.info("No linework found")
        return []

    # Snap coordinates to a fine grid so coincident endpoints become exactly
    # equal — this nodes the linework robustly and closes hairline corner gaps
    # without perturbing edges that faces share (which `snap` would break).
    if deadline is not None:
        deadline.check()
    merged_lines = set_precision(unary_union(linework), GRID_SIZE)
    noded = unary_union(merged_lines)
    if stats is None:
        faces = list(polygonize(noded))
    else:
        # polygonize_full rend les faces ET les tracés pendants pour le même
        # prix : c'est la mesure du constat « contours ouverts » (lot 2c).
        # Comptés en CHAÎNES (linemerge) et non en segments : un contour
        # ouvert est UN tracé à refermer, pas quarante arêtes.
        faces_geom, _cuts, dangles, _invalid = polygonize_full(noded)
        faces = list(getattr(faces_geom, "geoms", []))
        if not dangles.is_empty:
            merged = linemerge(dangles)
            stats["danglingPaths"] = len(getattr(merged, "geoms", [merged]))
    logger.info("Recovered faces from linework", extra={"len": len(faces)})

    if not faces:
        logger.info("No closed polygons found")
        return []

    if deadline is not None:
        deadline.check()
    material = _material_faces(faces)
    if not material:
        logger.info("No material faces found")
        return []

    # buffer(0) repairs self-intersections / winding before merging.
    cleaned = [poly.buffer(0) for poly in material if not poly.is_empty]
    cleaned = [
        geom
        for poly in cleaned
        for geom in getattr(poly, "geoms", [poly])
        if geom.geom_type == "Polygon" and not geom.is_empty
    ]
    # grid_size makes the overlay robust so faces that an internal line split
    # into several pieces are dissolved back into a single body per part;
    # holes (void faces) survive as interior rings.
    merged = unary_union(cleaned, grid_size=GRID_SIZE)

    bodies = [
        geom
        for geom in getattr(merged, "geoms", [merged])
        if geom.geom_type == "Polygon" and not geom.is_empty
    ]

    # Merge parts whose contours are within MERGE_DISTANCE of each other.
    bodies = _merge_near_polygons(bodies, MERGE_DISTANCE, deadline)

    # Attach handles. An entity belongs to the part whose MATERIAL body its
    # "ink" touches: closed contours draw their outline (not a filled disk),
    # so a hole's circle touches the enclosing part's boundary — not an
    # island sitting inside that hole. Entities in a void (points,
    # annotations inside a hole) fall back to the smallest silhouette
    # containing them.
    silhouettes = [(body, Polygon(body.exterior)) for body in bodies]
    probe_tol = max(tolerance, 1e-6)

    def attachment_hits(body, geom):
        try:
            inter = body.intersection(geom)
        except Exception:
            return 0.0
        # Ink is 1-dimensional: length is the primary measure, area the
        # fallback for filled shapes.
        return inter.length if inter.length > 0 else inter.area

    result: List[ClosedPolygon] = []
    assigned = {i: [] for i in range(len(silhouettes))}
    for fp_idx, (handle, geom) in enumerate(footprints):
        # Poste dominant mesuré sur le corpus réel (lot 2a) : 64,7 s des
        # 66,7 s du pire fichier serveur, en `body.buffer(probe_tol)` refait
        # à CHAQUE empreinte (3 772 appels à 17 ms). Cause à corriger au
        # lot 2d ; ici, elle est seulement bornée.
        if deadline is not None:
            deadline.check(fp_idx)
        ink = geom.boundary if geom.geom_type == "Polygon" else geom
        hits = [
            (idx, attachment_hits(body, ink))
            for idx, (body, _silhouette) in enumerate(silhouettes)
            if body.buffer(probe_tol).intersects(ink)
        ]
        positive = [(idx, measure) for idx, measure in hits if measure > 0]
        if positive:
            # The part the entity contributes most to (a long line crossing
            # two parts attaches to the part it mostly draws).
            best_idx = max(positive, key=lambda entry: entry[1])[0]
        elif hits:
            # Lot E2 — l'encre TOUCHE un corps sans le traverser : mesurée par
            # `intersection`, elle vaut 0 (un contact rend un Point, de
            # longueur et d'aire nulles), et le centre de l'entité tombe hors
            # de toute silhouette puisqu'elle est SUR le bord. Ce cas laissait
            # l'entité attachée à RIEN — donc ABSENTE du DXF de coupe, que
            # l'export construit handle par handle (`core/main.py`), et
            # absente du sous-ensemble d'un éclatement.
            #
            # Mesuré sur le logo d'atelier : une SPLINE de 3,66 mm à
            # 0,000005 mm de sa pièce, qui fermait son contour extérieur — la
            # pièce éclatée perdait son anneau et rendait ses deux trous comme
            # deux pièces (46 858 mm² devenus 20 277). Le chemin navigateur,
            # lui, l'attachait déjà : c'est cet écart que le lot E2 referme.
            #
            # Le candidat est DÉJÀ borné par `probe_tol` (le filtre
            # `buffer(probe_tol).intersects` ci-dessus) : une entité vraiment
            # égarée reste non attachée et le constat de couverture le dit.
            best_idx = min(
                (idx for idx, _measure in hits),
                key=lambda idx: silhouettes[idx][0].distance(ink),
            )
        else:
            # In a void: smallest containing silhouette wins.
            centre = geom if geom.geom_type == "Point" else geom.centroid
            candidates = [
                (idx, silhouette.area)
                for idx, (_body, silhouette) in enumerate(silhouettes)
                if silhouette.buffer(probe_tol).intersects(centre)
            ]
            best_idx = min(candidates, key=lambda entry: entry[1])[0] if candidates else None
        if best_idx is not None:
            assigned[best_idx].append(handle)

    for idx, (body, _silhouette) in enumerate(silhouettes):
        result.append(ClosedPolygon(geometry=body, handles=assigned[idx]))

    logger.info(
        "Computed closed polygons",
        extra={"len": len(result), "with_holes": sum(1 for cp in result if cp.geometry.interiors)},
    )

    return result
