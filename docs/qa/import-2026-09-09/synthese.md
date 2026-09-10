# Synthèse d'import — lot D (2026-09-10)

Livrable du lot D de `../../PLAN-IMPORT-2026-09-09.md` §3, avec les
exigences ajoutées par le **§7** (point du vérificateur du 10/09). Quatre
tableaux : par fichier, par cause, taux **stratifiés**, puis trois
propositions de réparation chiffrées — **proposées, pas décidées**.

**Aucune ligne de code produit n'a été touchée.** Verrou §5.2 rejoué :

```
$ git diff --stat HEAD -- app workers/geometry/src workers/fileprocessing/core
(vide)
```

Deux précisions d'honnêteté sur l'état de l'arbre, à ne pas confondre avec
ce lot :

- les 170 JSON (`wasm/c*.json`, `ezdxf/c*.json`) sont **non versionnés**
  (`??` au `git status`) : ils ont été produits après le commit
  `eaf11ff7`, au passage des 85 fichiers exigé par le §7. Leur champ
  `version` porte bien `eaf11ff7` (wasm : `eaf11ff7-dirty`) ;
- l'arbre de travail contient des modifications **antérieures et
  étrangères à ce lot** (`workers/nesting/bench/lock_last_sheet.py`,
  `workers/nesting/engine/crates/nest-engine/src/bpp/mod.rs` — chantier
  « dernière tôle »). Ce lot n'y a pas touché ; le verrou §5.2 porte sur
  `app`, `workers/geometry/src` et `workers/fileprocessing/core`, et il
  est vide.

## 0. Ce qui est joint, et ce qui ne l'est pas

- Source : `wasm/c01.json … c85.json` et `ezdxf/c01.json … c85.json`,
  produits au commit `eaf11ff7` (bundle wasm servi au navigateur,
  SHA-256 `cf44b60f…6350e`, 652 743 octets ; ezdxf 1.4.4 dans l'image
  `nest2d-file-processing-worker:dev`).
- **Seuls les fichiers `c*.json` sont comptés : 85 de chaque côté.** Les
  dossiers contiennent aussi `wasm/piece-trou.json`,
  `wasm/piece-fillx4.json`, `ezdxf/Piece_Trou.json` et
  `ezdxf/Piece_Fillx4.json` — reliquats du passage à 2 fichiers du lot B/C,
  **doublons de c01 et c02**. Les inclure compterait deux fois les deux
  seuls fichiers propres du corpus et gonflerait tous les taux. Ils sont
  ignorés partout dans ce document.
- Jointure : l'`id` (`c01`…`c85`) est la clé commune avec `corpus.md`.
  Aucun id manquant d'un côté ou de l'autre (85 ∩ 85).

## 0-bis. Stratification (exigée par le §7)

`corpus.md` §« Ce qui manque » établit l'origine réelle des 85 fichiers.
Elle commande toute lecture de ce document :

| strate | ids | n | ce que c'est |
| --- | --- | ---: | --- |
| **Réels** | c01–c04 | **4** | flux CAO réel du propriétaire (fixtures historiques, pièces SmartTHC de découpe/marquage) |
| Synthétiques — validation CAM | c05–c11 | 7 | entrées et sorties de `docs/cam-validation/`, écrites par le projet |
| Synthétiques — démo produit | c12–c35 | 24 | `server/seed/demo/`, générées par `scripts/generate_demo_dxf.py` (ezdxf) |
| Synthétiques — fixtures de parité | c36–c59 | 24 | `workers/geometry/parity/corpus_extra/`, générées par `build_corpus.py` (ezdxf) |
| Synthétiques — suite GNU LibreDWG | c60–c85 | 26 | fichiers AutoCAD authentiques, mais d'une suite d'interopérabilité de format, pas de tôlerie |
| **Synthétiques (total)** | c05–c85 | **81** | |

> **Quatre fichiers ne font pas une statistique.** Le taux « lu sans
> réparation manuelle » n'est publié que sur les 4 réels (§3), et un taux
> sur 4 fichiers a une granularité de 25 points : il indique un ordre de
> grandeur, pas une performance. Les 81 synthétiques mesurent surtout la
> boucle du projet sur lui-même (55 fichiers écrits par ezdxf, l'un des
> deux importeurs mesurés) et la couverture de format de LibreDWG. Ils
> sont donnés séparément et ne se mélangent jamais aux réels.

## 1. Tableau par fichier

`parts` / `holes` / `unité` / `échelle` / `ms` : **wasm / ezdxf**. Un `—`
est un `null` de la grille §4 (champ non mesuré, jamais un zéro).

« Écart » = statut différent, **ou** nombre de pièces différent, **ou**
facteur d'échelle différent — en ne comparant que des valeurs mesurées des
deux côtés. Un `0` face à un `—` (les deux ont refusé, l'un a mesuré
avant de refuser, l'autre non) n'est **pas** compté comme un écart : ce
serait un artefact de la grille, pas un désaccord.

| id | nom | statut wasm | statut ezdxf | pièces | trous | unité détectée | échelle | ms | écart |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| c01 | `Piece_Trou.DXF` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 8.926 / 11 | non |
| c02 | `Piece_Fillx4.DXF` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 5.018 / 9 | non |
| c03 | `MARK_TOP_FACE.DXF` | read | repaired | 141 / 151 | 39 / 70 | mm / mm | ×1 / ×1 | 9423.55 / 2283 | oui |
| c04 | `Top_Face_Marking_Final.dxf` | read | refused | 169 / — | 50 / — | assumed-mm / unitless | ×1 / ×1 | 541.587 / 298 | oui |
| c05 | `_src_simple.dxf` | read | read | 1 / 1 | 0 / 0 | m / m | ×1000 / ×1000 | 3.695 / 9 | non |
| c06 | `_src_holed.dxf` | read | read | 1 / 1 | 2 / 2 | m / m | ×1000 / ×1000 | 243.366 / 62 | non |
| c07 | `_src_multi.dxf` | read | read | 1 / 1 | 0 / 0 | m / m | ×1000 / ×1000 | 438.705 / 37 | non |
| c08 | `cam_1_piece_simple.dxf` | refused | repaired | 0 / 2 | 0 / 1 | assumed-mm / mm | ×1 / ×1 | 3.017 / 7 | oui |
| c09 | `cam_2_piece_trous.dxf` | read | repaired | 2 / 2 | 0 / 3 | assumed-mm / mm | ×1 / ×1 | 5.051 / 8 | oui |
| c10 | `cam_3_multi_rotations_mm.dxf` | read | repaired | 1 / 4 | 0 / 1 | assumed-mm / mm | ×1 / ×1 | 3.908 / 10 | oui |
| c11 | `cam_4_multi_rotations_inch.dxf` | refused | repaired | 0 / 3 | 0 / 1 | assumed-mm / inch | ×1 / ×25.4 | 3.214 / 7 | oui |
| c12 | `marine_lpl_001.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.348 / 8 | non |
| c13 | `marine_lpl_002.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.012 / 8 | non |
| c14 | `marine_lpl_003.dxf` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 5.292 / 9 | non |
| c15 | `marine_lpl_004.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 6.058 / 13 | non |
| c16 | `marine_lpl_005.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.836 / 8 | non |
| c17 | `marine_lpl_006.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 3.651 / 7 | non |
| c18 | `marine_lpl_007.dxf` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 5.064 / 10 | non |
| c19 | `marine_lpl_008.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 5.279 / 9 | non |
| c20 | `marine_lpl_009.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 5.07 / 9 | non |
| c21 | `marine_lpl_010.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.393 / 8 | non |
| c22 | `marine_lpl_011.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.436 / 10 | non |
| c23 | `marine_lpl_012.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 6.204 / 11 | non |
| c24 | `marine_lpl_013.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 6.166 / 12 | non |
| c25 | `marine_lpl_014.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 6.135 / 13 | non |
| c26 | `marine_lpl_015.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.87 / 9 | non |
| c27 | `marine_lpl_016.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 7.07 / 11 | non |
| c28 | `marine_lpl_017.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 6.484 / 11 | non |
| c29 | `marine_lpl_018.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 5.946 / 10 | non |
| c30 | `marine_lpl_019.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 3.611 / 8 | non |
| c31 | `marine_lpl_020.dxf` | read | read | 1 / 1 | 2 / 2 | mm / mm | ×1 / ×1 | 6.518 / 11 | non |
| c32 | `marine_lpl_021.dxf` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 3.752 / 9 | non |
| c33 | `marine_lpl_022.dxf` | read | read | 1 / 1 | 5 / 5 | mm / mm | ×1 / ×1 | 12.618 / 18 | non |
| c34 | `marine_lpl_023.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 5.349 / 10 | non |
| c35 | `marine_lpl_024.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 3.768 / 9 | non |
| c36 | `blocks_nested.dxf` | read | read | 3 / 3 | 0 / 0 | mm / mm | ×1 / ×1 | 5.287 / 15 | non |
| c37 | `bulge_ignored.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 3.541 / 8 | non |
| c38 | `chan_edge_close.dxf` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 5.292 / 13 | non |
| c39 | `chan_ornate.dxf` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 5.025 / 9 | non |
| c40 | `chan_tiny_hole.dxf` | read | read | 1 / 1 | 1 / 1 | mm / mm | ×1 / ×1 | 4.548 / 10 | non |
| c41 | `curves_closed.dxf` | read | repaired | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 5.984 / 9 | oui |
| c42 | `curves_mix.dxf` | read | repaired | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 13.67 / 12 | oui |
| c43 | `empty.dxf` | refused | refused | 0 / — | 0 / — | mm / mm | ×1 / ×1 | 2.832 / 7 | non |
| c44 | `hatch_pattern.dxf` | repaired | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 4.194 / 10 | oui |
| c45 | `hatch_solid.dxf` | repaired | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 3.7 / 8 | oui |
| c46 | `legacy_polyline.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 3.758 / 8 | non |
| c47 | `only_arc.dxf` | refused | refused | 0 / 0 | 0 / 0 | mm / mm | ×1 / ×1 | 3.752 / 9 | non |
| c48 | `only_ellipse.dxf` | read | read | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 6.549 / 11 | non |
| c49 | `only_spline.dxf` | refused | refused | 0 / — | 0 / — | mm / mm | ×1 / ×1 | 3.099 / 7 | non |
| c50 | `stress_open_curves.dxf` | read | repaired | 1 / 1 | 0 / 0 | mm / mm | ×1 / ×1 | 14.007 / 13 | oui |
| c51 | `text_only.dxf` | refused | refused | 0 / — | 0 / — | mm / mm | ×1 / ×1 | 4.017 / 7 | non |
| c52 | `two_parts.dxf` | read | read | 2 / 2 | 0 / 0 | mm / mm | ×1 / ×1 | 4.42 / 8 | non |
| c53 | `units_cm.dxf` | read | read | 1 / 1 | 0 / 0 | cm / cm | ×10 / ×10 | 4.456 / 8 | non |
| c54 | `units_ft.dxf` | read | read | 1 / 1 | 0 / 0 | ft / foot | ×304.8 / ×304.8 | 3.791 / 8 | non |
| c55 | `units_in.dxf` | read | read | 1 / 1 | 0 / 0 | in / inch | ×25.4 / ×25.4 | 3.632 / 9 | non |
| c56 | `units_m.dxf` | read | read | 1 / 1 | 0 / 0 | m / m | ×1000 / ×1000 | 4.22 / 8 | non |
| c57 | `units_mil.dxf` | read | read | 1 / 1 | 0 / 0 | mil / mil | ×0.0254 / ×0.0254 | 3.612 / 11 | non |
| c58 | `units_none.dxf` | read | read | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.752 / 7 | non |
| c59 | `units_unknown.dxf` | repaired | read | 1 / 1 | 0 / 0 | assumed-mm / km | ×1 / ×1 | 4.007 / 8 | oui |
| c60 | `libredwg_r1.4_entities.dxf` | refused | refused | 0 / — | 0 / — | assumed-mm / — | ×1 / ×— | 2.391 / 0 | non |
| c61 | `libredwg_r2.6_entities.dxf` | repaired | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.864 / 9 | non |
| c62 | `libredwg_r2.6_dim.dxf` | repaired | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.95 / 13 | non |
| c63 | `libredwg_r2.10_entities.dxf` | repaired | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.831 / 7 | non |
| c64 | `libredwg_r2.10_block.dxf` | refused | refused | 0 / — | 0 / — | assumed-mm / unitless | ×1 / ×1 | 2.669 / 4 | non |
| c65 | `libredwg_r9_entities.dxf` | repaired | repaired | 2 / 2 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 4.813 / 9 | non |
| c66 | `libredwg_r10_entities.dxf` | repaired | repaired | 2 / 2 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 4.208 / 10 | non |
| c67 | `libredwg_r10_tmp_line.dxf` | refused | refused | 0 / 0 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 2.978 / 5 | non |
| c68 | `libredwg_r11_entities-2d.dxf` | repaired | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.8 / 9 | non |
| c69 | `libredwg_r11_entities-3d.dxf` | repaired | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.773 / 11 | non |
| c70 | `libredwg_r12_Leader.dxf` | read | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 3.706 / 15 | oui |
| c71 | `libredwg_r13_v.dxf` | repaired | repaired | 1 / 1 | 1 / 1 | assumed-mm / unitless | ×1 / ×1 | 3.493 / 12 | non |
| c72 | `libredwg_r14_Leader.dxf` | repaired | repaired | 1 / 1 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 4.897 / 37 | non |
| c73 | `libredwg_example_r12.dxf` | refused | repaired | 5 / 6 | 12 / 14 | assumed-mm / unitless | ×1 / ×1 | 4882.02 / 1055 | oui |
| c74 | `libredwg_example_r13.dxf` | refused | repaired | 1 / 2 | 13 / 13 | assumed-mm / unitless | ×1 / ×1 | 7162.64 / 1079 | oui |
| c75 | `libredwg_example_r14.dxf` | repaired | repaired | 1 / 2 | 13 / 13 | assumed-mm / unitless | ×1 / ×1 | 5761.13 / 831 | oui |
| c76 | `libredwg_sample_r14.dxf` | repaired | repaired | 3 / 3 | 0 / 0 | assumed-mm / unitless | ×1 / ×1 | 5.881 / 17 | non |
| c77 | `libredwg_2000_PolyLine2D.dxf` | refused | refused | 0 / — | 0 / — | mm / mm | ×1 / ×1 | 4.531 / 36 | non |
| c78 | `libredwg_2000_TS1.dxf` | repaired | refused | 5 / — | 0 / — | in / inch | ×25.4 / ×25.4 | 11.597 / 0 | oui |
| c79 | `libredwg_2010_gh209_1.dxf` | repaired | repaired | 1 / 1 | 2 / 1 | m / m | ×1000 / ×1000 | 14.129 / 40 | non |
| c80 | `libredwg_2013_gh109_1.dxf` | repaired | repaired | 1 / 5 | 0 / 1 | assumed-mm / unitless | ×1 / ×1 | 5.951 / 259 | oui |
| c81 | `libredwg_2018_Dynblocks.dxf` | refused | refused | — / — | — / — | — / inch | ×— / ×25.4 | — / 0 | non |
| c82 | `libredwg_example_2000.dxfb` | refused | refused | — / — | — / — | — / — | ×— / ×— | — / 0 | non |
| c83 | `libredwg_example_2018.dxfb` | refused | refused | — / — | — / — | — / — | ×— / ×— | — / 0 | non |
| c84 | `libredwg_sample_2000.dxf` | repaired | read | 3 / 3 | 0 / 0 | mm / mm | ×1 / ×1 | 6.328 / 39 | oui |
| c85 | `libredwg_sample_2018.dxf` | repaired | read | 3 / 3 | 0 / 0 | mm / mm | ×1 / ×1 | 6.111 / 23 | oui |

**20 fichiers sur 85 (23,5 %) présentent un écart entre les deux
importeurs.** Le plan §0 annonçait que cet écart serait « un résultat en
soi » : c'est le cas, et il porte sur près d'un fichier sur quatre.

## 2. Tableau par cause

Les causes sont **déduites des JSON**, pas déclarées. « Importeur en
défaut » nomme celui dont le comportement est fautif, pas celui qui refuse
le plus.

| # | Cause | Fréquence | Témoin | Importeur en défaut | Ce qui se passe |
| --- | --- | ---: | --- | --- | --- |
| **C1** | **Unités : facteur faux ou perdu, sans message à l'utilisateur** | **24 / 85 (28,2 %)** | c59, c11, c04 | les deux, différemment | trois sous-causes ci-dessous |
| C1a | code `$INSUNITS` hors table de conversion | 1 / 85 | **c59** `units_unknown.dxf` | **ezdxf** | §2.1 — erreur de facteur ×10⁶, statut `read` |
| C1b | `$INSUNITS` écrit en flottant → non parsé | 4 / 85 | **c11** `cam_4_multi_rotations_inch.dxf` | **wasm** | §2.2 — erreur de facteur ×25,4 |
| C1c | `$INSUNITS` absent ou 0 → mm supposés | 19 / 85 | c04, c58, c60–c76, c80 | les deux (défaut assumé) | comportement historique documenté ; aucun message |
| **C2** | **Contours ouverts jamais refermés — linework perdu sans message** | **19 / 85 (22,4 %)**, **4 221 segments pendants** | **c73** (1 337 pendants / 6 pièces), c75 (1 351 / 2), c74 (1 334 / 2), c80 (106 / 5), **c03** (9 / 151, *réel*) | les deux | §2.3 |
| **C3** | **Entité porteuse de matière écartée sans message** | **14 / 85 (16,5 %)** | c44 et c45 (`HATCH`), c78 (`OLE2FRAME`, `REGION`, `3DSOLID`), c80 (`ACAD_PROXY_ENTITY` ×27) | les deux | §2.4 — le wasm produit l'avertissement, l'UI le jette |
| C4 | Textes, cotes, calques parasites | 22 / 85 ont ≥ 1 entité écartée, dont **8 de bruit seul** | `TEXT` 17 fichiers, `DIMENSION` 11, `ATTRIB`/`SEQEND` 11 | aucun | comportement **voulu**. c51 `text_only.dxf` refusé des deux côtés = correct, il n'y a rien à découper |
| C5 | Splines | 7 / 85 | c41, c42, c49, c50, c74, c75, c78 | aucun | échantillonnées des deux côtés (`splinesHandled: sampled`), **jamais refusées**. c49 `only_spline.dxf` est refusé parce que sa spline est **ouverte**, pas parce que c'est une spline |
| C6 | Blocs / INSERT (imbriqués, échelle, rotation) | 16 / 85 aplatis | c36 `blocks_nested.dxf` : 3 pièces / 3 pièces | aucun | **aucun échec attribuable aux blocs** dans ce corpus |
| C7 | Trous imbriqués / pièces multiples | 40 fichiers F7 | écart sur 2 seulement : c03 (39 / 70 trous), c79 (2 / 1) | non isolé | l'écart de c03 est un sous-produit de C2 (contour perdu ⇒ trou perdu) |
| C8 | Versions anciennes et binaires | 15 fichiers F8, dont **4 refusés des deux côtés** | c82, c83 (`.dxfb`), c60 (R1.4), c81 (R2018, 9,8 Mio) | les deux | wasm : refus **par extension** (`.dxfb` hors `['.dxf','.svg']`, `localImport.js` l. 101) ; ezdxf : `DXFStructureError: Invalid group code "AutoCAD Binary DXF"`. **Aucun des deux ne lit le DXF binaire** |
| **C9** | **Garde de volume posée APRÈS le travail** | **2 / 85** | **c73** (4 882 ms puis refus), **c74** (7 163 ms puis refus) | **wasm** | §2.5 |
| C10 | Divergence de comptage de pièces entre importeurs | 8 / 85 (9,4 %) | c03 (141/151), c10 (1/4), c80 (1/5), c08 (0/2), c11 (0/3) | non isolé | navigateur et serveur ne livrent pas la même pièce ; sur c08 et c11 le navigateur **ne livre rien** là où le serveur livre |

### 2.1 C1a — c59 : `$INSUNITS = 7` (kilomètres) reçoit `scaleApplied 1.0`

**Vérifié dans les deux JSON** :

| | wasm | ezdxf |
| --- | --- | --- |
| `unitDeclared` | 7 | 7 |
| `unitDetected` | `assumed-mm` | **`km`** |
| `scaleApplied` | 1 | **1.0** |
| `status` | `repaired` | **`read`** |
| avertissement | `unknown $INSUNITS=7 — assuming millimeters` | *(aucun dans la grille)* |

La table de conversion est incomplète **des deux côtés**
(`workers/common/worker_common/geometry/units.py` `INSUNITS_TO_MM` et son
jumeau `workers/geometry/crates/nest-import/src/units.rs`
`insunits_factor`) : elles couvrent 1, 2, 4, 5, 6, 8, 9 et **ignorent 3
(miles), 7 (km), 10 (yards) et 11 à 20** (angström → parsec). Le code non
couvert retombe sur le facteur 1,0, c'est-à-dire « millimètres ».

Sur c59 cela vaut **une erreur de facteur 10⁶** sur toute la géométrie.
La différence entre les deux importeurs n'est pas le facteur — il est faux
des deux côtés — mais **l'aveu** : le wasm bascule en `repaired` avec un
avertissement lisible, ezdxf reste en `read`. Côté Python il existe bien
un `logger.warning("Unknown $INSUNITS=7; assuming millimeters.")`, mais il
part **dans le journal du worker** : la grille ne le voit pas, l'API ne le
porte pas, l'utilisateur ne le lit jamais. C'est le sens de « sans
avertissement » ici — un journal de worker n'est pas un message à
l'utilisateur.

**C'est probablement la cause la plus grave du corpus** : elle est
silencieuse, elle porte sur un facteur, et un facteur faux ne se voit pas
sur un aperçu — il se voit sur la tôle.

### 2.2 C1b — c08 à c11 : `$INSUNITS` écrit en flottant, perdu côté wasm

Constat de mesure : sur c08, c09, c10 et c11 le wasm rend
`unitDeclared: 0` / `unitDetected: assumed-mm` là où ezdxf rend 4, 4, 4 et
**1 (inch, `scaleApplied: 25.4`)**.

Cause tracée à la source (lecture seule) : ces quatre fichiers écrivent

```
  9
$INSUNITS
 70
4.0            ← c08, c09, c10   (c11 : 1.0)
```

soit une **valeur flottante dans un groupe 70** (entier 16 bits). Le
lecteur wasm fait `insunits = v.trim().parse().unwrap_or(0)`
(`workers/geometry/crates/nest-import/src/dxf/mod.rs` l. 131) : `"1.0"`
n'est pas un `i32`, le `unwrap_or(0)` avale l'échec, le fichier devient
« sans unité » donc « mm ». ezdxf, tolérant, lit 1.

Sur **c11 le fichier est en pouces** : le chemin navigateur le lirait à
l'échelle 1 au lieu de 25,4 — **erreur de facteur ×25,4**. Ce n'est pas un
cas exotique : les quatre fichiers concernés sont les sorties CAM **écrites
par NestorCut lui-même** (`docs/cam-validation/cam_*.dxf`). Un de nos
exports n'est pas relu correctement par notre propre importeur navigateur.

*Précision, pour ne pas surinterpréter* : sur c11 la conséquence est
masquée par un second défaut — le wasm y rend 0 pièce et le job est refusé
avant que l'échelle ne serve. Sur c09 et c10 le facteur juste vaut 1 de
toute façon. Le défaut d'échelle est donc **établi sur la lecture
d'en-tête**, il n'est **pas observé sur une pièce livrée**.

### 2.3 C2 — le gap de 0,3 mm : le contour n'est pas refermé et disparaît

**Constat hérité du lot C** (`eaf11ff7`, message de commit) : *un gap de
0,3 mm n'est PAS refermé, le contour est perdu sans message*.

**Réserve de traçabilité, à dire** : le lot C n'a **pas conservé le fichier
témoin**. Il n'existe dans le dépôt ni fixture à gap 0,3 mm (`.testparts/`
ne contient que `Piece_Trou.DXF`, `Piece_Fillx4.DXF` et `corpus/`), ni
ligne de la grille portant cette mesure — le corpus est composé de 85 DXF
et `corpus.md` §« Non-faits » écrit déjà qu'**aucun fichier du corpus n'a
de gap connu inférieur à 0,5 mm**. Le chiffre « 0,3 mm » n'est donc pas
rejouable en l'état ; il est repris ici comme constat du lot C, pas comme
mesure du lot D.

Ce qui **est** vérifiable, et qui rend le résultat prévisible sans le
fichier : **il n'existe aucune étape de fermeture de gap, d'aucun côté.**

- ezdxf : `workers/fileprocessing/core/geometry/build_geometry.py` — le
  seul recollement est `set_precision(unary_union(linework), GRID_SIZE)`
  avec `GRID_SIZE = 1e-4` (0,0001 mm). Un gap de 0,3 mm vaut **3 000 fois
  la grille** : il n'est jamais franchi. Ce qui ne ferme aucune face sort
  en `dangles` de `polygonize_full` — c'est exactement le champ
  `openContours` de la grille, et il n'est remonté **nulle part** à
  l'utilisateur.
- wasm : `workers/geometry/crates/nest-import/src/assemble.rs` — même
  grille de snap 1e-4, et la seule fermeture est **intra-entité**
  (`closed = pts.len() > 2 && dist(premier, dernier) < tol`, `tol` = 0,01
  mm à l'upload). Deux entités distinctes séparées de 0,3 mm ne sont jamais
  cousues.
- Et le champ censé mesurer la réparation, `openContoursClosed`, est
  **`null` sur les 170 JSON** : il n'y a rien à compter parce qu'il n'y a
  pas d'étape de fermeture.

**Témoins mesurés du même mode de défaillance, eux rejouables** (linework
qui ne ferme rien, aucun message, pièce absente du résultat) :

| témoin | segments pendants (ezdxf) | pièces rendues (ezdxf) | statut wasm / ezdxf |
| --- | ---: | ---: | --- |
| **c73** `libredwg_example_r12.dxf` | **1 337** | 6 | `refused` / `repaired` |
| **c75** `libredwg_example_r14.dxf` | **1 351** | 2 | `repaired` / `repaired` |
| **c74** `libredwg_example_r13.dxf` | **1 334** | 2 | `refused` / `repaired` |
| c80 `libredwg_2013_gh109_1.dxf` | 106 | 5 | `repaired` / `repaired` |
| **c03** `MARK_TOP_FACE.DXF` *(réel)* | 9 | 151 (wasm : **141**) | `read` / `repaired` |

c73, c74 et c75 sont bien le **gros gisement de linework perdu sans
message** annoncé au §7 : plus de 1 300 segments pendants chacun pour 6, 2
et 2 pièces rendues. c03 est le seul témoin **réel** : 9 segments pendants,
et 10 pièces de moins côté navigateur que côté serveur, sans un mot.

**Et le navigateur ne sait même pas les compter** : `openContours` vaut
`null` sur les **85 / 85** JSON wasm. Le lot B l'avait signalé, la mesure le
confirme — la colonne n'est **pas comparable** entre les deux importeurs.
On ne compare donc rien ici : on constate une **absence d'instrumentation**
du côté qui est le chemin principal du produit.

### 2.4 C3 — la matière écartée, et l'avertissement qui existe déjà

Sur 22 fichiers le wasm émet au moins un `skipped entity`. Le tri par
nature de l'entité :

- **14 fichiers** perdent au moins une entité **porteuse de matière** :
  `HATCH` (5 fichiers), `SOLID` (9), `TRACE` (7), `3DFACE` (8), `SHAPE`
  (6), `REGION` (3), `3DSOLID` (3), `MLINE` (3), `ACAD_PROXY_ENTITY` (3
  fichiers, **27 occurrences** sur le seul c80), `OLE2FRAME` (1),
  `ACAD_TABLE` (1), `REPEAT`/`ENDREP` (1) ;
- **8 fichiers** ne perdent que du **bruit** (`TEXT`, `MTEXT`, `ATTDEF`,
  `ATTRIB`, `SEQEND`, `DIMENSION`, `LEADER`, `VIEWPORT`, `IMAGE`,
  `TOLERANCE`, `XLINE`, `RAY`, `WIPEOUT`) — comportement voulu.

Le point utile pour le lot E : **l'avertissement existe déjà côté wasm et
meurt en route.** `app/composables/localImport.js` l. 159 stocke bien
`warnings: imported.warnings || []` dans l'enregistrement IndexedDB, mais
`localRecordToUiFile` (même fichier) **ne le recopie pas** dans la forme
rendue à l'UI, et `app/components/FileDone.vue` ne contient aucune
occurrence de `warning`. Côté serveur il n'y a même pas de champ :
seulement des `logger.warning` dans `core/main.py`.

### 2.5 C9 — la garde `tooManyEntities` est posée après le travail

**Vérifié dans les JSON wasm** :

| témoin | `ms` avant refus | garde | seuil |
| --- | ---: | --- | --- |
| **c73** | **4 882 ms** | `localImport.tooManyEntities` | 1 546 > 999 |
| **c74** | **7 163 ms** | `localImport.tooManyEntities` | 1 492 > 999 |

Le compte d'entités n'est connu qu'**après** `import_file` : le chemin
navigateur (`app/composables/localImport.js`, l. 111 puis l. 123) importe
le fichier en entier, **puis** compare `imported.entity_count` au seuil de
999 et jette. L'utilisateur attend 5 à 7 secondes, onglet figé, pour
recevoir un refus. Le coureur du lot B est un miroir exact de ces gardes,
pas une invention du harnais.

La forme correcte existe déjà à côté, pour la taille : **c81** est refusé
par `upload.tooLarge` (10 308 881 > 5 242 880) avec `ms: null` — rien n'a
été calculé. La garde de volume, elle, arrive trop tard.

*À noter pour ne pas surinterpréter* : **c75**, de même nature, compte
moins de 999 entités et passe la garde — il paie quand même **5 761 ms**
d'import et sort en `repaired` avec 1 351 segments pendants. Le coût n'est
pas causé par la garde ; la garde ne fait que le gaspiller.

### 2.6 Ce que coûte l'import, en dehors des refus

Trois fichiers dépassent la demi-seconde côté wasm hors gardes :

| fichier | wasm | ezdxf |
| --- | ---: | ---: |
| **c03** `MARK_TOP_FACE.DXF` *(réel, 534 Kio)* | **9 424 ms** | 2 283 ms |
| c75 `libredwg_example_r14.dxf` | 5 761 ms | 831 ms |
| c04 `Top_Face_Marking_Final.dxf` *(réel, 707 Kio)* | 542 ms | 298 ms |

**Le seul fichier réel un peu gros du corpus met 9,4 secondes à s'importer
dans le navigateur** — 4,1 fois le temps du chemin serveur. Ce n'est pas un
refus : c'est le chemin nominal de la promesse « 100 % privé ».

### 2.7 Le constat SVG du lot C (~4,3 s pour 6 entités)

Repris du lot C, **non rejouable en l'état** : le corpus du lot A est
composé de **85 DXF et de zéro SVG** (`format: "dxf"` sur les 85 JSON
wasm), et aucun fichier SVG témoin n'a été conservé dans `.testparts/`.
Aucun des 170 JSON ne porte cette mesure. Elle est citée ici parce que le
§7 l'exige au classement, avec sa réserve : **elle n'a pas de fichier
témoin dans le dépôt**, et le lot de réparation doit commencer par en
produire un. Le chemin existe des deux côtés
(`workers/geometry/crates/nest-import/src/svg/mod.rs` et
`workers/fileprocessing/core/svg_to_drawing.py`) : le mesurer coûte une
fixture et un passage des deux coureurs, pas un chantier.

## 3. Taux « lu sans réparation manuelle » — stratifié

Deux lectures, parce que la grille §4 a trois statuts et que « sans
réparation » peut vouloir dire deux choses. Les deux sont données ; la
cible masterplan §4 T3 (≥ 95 % **après** le lot de réparation) se lit sur
la seconde.

**(a) `read` strict** — l'importeur n'a rien eu à corriger :

| strate | n | wasm | ezdxf |
| --- | ---: | ---: | ---: |
| **Réels (c01–c04)** | **4** | **4 / 4 = 100 %** | **2 / 4 = 50 %** |
| Synthétiques (c05–c85) | 81 | 47 / 81 = 58,0 % | 46 / 81 = 56,8 % |
| *(mémoire : tout confondu)* | 85 | 51 / 85 = 60,0 % | 48 / 85 = 56,5 % |

**(b) non refusé** (`read` + `repaired`) — l'utilisateur obtient quelque
chose sans toucher à son fichier :

| strate | n | wasm | ezdxf |
| --- | ---: | ---: | ---: |
| **Réels (c01–c04)** | **4** | **4 / 4 = 100 %** | **3 / 4 = 75 %** |
| Synthétiques (c05–c85) | 81 | 66 / 81 = 81,5 % | 69 / 81 = 85,2 % |
| *(mémoire : tout confondu)* | 85 | 70 / 85 = 82,4 % | 72 / 85 = 84,7 % |

Détail par sous-strate synthétique (`read` / `repaired` / `refused`) :

| sous-strate | n | wasm | ezdxf |
| --- | ---: | --- | --- |
| validation CAM (c05–c11) | 7 | 5 / 0 / 2 | 3 / 4 / 0 |
| démo produit (c12–c35) | 24 | 24 / 0 / 0 | 24 / 0 / 0 |
| fixtures de parité (c36–c59) | 24 | 17 / 3 / 4 | 17 / 3 / 4 |
| suite LibreDWG (c60–c85) | 26 | 1 / 16 / 9 | 2 / 16 / 8 |

### Ce que ces taux valent, et ne valent pas

- **Le taux publié est celui des réels : wasm 4/4, ezdxf 2/4.** Sur
  **quatre** fichiers. Un fichier de plus ou de moins déplace le taux de
  25 points. **Quatre fichiers ne font pas une statistique** : c'est un
  ordre de grandeur et un point de départ, pas une mesure de robustesse.
  Le §7 a raison d'exiger les fichiers d'entretien — sans eux, la cible
  « ≥ 95 % » du masterplan n'a pas de dénominateur crédible.
- Le seul échec réel est instructif : **c04**, un R11/R12 de 707 Kio avec
  236 boucles fermées, est **refusé par ezdxf** (`Entity count is 0`) alors
  que **le wasm en sort 169 pièces et 50 trous**. Sur un fichier client
  réel, le chemin serveur ne rend rien et le chemin navigateur rend tout.
  C'est l'écart le plus spectaculaire du corpus.
- Les 24 fichiers de démo passent à **100 % des deux côtés**. C'est attendu
  et ne prouve rien : ils sont écrits par ezdxf et mesurés par ezdxf. Cette
  strate gonfle mécaniquement les taux synthétiques.
- Les 26 fichiers LibreDWG les font chuter tout aussi mécaniquement (1
  `read` sur 26 côté wasm) : ce sont des fichiers d'interopérabilité
  bourrés de cotes, de proxies et de linework 3D, pas des pièces à
  découper. **Ils mesurent la tolérance au format, pas l'aptitude au
  métier.**
- Conséquence : **la moyenne « tous fichiers confondus » (60,0 % / 56,5 %)
  n'a pas de sens métier.** Elle n'est reprise ci-dessus que pour mémoire —
  ne pas la publier.

## 4. Les trois causes les plus fréquentes — réparations chiffrées

Rappel §5.4 du plan : **proposées, jamais décidées.** Une proposition par
cause, chiffrée en fichiers touchés, effort, et risque sur le verrou
« déterminisme natif ≡ wasm » (`workers/nesting/bench/determinism_lock.py`,
parité `workers/geometry/parity/`).

### R1 — C1 « unités » (24 / 85, la plus grave)

**Ce qu'on répare** : compléter la table `$INSUNITS` des deux côtés, rendre
le parseur d'en-tête wasm tolérant au flottant, et **faire remonter le
doute** au lieu de l'écrire dans un journal.

| | |
| --- | --- |
| **Fichiers touchés** | `workers/common/worker_common/geometry/units.py` (`INSUNITS_TO_MM` : codes 3, 7, 10 à 20) · `workers/geometry/crates/nest-import/src/units.rs` (`insunits_factor`, jumeau) · `workers/geometry/crates/nest-import/src/dxf/mod.rs` l. 131 (`parse::<i32>` → parse tolérant au flottant) · `workers/fileprocessing/core/main.py` (porter l'avertissement dans le document, pas seulement le log) · `app/composables/localImport.js` (`localRecordToUiFile` : recopier `warnings`) · `app/components/FileDone.vue` + `app/utils/i18n.js` (affichage) · **rebuild `workers/geometry/build-wasm.sh` dans la MÊME PR** (piège #33b) |
| **Effort** | **2 j** — 0,5 j table + parseur des deux côtés ; 0,5 j tests jumeaux (`units.rs` a déjà `unknown_code_warns_and_assumes_mm`, le pendant Python est à écrire) ; 1 j remontée du message jusqu'à `FileDone.vue` en FR/EN |
| **Risque déterminisme** | **faible, non nul.** Le facteur d'unité est une multiplication IEEE (pas une transcendantale, piège #14b) : natif et wasm restent bit-identiques **si les deux tables changent dans la même PR**. Le vrai risque est la **désynchronisation** — une table complétée d'un seul côté fait diverger `scaleApplied`, donc toute la géométrie. Verrous à rejouer : `determinism_lock.py`, parité `workers/geometry/parity/`, `test_dxf_units.py`. **Second risque, produit** : un job déjà en base sur un fichier code 7 changerait de géométrie à la relecture — décision de compatibilité à trancher par le propriétaire, pas par l'implémenteur |
| **Ce qui reste non mesuré** | les codes 3 et 10 à 20 n'ont **aucun fichier témoin** dans le corpus (seul le 7 y est) : la réparation serait écrite sans mesure de départ |

### R2 — C2 « contours ouverts » (19 / 85, 4 221 segments pendants)

**Ce qu'on répare** : compter les segments pendants **des deux côtés** (le
wasm ne sait pas les compter), puis refermer ceux dont le gap est inférieur
à un seuil affiché, et **dire** combien ont été refermés et combien jetés.

| | |
| --- | --- |
| **Fichiers touchés** | `workers/geometry/crates/nest-import/src/assemble.rs` (comptage des pendants + couture sous seuil) · `workers/fileprocessing/core/geometry/build_geometry.py` (les `dangles` de `polygonize_full` existent déjà : les remonter, puis coudre) · les deux surfaces de rapport (`core/main.py`, `app/composables/localImport.js`, `app/components/FileDone.vue`, `app/utils/i18n.js`) · rebuild wasm dans la même PR · fixtures de parité à ajouter dans `workers/geometry/parity/corpus_extra/`, **dont le fichier à gap 0,3 mm que le lot C n'a pas conservé** |
| **Effort** | **4 à 6 j** — 1 j instrumentation (compter, sans rien coudre : c'est déjà un livrable, il rend C2 visible) ; 2 à 3 j couture sous seuil, en **deux implémentations qui doivent produire le même graphe** ; 1 à 2 j fixtures de parité et verrous |
| **Risque déterminisme** | **ÉLEVÉ — le plus élevé des trois.** La couture décide **quels anneaux existent** : deux implémentations qui cousent dans un ordre différent, ou comparent le seuil différemment (`<` vs `≤`, distance carrée vs racine), ne produisent pas le même jeu de pièces — donc pas le même DXF canonique (J-090), donc pas le même seed, donc pas le même layout. `assemble.rs` porte déjà la règle « le test de fermeture se décide sur les points BRUTS, l'encre est stockée snappée » : toute couture nouvelle doit être spécifiée au même niveau de détail **avant** d'être écrite. Chantier à ne pas ouvrir sans spécification écrite du critère de couture, à verrouiller par `determinism_lock.py` **plus** un test de parité comptant les **anneaux**, pas seulement les sommets |
| **Ce qui reste non mesuré** | aucun fichier du corpus n'a de gap **connu** < 0,5 mm (`corpus.md` §Non-faits) : le seuil serait choisi sans distribution mesurée. Un histogramme des distances entre extrémités pendantes est un préalable de 0,5 j |

### R3 — C3 « entité écartée sans message » (14 / 85) + C9 « garde tardive » (2 / 85)

Les deux se réparent au même endroit et sans toucher à la géométrie — d'où
le regroupement, et d'où le rapport effort/valeur.

| | |
| --- | --- |
| **Fichiers touchés** | `app/composables/localImport.js` (`localRecordToUiFile` : recopier `warnings` — **une ligne** ; et déplacer le test `entity_count > 999` avant `import_file`, ce qui suppose un comptage bon marché exposé par le crate) · `workers/geometry/crates/nest-import/src/dxf/mod.rs` (exposer un `count_entities` sans assemblage) · `app/components/FileDone.vue` + `app/utils/i18n.js` (affichage FR/EN) · `workers/fileprocessing/core/main.py` (créer le champ côté serveur : il n'existe pas, seulement des `logger.warning`) |
| **Effort** | **1,5 j** — 0,5 j remontée + affichage (le wasm produit **déjà** la liste `warnings`, elle est déjà stockée en IndexedDB et jetée à la frontière UI) ; 0,5 j jumeau serveur ; 0,5 j garde précoce |
| **Risque déterminisme** | **nul** pour la partie message : aucune géométrie touchée, `warnings` est déjà produit et déjà stocké. **Faible** pour la garde précoce : un `count_entities` qui compterait autrement que l'import déplacerait le seuil de refus (999) sur les fichiers limites — le comptage doit être **le même code** que celui qui alimente `entity_count`, pas une seconde implémentation |
| **Pourquoi celle-ci d'abord, si le propriétaire n'en prend qu'une** | c'est la seule des trois qui **supprime du silence sans toucher à la géométrie** : effort le plus faible, risque nul sur le déterminisme, et elle rend C1, C2 et C3 **visibles** à l'utilisateur — donc mesurables en production avant d'engager R1 et R2 |

## 5. Non-faits — ce que ce document ne dit pas

1. **Le taux publié porte sur 4 fichiers.** Toute lecture de « 100 % » ou
   « 50 % » au-delà de l'ordre de grandeur est abusive.
   `specs/import-corpus/` n'existe toujours pas sur cette machine : aucun
   fichier d'entretien ou de prospect n'a été intégré, contrairement à ce
   que le §7 prévoyait.
2. **Les deux constats du lot C n'ont pas de fichier témoin conservé** : ni
   la fixture à gap 0,3 mm, ni le SVG à ~4,3 s. Ils sont repris comme
   constats du lot C — mécanisme vérifié dans le code pour le premier
   (§2.3), non rejouable pour le second (§2.7). **Les reproduire est un
   préalable du lot de réparation.**
3. **`openContours` est `null` sur les 85 JSON wasm**, et
   `openContoursClosed` sur les **170** : la colonne « contours ouverts »
   n'est **pas comparable** entre importeurs. Tout ce qui est chiffré en
   §2.3 vient du seul ezdxf. On ne compare pas du vide : on constate que le
   navigateur n'instrumente pas.
4. **`failingEntity` est `null` sur les 85 JSON ezdxf** : l'entité fautive
   demandée par le §1 du plan n'est connue que côté wasm (18 fichiers sur
   85 la portent). Le classement par entité fautive n'a donc qu'un
   importeur.
5. **Aucun import n'a été relancé pour ce lot.** Ce document joint et
   classe les JSON du commit `eaf11ff7` ; aucun docker, aucun build, aucun
   `npm` n'a été lancé. Les temps (`ms`) sont ceux mesurés aux lots B et C,
   **pas au repos** au sens de la discipline de mesure d'`AGENTS.md` : les
   comparer entre eux est légitime, en tirer un budget de perf ne l'est pas.
6. **Aucune cause n'est attribuée aux splines, aux blocs ni aux calques**
   (C5, C6). Ce n'est pas « ça marche » : c'est « aucun fichier du corpus ne
   les a mis en défaut », et le corpus contient 7 fichiers à splines et 16 à
   blocs, dont **un seul** cas d'INSERT imbriqué avec échelle et rotation
   vraiment lu (c36).
7. **Le DXF binaire n'est lu par aucun des deux importeurs** (c82, c83). Le
   refus wasm se fait **par extension** (`.dxfb`), là où `AGENTS.md` §2
   piège #31 impose la détection par signature de contenu — mais la règle
   vise le chemin Python, et renommer en `.dxf` ne l'aurait pas sauvé pour
   autant (ezdxf jette `Invalid group code "AutoCAD Binary DXF"`). **Non
   mesuré** : ce que donnerait le même fichier renommé `.dxf` côté
   navigateur.
8. **Les quantités de pièces ne sont pas vérifiées géométriquement.**
   `parts` est ce que l'importeur déclare. Personne n'a ouvert c04 pour
   confirmer que 169 pièces est le bon compte plutôt que 236, ni c03 pour
   dire lequel de 141 et 151 est juste. **L'écart est établi ; le vrai n'est
   pas tranché.**
