"""Extended corpus generator for the parity harness (docs/PIPELINE-MAP.md §5):
broken/representative DXFs built with ezdxf — units variants, bulges,
INSERT blocks (nested), ellipse/spline entities, text-only, zero entities,
HATCH, duplicate handles (recover path).

Run from repo root: python workers/geometry/parity/build_corpus.py
"""
import math
import os
import sys

import ezdxf

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(REPO, "workers", "geometry", "parity", "corpus_extra")


def new_doc(insunits=4):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = insunits
    return doc


def save(doc, name):
    doc.saveas(os.path.join(OUT, name))


def main():
    os.makedirs(OUT, exist_ok=True)

    # --- units variants: same 100x50 rectangle authored in foreign units
    for code, factor, tag in [(1, 25.4, "in"), (2, 304.8, "ft"), (5, 10.0, "cm"), (6, 1000.0, "m"), (9, 0.0254, "mil")]:
        doc = new_doc(code)
        doc.modelspace().add_lwpolyline(
            [(0, 0), (100 / factor, 0), (100 / factor, 50 / factor), (0, 50 / factor)], close=True
        )
        save(doc, f"units_{tag}.dxf")

    # --- unitless (0) and unknown (7)
    for code, tag in [(0, "none"), (7, "unknown")]:
        doc = new_doc(code)
        doc.modelspace().add_lwpolyline([(0, 0), (80, 0), (80, 40), (0, 40)], close=True)
        save(doc, f"units_{tag}.dxf")

    # --- bulges ignored (D-IMP-8): a "stadium" authored with bulges reads as chords
    doc = new_doc()
    e = doc.modelspace().add_lwpolyline(
        [(0, 0), (100, 0), (100, 50), (0, 50)], close=True
    )
    # add a bulge on segment 1 (semicircle) — Python ignores it (get_points xy)
    e[1] = (100, 0, 0, 0, 1.0)  # x, y, start_width, end_width, bulge
    save(doc, "bulge_ignored.dxf")

    # --- INSERT blocks (nested)
    doc = new_doc()
    blk = doc.blocks.new(name="INNER")
    blk.add_lwpolyline([(0, 0), (20, 0), (20, 20), (0, 20)], close=True)
    outer = doc.blocks.new(name="OUTER")
    outer.add_circle((5, 5), 3)
    outer.add_blockref("INNER", insert=(10, 10))
    doc.modelspace().add_blockref("OUTER", insert=(100, 100))
    doc.modelspace().add_blockref("INNER", insert=(0, 0))
    save(doc, "blocks_nested.dxf")

    # --- ellipse + spline + arc mix
    doc = new_doc()
    doc.modelspace().add_ellipse((0, 0), major_axis=(60, 0), ratio=0.5)
    sp = doc.modelspace().add_spline(degree=3)
    sp.control_points = [(0, 0), (30, 80), (60, 0), (90, 80), (120, 0)]
    doc.modelspace().add_arc((0, 0), 50, 20, 250)
    save(doc, "curves_mix.dxf")

    # --- text-only file (zero linework)
    doc = new_doc()
    doc.modelspace().add_text("hello")
    save(doc, "text_only.dxf")

    # --- zero entities
    doc = new_doc()
    save(doc, "empty.dxf")

    # --- HATCH (pattern) — documented divergence (skipped in Rust)
    doc = new_doc()
    doc.modelspace().add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)
    h = doc.modelspace().add_hatch()
    h.set_pattern_fill("ANSI31", scale=5.0)
    h.paths.add_polyline_path([(0, 0), (50, 0), (50, 50), (0, 50)], is_closed=True)
    save(doc, "hatch_pattern.dxf")

    # --- legacy POLYLINE with SEQEND
    doc = new_doc()
    pl = doc.modelspace().add_polyline2d([(0, 0), (70, 0), (70, 70), (0, 70)], close=True)
    save(doc, "legacy_polyline.dxf")

    # --- duplicate handles (recover path): two identical squares
    doc = new_doc()
    doc.modelspace().add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=True)
    doc.modelspace().add_lwpolyline([(20, 20), (30, 20), (30, 30), (20, 30)], close=True)
    save(doc, "two_parts.dxf")

    # --- cas limites CANAUX (PR2) : trou proche du bord, micro-trou,
    # hôte ornemental (concavités sur le chemin du canal)
    doc = new_doc()
    doc.modelspace().add_lwpolyline([(0, 0), (100, 0), (100, 80), (0, 80)], close=True)
    doc.modelspace().add_circle((50, 42), 20)  # pont de 2 mm vers le bord bas
    save(doc, "chan_edge_close.dxf")

    doc = new_doc()
    doc.modelspace().add_lwpolyline([(0, 0), (100, 0), (100, 80), (0, 80)], close=True)
    doc.modelspace().add_circle((50, 40), 1.2)  # trou plus étroit qu'un canal large
    save(doc, "chan_tiny_hole.dxf")

    doc = new_doc()
    # hôte en peigne : le canal le plus court peut croiser des doigts
    doc.modelspace().add_lwpolyline(
        [(0, 0), (100, 0), (100, 20), (70, 20), (70, 35), (100, 35), (100, 55),
         (70, 55), (70, 70), (100, 70), (100, 90), (0, 90)], close=True)
    doc.modelspace().add_circle((35, 45), 15)
    save(doc, "chan_ornate.dxf")

    print(f"extended corpus -> {OUT} ({len(os.listdir(OUT))} files)")


# ---------------------------------------------------------- fichier de coupe
# Cas où un import faux donnerait un fichier de coupe faux sans avertissement.
# Pour écrire seulement ceux qui manquent, sans toucher au reste du corpus :
#     python workers/geometry/parity/build_corpus.py coupe


def plate_with_bulges(msp):
    """Plaque à trou et pièce à arcs de sens opposés, en POLYLINE classique."""
    msp.add_polyline2d([(0, 0, 1.0), (100, 0, 0.0), (100, 50, 0.0), (0, 50, 0.0)],
                       format="xyb", close=True)
    msp.add_polyline2d([(30, 15, 0.2), (50, 15, 0.2), (50, 35, 0.2), (30, 35, 0.2)],
                       format="xyb", close=True)
    msp.add_polyline2d([(200, 100, 0.4142135623730951), (240, 100, 0.0),
                        (240, 140, -0.5), (200, 140, 0.0)], format="xyb", close=True)


R12_NO_HANDLE_HEAD = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n"


def r12_no_handle_polyline(vertices):
    """POLYLINE fermée écrite à la main : R12 sans aucun handle, comme le font
    d'anciens exporteurs. Le bulge est porté par le groupe 42 du VERTEX."""
    out = "0\nPOLYLINE\n8\nCUT\n66\n1\n70\n1\n"
    for x, y, b in vertices:
        out += f"0\nVERTEX\n8\nCUT\n10\n{x}\n20\n{y}\n"
        if b:
            out += f"42\n{b}\n"
    return out + "0\nSEQEND\n8\nCUT\n"


def save_new(doc, name):
    """N'écrit qu'un fichier absent : ezdxf y met une date et des GUID, réécrire
    un échantillon déjà commité ferait un faux changement de corpus."""
    if not os.path.exists(os.path.join(OUT, name)):
        save(doc, name)


def d_shape(blk):
    """Pièce à trou et à un seul coin arrondi : l'ARC n'a aucune symétrie, un miroir
    lu comme une rotation de 180° le pose ailleurs et le contour ne se referme plus."""
    blk.add_line((0, 0), (40, 0))
    blk.add_arc((40, 20), 20, -90, 0)
    blk.add_line((60, 20), (60, 40))
    blk.add_line((60, 40), (0, 40))
    blk.add_line((0, 40), (0, 0))
    blk.add_circle((25, 20), 8)


def tilted_ellipse_point(t):
    """Point de l'ellipse de grand axe (30, 20), ratio 0,4, centrée à l'origine."""
    return (30 * math.cos(t) - 0.4 * 20 * math.sin(t), 20 * math.cos(t) + 0.4 * 30 * math.sin(t))


def main_cut_cases():
    os.makedirs(OUT, exist_ok=True)

    # --- POLYLINE classique à bulges : R2010, R12, R12 écrit à la main.
    doc = new_doc()
    plate_with_bulges(doc.modelspace())
    save_new(doc, "polyline_bulge.dxf")

    doc = ezdxf.new("R12")
    plate_with_bulges(doc.modelspace())
    save_new(doc, "polyline_bulge_r12.dxf")

    with open(os.path.join(OUT, "polyline_bulge_r12_nohandle.dxf"), "w", encoding="ascii") as f:
        f.write(R12_NO_HANDLE_HEAD
                + r12_no_handle_polyline([(0.0, 0.0, 1.0), (100.0, 0.0, 0), (100.0, 50.0, 0), (0.0, 50.0, 0)])
                + "0\nENDSEC\n0\nEOF\n")

    # --- INSERT à échelle inégale + rotation : l'échelle s'applique AVANT la
    # rotation (ezdxf Insert.matrix44). Pièces à trou, point de base non nul.
    doc = new_doc()
    blk = doc.blocks.new(name="PLATE", base_point=(5, 5))
    blk.add_lwpolyline([(0, 0), (30, 0), (30, 10), (0, 10)], close=True)
    blk.add_lwpolyline([(10, 3), (20, 3), (20, 7), (10, 7)], close=True)
    msp = doc.modelspace()
    msp.add_blockref("PLATE", (100, 0), dxfattribs={"xscale": 2, "yscale": 1, "rotation": 90})
    msp.add_blockref("PLATE", (0, 200), dxfattribs={"xscale": 2, "yscale": 0.5, "rotation": 30})
    msp.add_blockref("PLATE", (300, 400), dxfattribs={"xscale": 0.5, "yscale": 3, "rotation": 225})
    save_new(doc, "block_scale_rotation.dxf")

    # --- Miroir tourné (xscale ou yscale négatif + rotation), sans arc : la
    # pièce reste congruente, c'est sa position qui change.
    doc = new_doc()
    blk = doc.blocks.new(name="TAB")
    blk.add_lwpolyline([(0, 0), (40, 0), (40, 10), (10, 30), (0, 30)], close=True)
    msp = doc.modelspace()
    msp.add_blockref("TAB", (100, 100), dxfattribs={"xscale": -1, "rotation": 30})
    msp.add_blockref("TAB", (300, 300), dxfattribs={"yscale": -1, "rotation": 60})
    msp.add_blockref("TAB", (500, 500), dxfattribs={"xscale": -2, "yscale": 1, "rotation": 90})
    save_new(doc, "block_mirror_rotation.dxf")

    # --- ARC et ELLIPSE dans un bloc miroir : xscale=-1, -2 uniforme, -2 inégal,
    # miroir tourné. Le contour ne se referme que si l'arc reste du bon côté.
    # Pièces empilées loin l'une de l'autre : compare.py juge les pièces dans
    # l'ordre, et celui de GEOS ne suit y-min que si leurs hauteurs sont disjointes.
    def mirrored_block_doc(build_block):
        doc = new_doc()
        build_block(doc.blocks.new(name="SHAPE"))
        for k, attribs in enumerate((
            {"xscale": -1},
            {"xscale": -2, "yscale": 2},
            {"xscale": -2, "yscale": 1},
            {"yscale": -1, "rotation": 30},
            {"xscale": -1.5, "yscale": 1, "rotation": 45},
            {"xscale": 1, "yscale": 3},
        )):
            doc.modelspace().add_blockref("SHAPE", (200 * k, 400 * k), dxfattribs=attribs)
        return doc

    def half_ellipse(blk):
        blk.add_ellipse((0, 0), major_axis=(30, 0), ratio=0.5, start_param=0, end_param=math.pi)
        blk.add_line((-30, 0), (30, 0))

    def tilted_ellipse(blk):
        blk.add_ellipse((0, 0), major_axis=(30, 20), ratio=0.4,
                        start_param=math.pi / 4, end_param=5 * math.pi / 4)
        blk.add_line(tilted_ellipse_point(math.pi / 4), tilted_ellipse_point(5 * math.pi / 4))

    save_new(mirrored_block_doc(d_shape), "block_mirror_arc.dxf")
    save_new(mirrored_block_doc(half_ellipse), "block_mirror_ellipse.dxf")
    save_new(mirrored_block_doc(tilted_ellipse), "block_mirror_ellipse_tilted.dxf")

    # --- Miroirs imbriqués : deux miroirs s'annulent, un miroir + un non.
    doc = new_doc()
    d_shape(doc.blocks.new(name="D"))
    doc.blocks.new(name="ONE_MIRROR").add_blockref("D", (0, 0), dxfattribs={"xscale": -1})
    doc.blocks.new(name="MIRROR_ROTATED").add_blockref(
        "D", (10, 5), dxfattribs={"xscale": -2, "yscale": 2, "rotation": 30})
    msp = doc.modelspace()
    msp.add_blockref("ONE_MIRROR", (100, 0))
    msp.add_blockref("ONE_MIRROR", (300, 400), dxfattribs={"xscale": -1})
    msp.add_blockref("ONE_MIRROR", (500, 800), dxfattribs={"rotation": 90})
    msp.add_blockref("MIRROR_ROTATED", (100, 1200), dxfattribs={"yscale": -1})
    msp.add_blockref("MIRROR_ROTATED", (400, 1600), dxfattribs={"xscale": -1, "rotation": 45})
    save_new(doc, "block_mirror_nested.dxf")

    # --- Polylignes à arcs dans un bloc miroir : le bulge change de signe ; sous
    # une échelle inégale elles éclatent en LINE + ELLIPSE, comme ezdxf.
    doc = new_doc()
    blk = doc.blocks.new(name="BULGED")
    blk.add_lwpolyline([(0, 0, 0.5), (60, 0, 0.0), (60, 40, -0.3), (0, 40, 0.0)], format="xyb", close=True)
    blk.add_polyline2d([(20, 10, 0.2), (40, 10, 0.0), (40, 30, 0.2), (20, 30, 0.0)], format="xyb", close=True)
    msp = doc.modelspace()
    for k, attribs in enumerate((
        {"xscale": -1},
        {"xscale": -2, "yscale": 2},
        {"xscale": -2, "yscale": 1},
        {"xscale": 2, "yscale": 1, "rotation": 30},
        {"xscale": -1, "rotation": 60},
    )):
        msp.add_blockref("BULGED", (300 * k, 400 * k), dxfattribs=attribs)
    save_new(doc, "block_mirror_bulge.dxf")

    # --- Espace papier : cadre et cartouche à côté de la pièce (R12, R2000, R2010),
    # ou tout le dessin dedans, l'espace objet vide (à refuser, pas à vider).
    def sheet_frame(layout):
        layout.add_line((0, 0), (420, 0))
        layout.add_line((420, 0), (420, 297))
        layout.add_line((420, 297), (0, 297))
        layout.add_line((0, 297), (0, 0))
        layout.add_circle((400, 20), 5)
        layout.add_text("CARTOUCHE")

    def plate(layout):
        layout.add_line((0, 0), (100, 0))
        layout.add_line((100, 0), (100, 50))
        layout.add_line((100, 50), (0, 50))
        layout.add_line((0, 50), (0, 0))
        layout.add_circle((50, 25), 10)

    for version, tag in (("R12", "r12"), ("R2000", "r2000"), ("R2010", "r2010")):
        doc = ezdxf.new(version)
        doc.header["$INSUNITS"] = 4
        plate(doc.modelspace())
        sheet_frame(doc.paperspace())
        if version == "R2010":
            sheet_frame(doc.layouts.new("Plan"))  # présentation inactive, dans BLOCKS
        save_new(doc, f"paperspace_{tag}.dxf")

    for version, tag in (("R12", "r12"), ("R2010", "r2010")):
        doc = ezdxf.new(version)
        doc.header["$INSUNITS"] = 4
        plate(doc.paperspace())
        save_new(doc, f"paperspace_only_{tag}.dxf")

    # --- Extrusion -Z (normale opposée) : les coordonnées d'ARC, CIRCLE, LWPOLYLINE,
    # POLYLINE et INSERT sont en OCS (x opposé), celles d'ELLIPSE en WCS mais son petit
    # axe et ses paramètres tournent autour de -Z.
    minus_z = {"extrusion": (0, 0, -1)}
    doc = new_doc()
    blk = doc.blocks.new(name="CORNER")
    blk.add_line((0, 0), (40, 0))
    blk.add_arc((40, 15), 15, -90, 0)
    blk.add_line((55, 15), (55, 30))
    blk.add_line((55, 30), (0, 30))
    blk.add_line((0, 30), (0, 0))
    msp = doc.modelspace()
    msp.add_circle((10, 0), 5, dxfattribs=minus_z)
    msp.add_arc((50, 300), 20, 0, 90, dxfattribs=minus_z)
    msp.add_line((-70, 300), (-50, 300))
    msp.add_line((-50, 300), (-50, 320))
    msp.add_lwpolyline([(200, 600, 0.5), (260, 600, 0.0), (260, 640, -0.25), (200, 640, 0.0)],
                       format="xyb", close=True, dxfattribs=minus_z)
    msp.add_polyline2d([(300, 900, 0.5), (360, 900, 0.0), (360, 940, -0.25), (300, 940, 0.0)],
                       format="xyb", close=True, dxfattribs=minus_z)
    msp.add_ellipse((0, 1200), major_axis=(30, 0), ratio=0.5, start_param=0, end_param=math.pi,
                    dxfattribs=minus_z)
    msp.add_line((-30, 1200), (30, 1200))
    msp.add_blockref("CORNER", (400, 1500), dxfattribs=minus_z)
    msp.add_blockref("CORNER", (400, 1800), dxfattribs={**minus_z, "rotation": 30, "xscale": 2, "yscale": 2})
    save_new(doc, "extrusion_minus_z.dxf")

    # --- Extrusion oblique : pas de vraie pièce plane, mais jamais une position
    # fausse en silence. ezdxf projette sur XY, le Rust aussi.
    oblique = {"extrusion": (0, 0.6, 0.8)}
    doc = new_doc()
    blk = doc.blocks.new(name="SQUARE")
    blk.add_lwpolyline([(0, 0), (20, 0), (20, 20), (0, 20)], close=True)
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 200), (40, 200), (40, 230), (0, 230)], close=True,
                       dxfattribs={"extrusion": (0.6, 0, 0.8), "elevation": 3})
    msp.add_ellipse((0, 500, 0), major_axis=(30, 0, 0), ratio=0.5, dxfattribs=oblique)
    msp.add_blockref("SQUARE", (0, 800, 10), dxfattribs=oblique)
    save_new(doc, "extrusion_oblique.dxf")

    print(f"cas fichier de coupe -> {OUT}")


# ---------------------------------------------------------------- SVG corpus
SVG_OUT = os.path.join(REPO, "workers", "geometry", "parity", "corpus_svg")


def save_svg(text, name):
    with open(os.path.join(SVG_OUT, name), "w", encoding="utf-8") as f:
        f.write(text)


def main_svg():
    os.makedirs(SVG_OUT, exist_ok=True)

    # unités physiques variées (même géométrie, mm/cm/in/pt/px)
    for unit in ["mm", "cm", "in", "pt", "px", ""]:
        w = {"mm": "100mm", "cm": "10cm", "in": "3.937007874015748in",
             "pt": "283.46456692913387pt", "px": "377.9527559055118", "": "100"}[unit]
        tag = unit or "none"
        save_svg(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="50{unit}">'
            f'<rect x="0" y="0" width="80" height="40"/></svg>',
            f"svg_units_{tag}.svg",
        )

    # viewBox seul (pas de width/height) + viewBox mismatch avec width mm
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
        '<rect x="10" y="10" width="180" height="120"/></svg>',
        "svg_viewbox_only.svg",
    )
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200">'
        '<circle cx="100" cy="70" r="25"/></svg>',
        "svg_viewbox_mm_mismatch.svg",
    )

    # transforms imbriquées (groupes cascadés, rotate/scale/translate)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">'
        '<g transform="translate(50,50)"><g transform="scale(2) rotate(15)">'
        '<rect x="0" y="0" width="60" height="30"/>'
        '<circle cx="100" cy="100" r="20"/>'
        '</g></g></svg>',
        "svg_nested_transforms.svg",
    )

    # chemins ouverts (linework) + fermés, courbes C/S/Q/T, arcs A, relatif
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">'
        '<path d="M10 400 C 60 380, 140 420, 190 400 S 300 370, 350 400"/>'
        '<path d="M20 20 Q 60 80 120 20 T 220 20"/>'
        '<path d="m 300 300 l 40 0 l 0 40 l -40 0 z"/>'
        '<path d="M 50 250 A 30 20 0 1 1 120 280 A 30 20 30 0 0 50 250 Z"/>'
        '</svg>',
        "svg_curves_arcs.svg",
    )

    # formes : polyline ouverte, polygon, line, rounded rect, ellipse
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">'
        '<polyline points="10,10 90,10 90,60"/>'
        '<polygon points="110,10 190,10 150,60"/>'
        '<line x1="200" y1="10" x2="290" y2="60"/>'
        '<rect x="300" y="10" width="80" height="50" rx="12"/>'
        '<ellipse cx="80" cy="150" rx="60" ry="25"/>'
        '</svg>',
        "svg_shapes.svg",
    )

    # zéro géométrie convertible (texte seul) + fichier vide de sens
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="10">hello</text></svg>',
        "svg_text_only.svg",
    )
    save_svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "svg_empty.svg")

    # display:none + éléments skippés (image, gradient)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<g display="none"><rect x="0" y="0" width="50" height="50"/></g>'
        '<rect x="10" y="10" width="30" height="30" style="display:inline"/>'
        '</svg>',
        "svg_display_none.svg",
    )

    # doublons exacts (deux rectangles superposés) + deux corps disjoints
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'
        '<rect x="0" y="0" width="40" height="40"/>'
        '<rect x="0" y="0" width="40" height="40"/>'
        '<rect x="80" y="0" width="40" height="40"/>'
        '</svg>',
        "svg_duplicates.svg",
    )

    # transform sur path avec arc (réification sous matrice)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">'
        '<g transform="translate(30,40) scale(1.5)">'
        '<path d="M 0 0 A 25 25 0 0 1 50 50 L 50 0 Z"/>'
        '</g></svg>',
        "svg_arc_transform.svg",
    )

    # pièce à trou (rect + circle imbriqués = anneau)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
        '<rect x="10" y="10" width="180" height="180"/>'
        '<circle cx="100" cy="100" r="40"/>'
        '</svg>',
        "svg_holed_plate.svg",
    )

    print(f"svg corpus -> {SVG_OUT} ({len(os.listdir(SVG_OUT))} files)")


if __name__ == "__main__":
    if sys.argv[1:] == ["coupe"]:
        main_cut_cases()
    else:
        main()
        main_svg()
        main_cut_cases()
