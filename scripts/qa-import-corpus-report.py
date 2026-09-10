"""Lot A (docs/PLAN-IMPORT-2026-09-09.md §3) — génère corpus.md depuis
l'inventaire mesuré par scripts/qa-import-corpus-inventory.py.

  python scripts/qa-import-corpus-report.py

Lit   docs/qa/import-2026-09-09/corpus-inventory.json
Écrit docs/qa/import-2026-09-09/corpus.md

Aucune donnée inventée : les familles sont dérivées des compteurs MESURÉS
(règles explicitées dans le document produit), la provenance et la licence
viennent de la table PROVENANCE ci-dessous (par plage d'id, miroir du script
d'assemblage scripts/qa-import-corpus-build.sh).
"""
import json
import os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
QA = os.path.join(REPO, "docs", "qa", "import-2026-09-09")
INV = os.path.join(QA, "corpus-inventory.json")
OUT = os.path.join(QA, "corpus.md")

# (id_min, id_max, provenance, licence)
PROVENANCE = [
    (1, 2, "Propriétaire — fixtures historiques `.testparts/` du dépôt "
           "(export CAO R2000)", "Propriétaire, non redistribué"),
    (3, 4, "Propriétaire — `Projects/SmartTHC/Premium_Documentation/"
           "SmartTHC Case` (découpe/marquage réels)",
           "Propriétaire, non redistribué"),
    (5, 11, "Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et "
            "sorties `cam_*` de la validation CAM)", "Projet NestorCut"),
    (12, 35, "Dépôt NestorCut — `server/seed/demo/`, généré par "
             "`scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit",
             "Projet NestorCut"),
    (36, 59, "Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, "
             "généré par `workers/geometry/parity/build_corpus.py` (ezdxf)",
             "Projet NestorCut"),
    (60, 85, "GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker "
             "`nest2d-file-processing-worker:dev` (`/opt/libredwg-src`)",
             "GPL v3 (suite de tests LibreDWG), non redistribué"),
]

FAMILIES = {
    "F1": "exports CAO propres (boucle fermée, arcs/bulges)",
    "F2": "splines",
    "F3": "contours ouverts / primitives éparses à recoudre",
    "F4": "blocs / INSERT (imbriqués, échelle, rotation)",
    "F5": "textes, cotes, calques parasites",
    "F6": "unités douteuses ($INSUNITS absent, 0, 7, ou != mm)",
    "F7": "trous imbriqués / pièces multiples par fichier",
    "F8": "versions DXF anciennes (<= R12) et binaires",
}

RULES = {
    "F1": "au moins 1 boucle fermée (LWPOLYLINE/POLYLINE fermée, CIRCLE, "
          "ELLIPSE) et 0 SPLINE, 0 texte, 0 cote",
    "F2": "au moins 1 SPLINE (modelspace ou blocs)",
    "F3": "au moins 1 polyligne non fermée, ou au moins 1 LINE/ARC en "
          "modelspace (primitives éparses à recoudre en contour)",
    "F4": "au moins 1 INSERT en modelspace, ou au moins 1 définition de bloc",
    "F5": "au moins 1 TEXT/MTEXT/ATTDEF/ATTRIB, ou 1 DIMENSION/LEADER/"
          "TOLERANCE, ou plus de 3 calques",
    "F6": "$INSUNITS absent, 0, 7, ou différent de 4 (mm)",
    "F7": "au moins 2 boucles fermées dans le même fichier",
    "F8": "DXF binaire, ou $ACADVER <= AC1009 (R12), ou fichier illisible "
          "par ezdxf",
}

OLD_ACAD = {"MC0.0", "AC1.2", "AC1.40", "AC1.50", "AC2.10", "AC2.21",
            "AC2.22", "AC1001", "AC1002", "AC1003", "AC1004", "AC1006",
            "AC1009"}


def closed_loops(r):
    m = r.get("entitiesModelspace") or {}
    b = r.get("entitiesBlocks") or {}
    circles = m.get("CIRCLE", 0) + b.get("CIRCLE", 0)
    return (r.get("closedPolylines") or 0) + circles + (r.get("ellipses") or 0)


def families(r):
    fam = []
    m = r.get("entitiesModelspace") or {}
    loops = closed_loops(r)
    text = r.get("textLike") or 0
    dim = r.get("dimLike") or 0
    spl = r.get("splines") or 0
    layers = r.get("layers") or 0
    prim_msp = sum(m.get(k, 0) for k in ("LINE", "ARC"))

    if loops >= 1 and spl == 0 and text == 0 and dim == 0:
        fam.append("F1")
    if spl > 0:
        fam.append("F2")
    if (r.get("openPolylines") or 0) > 0 or prim_msp > 0:
        fam.append("F3")
    if (r.get("insertsInModelspace") or 0) > 0 or (r.get("blocks") or 0) > 0:
        fam.append("F4")
    if text > 0 or dim > 0 or layers > 3:
        fam.append("F5")
    u = r.get("insunits")
    if u is None or u != 4:
        fam.append("F6")
    if loops >= 2:
        fam.append("F7")
    if r.get("binary") or (r.get("acadverRaw") in OLD_ACAD) or not r.get("readable"):
        fam.append("F8")
    return fam


def provenance(idx):
    for lo, hi, prov, lic in PROVENANCE:
        if lo <= idx <= hi:
            return prov, lic
    return "?", "?"


def human(n):
    if n < 1024:
        return "%d o" % n
    if n < 1024 * 1024:
        return "%.1f Kio" % (n / 1024.0)
    return "%.1f Mio" % (n / (1024.0 * 1024.0))


def main():
    with open(INV, encoding="utf-8") as fh:
        recs = json.load(fh)

    rows = []
    for r in recs:
        name = r["file"]
        cid, orig = name.split("__", 1)
        idx = int(cid[1:])
        prov, lic = provenance(idx)
        fam = families(r)
        ver = r.get("acadverName") or "?"
        raw = r.get("acadverRaw")
        if raw:
            ver = "%s (%s)" % (ver, raw)
        if r.get("binary"):
            ver += " · binaire"
        if not r.get("readable"):
            ver += " · illisible ezdxf"
        rows.append({
            "id": cid, "idx": idx, "name": orig, "sha": r["sha256"],
            "prov": prov, "lic": lic, "fam": fam, "ver": ver,
            "size": human(r["bytes"]), "rec": r,
        })
    rows.sort(key=lambda x: x["idx"])

    counts = dict((k, 0) for k in FAMILIES)
    for row in rows:
        for f in row["fam"]:
            counts[f] += 1
    covered = sorted(k for k in counts if counts[k] >= 3)
    missing = sorted(k for k in counts if counts[k] < 3)

    L = []
    A = L.append
    A("# Corpus d'import — lot A (2026-09-09)")
    A("")
    A("Livrable du lot A de `docs/PLAN-IMPORT-2026-09-09.md` §3. **Rien n'a été")
    A("téléchargé** : le corpus est constitué de ce qui existait déjà sur la")
    A("machine (dépôt, disque du propriétaire) et dans les images docker.")
    A("")
    A("- Fichiers : **%d** (cible >= 30) — tous des DXF." % len(rows))
    A("- Familles couvertes avec au moins 3 fichiers : **%d / 8** (cible >= 6)."
      % len(covered))
    A("- Emplacement : `.testparts/corpus/`, nommés `<id>__<nom d'origine>`.")
    A("- Assemblage reproductible : `scripts/qa-import-corpus-build.sh`.")
    A("- Mesures : `scripts/qa-import-corpus-inventory.py` (ezdxf 1.4.4 dans")
    A("  l'image `nest2d-file-processing-worker:dev`), sortie brute dans")
    A("  `corpus-inventory.json` ; ce tableau en est dérivé par")
    A("  `scripts/qa-import-corpus-report.py`.")
    A("")
    A("## Familles et règle d'affectation")
    A("")
    A("Les familles sont **déduites des compteurs mesurés**, pas déclarées à la")
    A("main. Un fichier peut appartenir à plusieurs familles.")
    A("")
    A("| Code | Famille (§3 lot A) | Règle mesurée | Fichiers |")
    A("| --- | --- | --- | ---: |")
    for k in sorted(FAMILIES):
        A("| %s | %s | %s | %d |" % (k, FAMILIES[k], RULES[k], counts[k]))
    A("")
    A("**Limite énoncée** : F3 mesure la *présence* de contours ouverts ou de")
    A("primitives éparses, **pas** le critère « gap < 0,5 mm » du plan —")
    A("mesurer le gap exige de recoudre la géométrie, ce que font les")
    A("importeurs des lots B et C. C'est là qu'il sera chiffré, pas ici.")
    A("")
    A("## Tableau du corpus")
    A("")
    A("| id | nom | SHA-256 | provenance | licence | famille(s) | version DXF | taille |")
    A("| --- | --- | --- | --- | --- | --- | --- | ---: |")
    for row in rows:
        A("| %s | `%s` | `%s` | %s | %s | %s | %s | %s |" % (
            row["id"], row["name"], row["sha"], row["prov"], row["lic"],
            " ".join(row["fam"]) or "—", row["ver"], row["size"]))
    A("")
    A("## Détail mesuré")
    A("")
    A("Compteurs ezdxf par fichier (modelspace + définitions de blocs pour les")
    A("splines, textes, cotes ; « boucles fermées » = polylignes fermées +")
    A("CIRCLE + ELLIPSE).")
    A("")
    A("| id | $INSUNITS | boucles fermées | polylignes ouvertes | sommets bulge "
      "| SPLINE | textes | cotes | calques | blocs | INSERT msp | INSERT "
      "imbriqués | INSERT échelle | INSERT rotation | lecteur ezdxf |")
    A("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: "
      "| ---: | ---: | ---: | ---: | --- |")
    for row in rows:
        r = row["rec"]
        u = r.get("insunits")
        un = "%s (%s)" % (u, r.get("insunitsName")) if u is not None else "absent"
        reader = r.get("reader") or "échec"
        if reader == "recover":
            reader = "recover (%s erreurs)" % r.get("recoverErrors")
        cells = [closed_loops(r), r.get("openPolylines"), r.get("bulgeVertices"),
                 r.get("splines"), r.get("textLike"), r.get("dimLike"),
                 r.get("layers"), r.get("blocks"), r.get("insertsInModelspace"),
                 r.get("insertsNested"), r.get("insertsScaled"),
                 r.get("insertsRotated")]
        cells = ["—" if c is None else str(c) for c in cells]
        A("| %s | %s | %s | %s |" % (row["id"], un, " | ".join(cells), reader))
    A("")

    # --- section « ce qui manque » : comptes réels, pas d'estimation
    origin = {"propriétaire (flux CAO réel)": 4,
              "démo produit (généré ezdxf)": 24,
              "fixtures de parité (généré ezdxf)": 24,
              "validation CAM du dépôt": 7,
              "suite de tests GNU LibreDWG": 26}
    A("## Redistribution")
    A("")
    A("Les fichiers **ne sont pas versionnés** : ils vivent dans")
    A("`.testparts/corpus/`. Deux raisons distinctes :")
    A("")
    A("- c01–c04 : fichiers du propriétaire, pas de licence de publication ;")
    A("- c60–c85 : suite de tests GNU LibreDWG, GPL v3 — on ne recopie pas du")
    A("  GPL dans un dépôt propriétaire ; ils sont extraits à la demande de")
    A("  l'image docker par `scripts/qa-import-corpus-build.sh`.")
    A("")
    A("Ce document ne publie donc que **hash + provenance + licence**, comme")
    A("l'exige `docs/PLAN-IMPORT-2026-09-09.md` §2.")
    A("")
    A("**Attention** : `.testparts/` n'est PAS dans `.gitignore` (vérifié :")
    A("`git check-ignore` ne le retient pas, `git status` l'affiche en `??`).")
    A("Ne pas faire `git add -A` tant que ce n'est pas corrigé.")
    A("")
    A("## Ce qui manque")
    A("")
    A("Les seuils du plan sont atteints : %d fichiers (cible 30), %d familles"
      % (len(rows), len(covered)))
    A("sur 8 couvertes avec au moins 3 fichiers (cible 6). Ce qui manque est")
    A("**qualitatif**, et il faut le dire :")
    A("")
    A("### 1. Des fichiers vraiment tiers")
    A("")
    A("Origine réelle des %d fichiers :" % len(rows))
    A("")
    for k, v in origin.items():
        A("- %s : **%d**" % (k, v))
    A("")
    A("Autrement dit : **4 fichiers seulement** (c01–c04) proviennent d'un flux")
    A("CAO réel du propriétaire ; 55 sont produits par le projet lui-même")
    A("(ezdxf, générateurs du dépôt) et 26 viennent d'une suite de tests")
    A("d'interopérabilité (fichiers AutoCAD authentiques, mais orientés")
    A("« couverture du format », pas tôlerie de découpe).")
    A("")
    A("Un corpus « d'importeur » qui se mesure surtout sur des fichiers qu'il a")
    A("lui-même écrits mesure surtout sa propre boucle. **Zéro fichier client")
    A("ou prospect** : `specs/import-corpus/` (prévu par le plan §2) n'existe")
    A("pas sur cette machine, et les entretiens n'ont laissé aucun DXF ici.")
    A("")
    A("Où en prendre :")
    A("")
    A("- fichiers d'entretien / prospects du propriétaire (hors machine) —")
    A("  la source la plus utile, à déposer dans `specs/import-corpus/` ;")
    A("- corpus open-source de découpe laser (Thingiverse « laser cut »,")
    A("  Ponoko, dépôts CC0) — **nécessite un téléchargement**, non autorisé")
    A("  dans ce lot ;")
    A("- les `.dwg` de LibreDWG déjà présents dans l'image (chemin DWG du")
    A("  produit, hors périmètre DXF de ce lot).")
    A("")
    A("### 2. Non-faits mesurés")
    A("")
    A("- **F3 / gap < 0,5 mm** : aucun fichier dont l'écart d'un contour")
    A("  ouvert soit *connu* inférieur à 0,5 mm. F3 ne mesure ici que la")
    A("  présence de primitives à recoudre. À chiffrer aux lots B/C.")
    A("- **DXF binaires** : 2 seulement (c82 R2000, c83 R2018). Aucun binaire")
    A("  ancien (R12) : la suite LibreDWG n'en embarque pas.")
    A("- **ezdxf n'embarque aucun DXF d'exemple** dans le paquet pip : vérifié")
    A("  par `find / -iname '*.dxf'` dans l'image — les seuls DXF de l'image")
    A("  sont ceux de LibreDWG et les deux fixtures du dépôt. La source")
    A("  « dépôt ezdxf `examples/` » citée au plan §3 n'est donc pas")
    A("  disponible hors ligne.")
    A("- **Aucun DWG** dans ce corpus (lot A ne demande que du DXF).")
    A("- **Aucune mesure d'import** ici : ce lot inventorie, il n'importe pas.")
    A("  Les statuts read/repaired/refused sont le travail des lots B et C.")
    A("")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    print("corpus.md: %d lignes, familles >= 3 fichiers: %s ; sous le seuil: %s"
          % (len(rows), ", ".join(covered) or "aucune",
             ", ".join("%s=%d" % (k, counts[k]) for k in missing) or "aucune"))


main()
