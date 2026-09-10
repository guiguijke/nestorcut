# Corpus d'import — lot A (2026-09-09)

Livrable du lot A de `docs/PLAN-IMPORT-2026-09-09.md` §3. **Rien n'a été
téléchargé** : le corpus est constitué de ce qui existait déjà sur la
machine (dépôt, disque du propriétaire) et dans les images docker.

- Fichiers : **85** (cible >= 30) — tous des DXF.
- Familles couvertes avec au moins 3 fichiers : **8 / 8** (cible >= 6).
- Emplacement : `.testparts/corpus/`, nommés `<id>__<nom d'origine>`.
- Assemblage reproductible : `scripts/qa-import-corpus-build.sh`.
- Mesures : `scripts/qa-import-corpus-inventory.py` (ezdxf 1.4.4 dans
  l'image `nest2d-file-processing-worker:dev`), sortie brute dans
  `corpus-inventory.json` ; ce tableau en est dérivé par
  `scripts/qa-import-corpus-report.py`.

## Familles et règle d'affectation

Les familles sont **déduites des compteurs mesurés**, pas déclarées à la
main. Un fichier peut appartenir à plusieurs familles.

| Code | Famille (§3 lot A) | Règle mesurée | Fichiers |
| --- | --- | --- | ---: |
| F1 | exports CAO propres (boucle fermée, arcs/bulges) | au moins 1 boucle fermée (LWPOLYLINE/POLYLINE fermée, CIRCLE, ELLIPSE) et 0 SPLINE, 0 texte, 0 cote | 46 |
| F2 | splines | au moins 1 SPLINE (modelspace ou blocs) | 10 |
| F3 | contours ouverts / primitives éparses à recoudre | au moins 1 polyligne non fermée, ou au moins 1 LINE/ARC en modelspace (primitives éparses à recoudre en contour) | 36 |
| F4 | blocs / INSERT (imbriqués, échelle, rotation) | au moins 1 INSERT en modelspace, ou au moins 1 définition de bloc | 24 |
| F5 | textes, cotes, calques parasites | au moins 1 TEXT/MTEXT/ATTDEF/ATTRIB, ou 1 DIMENSION/LEADER/TOLERANCE, ou plus de 3 calques | 28 |
| F6 | unités douteuses ($INSUNITS absent, 0, 7, ou != mm) | $INSUNITS absent, 0, 7, ou différent de 4 (mm) | 33 |
| F7 | trous imbriqués / pièces multiples par fichier | au moins 2 boucles fermées dans le même fichier | 40 |
| F8 | versions DXF anciennes (<= R12) et binaires | DXF binaire, ou $ACADVER <= AC1009 (R12), ou fichier illisible par ezdxf | 15 |

**Limite énoncée** : F3 mesure la *présence* de contours ouverts ou de
primitives éparses, **pas** le critère « gap < 0,5 mm » du plan —
mesurer le gap exige de recoudre la géométrie, ce que font les
importeurs des lots B et C. C'est là qu'il sera chiffré, pas ici.

## Tableau du corpus

| id | nom | SHA-256 | provenance | licence | famille(s) | version DXF | taille |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| c01 | `Piece_Trou.DXF` | `41dd27aafe572abfd19abb999b9ec4120173fecaf3c55223ade92a2e56709180` | Propriétaire — fixtures historiques `.testparts/` du dépôt (export CAO R2000) | Propriétaire, non redistribué | F1 F3 | R2000 (AC1015) | 19.9 Kio |
| c02 | `Piece_Fillx4.DXF` | `0e21824cb9eddd05222d1ebf43cc4c0823af4cb86b5d0573ff4fe1a1fc75f9f7` | Propriétaire — fixtures historiques `.testparts/` du dépôt (export CAO R2000) | Propriétaire, non redistribué | F3 | R2000 (AC1015) | 19.8 Kio |
| c03 | `MARK_TOP_FACE.DXF` | `8017d697867796944be81cb8f21efa26a251880be6915b4670357cd17f623b4d` | Propriétaire — `Projects/SmartTHC/Premium_Documentation/SmartTHC Case` (découpe/marquage réels) | Propriétaire, non redistribué | F1 F3 F7 | R2000 (AC1015) | 534.4 Kio |
| c04 | `Top_Face_Marking_Final.dxf` | `ad0f2828fe1288e6be3cb2bb0012abb4713e7896ffedf640823921e839f6da12` | Propriétaire — `Projects/SmartTHC/Premium_Documentation/SmartTHC Case` (découpe/marquage réels) | Propriétaire, non redistribué | F1 F5 F6 F7 F8 | R11/R12 (AC1009) | 707.3 Kio |
| c05 | `_src_simple.dxf` | `f9f8fa079f2896bc5491d306823902637b20b1e3760332a45dff04b38c841d16` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F6 | R2013 (AC1027) | 18.1 Kio |
| c06 | `_src_holed.dxf` | `ebd7001c1aaad9f1f0236244d61a9c446a1b93014a07181454c68e739b2db8b7` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F6 F7 | R2013 (AC1027) | 18.3 Kio |
| c07 | `_src_multi.dxf` | `a538fed937acca01c4ac806efa8f073f22ba9e67bcc92f4113d76fd5711de277` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F6 F7 | R2013 (AC1027) | 18.4 Kio |
| c08 | `cam_1_piece_simple.dxf` | `3a2c6dcdb9f7dc748b6d509a4be96252e81b7a3b316337db45b9d4a472808d5a` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F5 F7 | R2013 (AC1027) | 899 o |
| c09 | `cam_2_piece_trous.dxf` | `045eaa7cdf4bb2e09460129f32b9a99d5c39b731f560768b3e5d6b236eaa37bc` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F5 F7 | R2013 (AC1027) | 1021 o |
| c10 | `cam_3_multi_rotations_mm.dxf` | `9c51371c2670da605f4c37a6fe6f95d9b71dd02ce761b424e3c2dec7ca2fb9a0` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F5 F7 | R2013 (AC1027) | 1.1 Kio |
| c11 | `cam_4_multi_rotations_inch.dxf` | `bce7def8f934a1fdd51a835fb86841245fdd820f32cea051f75885cd163355be` | Dépôt NestorCut — `docs/cam-validation/` (entrées `_src_*` et sorties `cam_*` de la validation CAM) | Projet NestorCut | F1 F5 F6 F7 | R2013 (AC1027) | 1.3 Kio |
| c12 | `marine_lpl_001.dxf` | `1e168c045e9f44812e9ab7088d46c6e8fa49b12c1559ebd4fce2317879d6fea4` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.1 Kio |
| c13 | `marine_lpl_002.dxf` | `7ea7cb984249197a25b9bf72552fc54b5dc188320134f8f0dc50eb31c10cea72` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.0 Kio |
| c14 | `marine_lpl_003.dxf` | `beec59e0e23895c93965ade3e63b0f9bb6eaddcb0e422e839aad6d38dc3b12ef` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.2 Kio |
| c15 | `marine_lpl_004.dxf` | `2873c507db6f8f6d04c9ed031cd4ee6fca3fba20d56f73733d671e2e6d3d984f` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.5 Kio |
| c16 | `marine_lpl_005.dxf` | `ca03f3742a9230d163b94b65e076d87edf2ee989f585d838632d7a1d0216e3d5` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.1 Kio |
| c17 | `marine_lpl_006.dxf` | `e63a6e545a349fd09d7da80a006082fb82db1ec701ca9aa2b32ec6067ca6d351` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.1 Kio |
| c18 | `marine_lpl_007.dxf` | `6cd3ecd2122574c744e77c0d04fe03c45c879cfb1a6bb2fef947dceb2f8119da` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.2 Kio |
| c19 | `marine_lpl_008.dxf` | `82e913da6959e9f9640bf2eb677cb3fe4b0ae78fcce66411677314028c4ece99` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F3 | R2010 (AC1024) | 18.4 Kio |
| c20 | `marine_lpl_009.dxf` | `9bf1b55e1521e6e301d3c6e87425f3f100e1394ab7ca4b43a2c74cb11da5fac9` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F3 | R2010 (AC1024) | 18.2 Kio |
| c21 | `marine_lpl_010.dxf` | `e6deed411100f256d23436c0f86fb77ead3ba0b4a5f37c69b7a3270c86d823ae` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.1 Kio |
| c22 | `marine_lpl_011.dxf` | `ffecca01c685fabd6c05bfccf48d3ec09d65a9af3e5d217f7a83e6066cdd7a00` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F3 | R2010 (AC1024) | 18.3 Kio |
| c23 | `marine_lpl_012.dxf` | `dd93916dedd83609d2cce3519d540b9028b98c3fab2889ea2297f8055da9d71e` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.5 Kio |
| c24 | `marine_lpl_013.dxf` | `bd4982c923e9bc699a199de415818141fbaca876aa58873355b3c5c40ca18735` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F3 F7 | R2010 (AC1024) | 18.8 Kio |
| c25 | `marine_lpl_014.dxf` | `d3fe012a3cdbcbfec71a9c1681d099eab566256c67cc028e95fe7d69d4351538` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F3 | R2010 (AC1024) | 18.5 Kio |
| c26 | `marine_lpl_015.dxf` | `274c6dc3b94d7f6c57d1d995cade602c3807fd68d54f2337429c8ce75fc9aad2` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F3 | R2010 (AC1024) | 18.5 Kio |
| c27 | `marine_lpl_016.dxf` | `9170601e1fe983d606e2bb993b71a086d3445d53cb6e333e91847fb69d9981f0` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.5 Kio |
| c28 | `marine_lpl_017.dxf` | `330665cca7e8dbbcc1cfa77b5290a2fa973a83f9ee2a9c775295e100eefc5f6b` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.5 Kio |
| c29 | `marine_lpl_018.dxf` | `96abdd6ff1083f53ee079d135a597417e8c9d8dc9529cb4baa53e7732904ca05` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.5 Kio |
| c30 | `marine_lpl_019.dxf` | `d636cd4ba88b8873067cc49c0f7feb2c17e26c768734f376792d2849498dafc5` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.0 Kio |
| c31 | `marine_lpl_020.dxf` | `15f5791b96f222ddeb54d777b036e4ba736adbda062b6affb92178710ea9fee0` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.6 Kio |
| c32 | `marine_lpl_021.dxf` | `3cef87485530a1d2e12d235838973dbf171de35dc9cae00996ed9f93ff1c8cde` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.2 Kio |
| c33 | `marine_lpl_022.dxf` | `1a3521316446502522baf89a74df7b39593eddaa5719e4c7321c6d82971b0c8f` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.7 Kio |
| c34 | `marine_lpl_023.dxf` | `8321af42a6c46929889666a57c2499aedf6b020cc3f10a0d1d32163f3526e33d` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F3 | R2010 (AC1024) | 18.5 Kio |
| c35 | `marine_lpl_024.dxf` | `b22faa8f49aef8dbb4e28437156d99e2329d27a283d6a9b15b230bad4bba71e5` | Dépôt NestorCut — `server/seed/demo/`, généré par `scripts/generate_demo_dxf.py` (ezdxf) ; corpus de la démo produit | Projet NestorCut | F1 | R2010 (AC1024) | 18.2 Kio |
| c36 | `blocks_nested.dxf` | `c20c73b72b9601097af3f6f50918bee49105fdd4b607a7047bbfc7f73b06f543` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F4 F7 | R2010 (AC1024) | 19.2 Kio |
| c37 | `bulge_ignored.dxf` | `6c9261d9eb735448a6b10c23eb2780303830d8beb829e47887f1c74814af133c` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 | R2010 (AC1024) | 18.1 Kio |
| c38 | `chan_edge_close.dxf` | `44fa8609da224d9488bdbe4b98b7b159c5e882c15efc2adc25bd75cc4c7d137d` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.2 Kio |
| c39 | `chan_ornate.dxf` | `891ec821f25c0cdc23f89ddb75ff80ce4eabc766b973ee485b13418a83fba0d8` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.3 Kio |
| c40 | `chan_tiny_hole.dxf` | `4cb8c277995457bd717339c8941c9a8eabcc935d9f0537b06443e0871ef0028d` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.2 Kio |
| c41 | `curves_closed.dxf` | `d90e5084eaa126b6dfa1ca3318adfd36804e94eaf22f9236b6d93c1d8546b3c1` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F2 | R2010 (AC1024) | 18.7 Kio |
| c42 | `curves_mix.dxf` | `979a0cd71ee68fb56e7cf5ec955bf1d7a9d1b53956eda4cde86d906eac39ea3f` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F2 F3 | R2010 (AC1024) | 18.5 Kio |
| c43 | `empty.dxf` | `c5172dc7d83c5b937964bf776d79aeee183a38cc4abd5a70d1979773d8e12f25` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | — | R2010 (AC1024) | 17.9 Kio |
| c44 | `hatch_pattern.dxf` | `c95ea3e75f636c6038dcb72b8cccc89cd5401a9375f2ef60225eb05cef43f0c2` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 | R2010 (AC1024) | 18.5 Kio |
| c45 | `hatch_solid.dxf` | `01fbbee0a8856e48adc9ae495df0f5096cba371fba7874f2bb854d3b69d17c67` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 | R2010 (AC1024) | 18.4 Kio |
| c46 | `legacy_polyline.dxf` | `24a2db28f81de166e353dc3812dae16e74507a518be0d60a2f656e599deffd3a` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 | R2010 (AC1024) | 18.6 Kio |
| c47 | `only_arc.dxf` | `bbe66deb969bcccfc3b9b306f97fdda9b65e3c11f6fd2d34a29b256045148bb7` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F3 | R2010 (AC1024) | 18.0 Kio |
| c48 | `only_ellipse.dxf` | `0c24bc5a73f06d130760f9e777e9cd18fcd067b4916ffea31f033eb2fd2747d9` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 | R2010 (AC1024) | 18.1 Kio |
| c49 | `only_spline.dxf` | `bdff20c5bff4f8c9446a3edaeacf78c1dc8ac2b4226109477028c6ddf891bc84` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F2 | R2010 (AC1024) | 18.1 Kio |
| c50 | `stress_open_curves.dxf` | `7aa56c9097b939ab1559ac7369a9c69ab45db6e81721476795cca45accde4725` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F2 F3 | R2010 (AC1024) | 18.5 Kio |
| c51 | `text_only.dxf` | `3cd5a98f8b0f9bc29cf5fb07e0aad55d28e94f8b957c0937205f280bf38d4846` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F5 | R2010 (AC1024) | 18.0 Kio |
| c52 | `two_parts.dxf` | `d5c6066ac20ed5c47868b6a647d5eb22d53cac9558d3dda5f2d208e463b88fa6` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F7 | R2010 (AC1024) | 18.2 Kio |
| c53 | `units_cm.dxf` | `ca18a5b73892c2eb17db543f2e234e61ff543bffebaac18ccc553deec4a26840` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c54 | `units_ft.dxf` | `c8795d43f225c8f270672991ae75aa578f179a434fd6def181049b5d46edf08b` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c55 | `units_in.dxf` | `1de53a989aede7ab6fe51d542d55a0eb108e89bfe9b7567357b9205fee6929ab` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c56 | `units_m.dxf` | `9640a5efb4448b1474789f60ac5a881378fea4d7a0de65bfd2020c58115cf0db` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c57 | `units_mil.dxf` | `f224e58e197aaec60942b3578a394a9dfc7711b5ca439fc9c6a4f8965a5b380a` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c58 | `units_none.dxf` | `21be69704aba5bfa5ab2fbd3ede43aef533e5b434a2fa4506fcc94112c9c02cb` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c59 | `units_unknown.dxf` | `8ed9580c49137916ab68ce7a6b3ed9c3f4f20d0cb93b62c364a77b3d91affe72` | Dépôt NestorCut — `workers/geometry/parity/corpus_extra/`, généré par `workers/geometry/parity/build_corpus.py` (ezdxf) | Projet NestorCut | F1 F6 | R2010 (AC1024) | 18.1 Kio |
| c60 | `libredwg_r1.4_entities.dxf` | `c4576933ff91e7773541864dc66134cf95deb43b287a17953439cdbba54a372e` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F6 F8 | ? · illisible ezdxf | 1.5 Kio |
| c61 | `libredwg_r2.6_entities.dxf` | `f7446b4535de865d6881733c1cb9fe5076d41d653964c38020ef417a4239c367` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F8 | R2.60 (AC1003) | 6.3 Kio |
| c62 | `libredwg_r2.6_dim.dxf` | `1a224776631c313cbe06c9a29bc0b05c68e147e117ae8393229190ce09a13fd8` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F8 | R2.60 (AC1003) | 8.9 Kio |
| c63 | `libredwg_r2.10_entities.dxf` | `8bd045f9f3003f7511e20bbe64a83e0cfc6916758c89de080272fb4f66300a74` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F8 | R2.10 (AC2.10) | 4.1 Kio |
| c64 | `libredwg_r2.10_block.dxf` | `4079edb4685427148aa4572af51e756a3550b3b677b9b8541396424edfb3109e` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F4 F6 F8 | R2.10 (AC2.10) | 2.6 Kio |
| c65 | `libredwg_r9_entities.dxf` | `402496e4ce4d06a437ff80b332c4130eac63c7abecac2923ec0ec71292ea91a8` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 F8 | R9 (AC1004) | 6.6 Kio |
| c66 | `libredwg_r10_entities.dxf` | `b789330aed4a47914ccd4d2bc6d19f252456a7f00f0f3c85839cff6012c6ac50` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 F8 | R10 (AC1006) | 8.0 Kio |
| c67 | `libredwg_r10_tmp_line.dxf` | `1cbff2c6bb12aac797e962df33af7b86d84d7975e7bd9258c732d66514d99ead` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F4 F6 F8 | R10 (AC1006) | 4.4 Kio |
| c68 | `libredwg_r11_entities-2d.dxf` | `b117265132358935916e646f7affadb43875afc4b17df079f9637afcbc725147` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F8 | R11/R12 (AC1009) | 8.4 Kio |
| c69 | `libredwg_r11_entities-3d.dxf` | `cfca439249194ee96eed1186f6b77852123d62766a4c7b50525a1bdf134343b8` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F8 | R11/R12 (AC1009) | 8.5 Kio |
| c70 | `libredwg_r12_Leader.dxf` | `9d3ff6a3651915ef851bd4a29910dfbdac566260e52df53c7ac6000b20256cc2` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F8 | R11/R12 (AC1009) | 20.3 Kio |
| c71 | `libredwg_r13_v.dxf` | `86531656820742506d5964333c3a82d4554e649174ee67877b3f876f252aa0a1` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 | R13 (AC1012) | 12.4 Kio |
| c72 | `libredwg_r14_Leader.dxf` | `dc9e77c88cfe0b6b234e4eb051419b1d1b33bc105771048e9163ce562d3aed87` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 | R14 (AC1014) | 91.0 Kio |
| c73 | `libredwg_example_r12.dxf` | `89461b11cb6c683f535d208c135aeaa22a844ac628565907a8572208a92d5aa1` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 F8 | R11/R12 (AC1009) | 694.5 Kio |
| c74 | `libredwg_example_r13.dxf` | `a17dba732c61f7fd4a413a934be22c6a098fb58f9e8991d225426957efa96350` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F2 F3 F4 F5 F6 F7 | R13 (AC1012) | 1.2 Mio |
| c75 | `libredwg_example_r14.dxf` | `acf76e9189c6e19ef00f2eaacd34691935caec162ecfbf0e0685df21d9999ebf` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F2 F3 F4 F5 F6 F7 | R14 (AC1014) | 562.0 Kio |
| c76 | `libredwg_sample_r14.dxf` | `5a735ce3f83328e8571a5d2007da4933310ade5d20acc23d01dd35d3c93533e8` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 | R14 (AC1014) | 37.4 Kio |
| c77 | `libredwg_2000_PolyLine2D.dxf` | `e74f03a383593ef96d5a349618390a393e8c5697e253014d4218fd40e3f37250` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F1 F3 F4 | R2000 (AC1015) | 195.6 Kio |
| c78 | `libredwg_2000_TS1.dxf` | `b94b9ff97699babd1b8ac1a0a99d7bd4c74a2713df4b9b4251852d31b441cb21` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F2 F3 F4 F5 F6 F7 | R2000 (AC1015) | 1.0 Mio |
| c79 | `libredwg_2010_gh209_1.dxf` | `e1df4235b1f156ad1210cb32b3752952c4d677e1401e617d33cfbb637495e718` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 | R2010 (AC1024) | 266.4 Kio |
| c80 | `libredwg_2013_gh109_1.dxf` | `63da24f0c3a4fdd95e8e02b6402a3e5749fcc778d1fb226e1c39c0f56ea3397e` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F4 F5 F6 F7 | R2013 (AC1027) | 411.6 Kio |
| c81 | `libredwg_2018_Dynblocks.dxf` | `3320aac4a5b8128d58f9a7a28d013c6d06b1f7785d00884a7c952b58afdb13cc` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F2 F3 F4 F5 F6 F7 | R2018 (AC1032) | 9.8 Mio |
| c82 | `libredwg_example_2000.dxfb` | `6630c1c66c5b071374107a4fda46d686d5daedcb275e351878229cdb40870b5b` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F2 F3 F4 F5 F7 F8 | R2000 (AC1015) · binaire | 903.9 Kio |
| c83 | `libredwg_example_2018.dxfb` | `55505256328ff9bf50f7d12c994575ffb89d4085b9c49a1cc57f1fae6dcfdd82` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F2 F3 F4 F5 F7 F8 | R2018 (AC1032) · binaire | 63.7 Kio |
| c84 | `libredwg_sample_2000.dxf` | `4b81b4de8331c808495b1ea42754986207a4e16256750d334dd54f96b9762feb` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F5 F7 | R2000 (AC1015) | 209.2 Kio |
| c85 | `libredwg_sample_2018.dxf` | `9618b5cef57867bee4c5b23898e653f0c5f2ba04c0ec729eb3dec73bb7175410` | GNU LibreDWG — `test/test-data/`, embarqué dans l'image docker `nest2d-file-processing-worker:dev` (`/opt/libredwg-src`) | GPL v3 (suite de tests LibreDWG), non redistribué | F3 F5 F7 | R2018 (AC1032) | 86.9 Kio |

## Détail mesuré

Compteurs ezdxf par fichier (modelspace + définitions de blocs pour les
splines, textes, cotes ; « boucles fermées » = polylignes fermées +
CIRCLE + ELLIPSE).

| id | $INSUNITS | boucles fermées | polylignes ouvertes | sommets bulge | SPLINE | textes | cotes | calques | blocs | INSERT msp | INSERT imbriqués | INSERT échelle | INSERT rotation | lecteur ezdxf |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| c01 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c02 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c03 | 4 (mm) | 4 | 200 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c04 | absent | 236 | 0 | 12 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | readfile |
| c05 | 6 (m) | 1 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c06 | 6 (m) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c07 | 6 (m) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c08 | 4 (mm) | 3 | 0 | 1 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | readfile |
| c09 | 4 (mm) | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | readfile |
| c10 | 4 (mm) | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | readfile |
| c11 | 1 (in) | 4 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | readfile |
| c12 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c13 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c14 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c15 | 4 (mm) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c16 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c17 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c18 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c19 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c20 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c21 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c22 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c23 | 4 (mm) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c24 | 4 (mm) | 2 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c25 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c26 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c27 | 4 (mm) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c28 | 4 (mm) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c29 | 4 (mm) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c30 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c31 | 4 (mm) | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c32 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c33 | 4 (mm) | 6 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c34 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c35 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c36 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 2 | 1 | 0 | 0 | readfile |
| c37 | 4 (mm) | 1 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c38 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c39 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c40 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c41 | 4 (mm) | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c42 | 4 (mm) | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c43 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c44 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c45 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c46 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c47 | 4 (mm) | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c48 | 4 (mm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c49 | 4 (mm) | 0 | 0 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c50 | 4 (mm) | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c51 | 4 (mm) | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c52 | 4 (mm) | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c53 | 5 (cm) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c54 | 2 (ft) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c55 | 1 (in) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c56 | 6 (m) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c57 | 9 (mil) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c58 | 0 (unitless) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c59 | 7 (km) | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | readfile |
| c60 | absent | 0 | 0 | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 | échec |
| c61 | absent | 1 | 1 | 0 | 0 | 3 | 1 | 2 | 3 | 2 | 0 | 2 | 2 | readfile |
| c62 | absent | 1 | 0 | 0 | 0 | 4 | 5 | 2 | 5 | 0 | 0 | 0 | 0 | readfile |
| c63 | absent | 1 | 1 | 0 | 0 | 3 | 0 | 2 | 2 | 2 | 0 | 2 | 2 | readfile |
| c64 | absent | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 0 | readfile |
| c65 | absent | 2 | 1 | 0 | 0 | 3 | 1 | 2 | 3 | 2 | 0 | 2 | 2 | readfile |
| c66 | absent | 2 | 1 | 0 | 0 | 3 | 1 | 2 | 3 | 2 | 0 | 2 | 2 | readfile |
| c67 | absent | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 1 | 0 | 1 | 1 | readfile |
| c68 | absent | 1 | 1 | 0 | 0 | 3 | 1 | 2 | 3 | 2 | 0 | 2 | 2 | readfile |
| c69 | absent | 1 | 1 | 0 | 0 | 3 | 1 | 2 | 3 | 2 | 0 | 2 | 2 | readfile |
| c70 | absent | 1 | 2 | 0 | 0 | 2 | 0 | 2 | 4 | 3 | 0 | 0 | 0 | readfile |
| c71 | absent | 11 | 4 | 4 | 0 | 2 | 0 | 6 | 22 | 0 | 0 | 0 | 0 | readfile |
| c72 | absent | 13 | 3 | 4 | 0 | 2 | 2 | 2 | 22 | 0 | 0 | 0 | 0 | readfile |
| c73 | absent | 12 | 6 | 3660 | 0 | 35 | 9 | 5 | 38 | 19 | 10 | 1 | 1 | readfile |
| c74 | absent | 36 | 8 | 7324 | 4 | 30 | 20 | 5 | 38 | 14 | 1 | 1 | 1 | readfile |
| c75 | absent | 24 | 6 | 3664 | 2 | 24 | 10 | 5 | 36 | 12 | 0 | 1 | 1 | readfile |
| c76 | absent | 15 | 4 | 4 | 0 | 2 | 0 | 3 | 22 | 0 | 0 | 0 | 0 | readfile |
| c77 | 4 (mm) | 1 | 1 | 2 | 0 | 0 | 0 | 2 | 3 | 0 | 0 | 0 | 0 | readfile |
| c78 | 1 (in) | 5 | 2 | 0 | 1 | 12 | 7 | 3 | 8 | 1 | 0 | 0 | 0 | readfile |
| c79 | 6 (m) | 3 | 1 | 0 | 0 | 4 | 0 | 6 | 2 | 3 | 0 | 0 | 0 | readfile |
| c80 | 0 (unitless) | 14 | 2 | 8 | 0 | 18 | 14 | 27 | 23 | 1 | 14 | 0 | 0 | readfile |
| c81 | 1 (in) | 581 | 299 | 592 | 12 | 95 | 30 | 69 | 133 | 43 | 75 | 3 | 4 | readfile |
| c82 | 4 (mm) | 13 | 2 | 3660 | 2 | 23 | 12 | 5 | 13 | 10 | 0 | 1 | 1 | readfile |
| c83 | 4 (mm) | 10 | 1 | 25 | 1 | 5 | 0 | 4 | 2 | 9 | 0 | 0 | 0 | readfile |
| c84 | 4 (mm) | 2 | 0 | 0 | 0 | 1 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | readfile |
| c85 | 4 (mm) | 2 | 0 | 0 | 0 | 1 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | readfile |

## Redistribution

Les fichiers **ne sont pas versionnés** : ils vivent dans
`.testparts/corpus/`. Deux raisons distinctes :

- c01–c04 : fichiers du propriétaire, pas de licence de publication ;
- c60–c85 : suite de tests GNU LibreDWG, GPL v3 — on ne recopie pas du
  GPL dans un dépôt propriétaire ; ils sont extraits à la demande de
  l'image docker par `scripts/qa-import-corpus-build.sh`.

Ce document ne publie donc que **hash + provenance + licence**, comme
l'exige `docs/PLAN-IMPORT-2026-09-09.md` §2.

**Attention** : `.testparts/` n'est PAS dans `.gitignore` (vérifié :
`git check-ignore` ne le retient pas, `git status` l'affiche en `??`).
Ne pas faire `git add -A` tant que ce n'est pas corrigé.

## Ce qui manque

Les seuils du plan sont atteints : 85 fichiers (cible 30), 8 familles
sur 8 couvertes avec au moins 3 fichiers (cible 6). Ce qui manque est
**qualitatif**, et il faut le dire :

### 1. Des fichiers vraiment tiers

Origine réelle des 85 fichiers :

- propriétaire (flux CAO réel) : **4**
- démo produit (généré ezdxf) : **24**
- fixtures de parité (généré ezdxf) : **24**
- validation CAM du dépôt : **7**
- suite de tests GNU LibreDWG : **26**

Autrement dit : **4 fichiers seulement** (c01–c04) proviennent d'un flux
CAO réel du propriétaire ; 55 sont produits par le projet lui-même
(ezdxf, générateurs du dépôt) et 26 viennent d'une suite de tests
d'interopérabilité (fichiers AutoCAD authentiques, mais orientés
« couverture du format », pas tôlerie de découpe).

Un corpus « d'importeur » qui se mesure surtout sur des fichiers qu'il a
lui-même écrits mesure surtout sa propre boucle. **Zéro fichier client
ou prospect** : `specs/import-corpus/` (prévu par le plan §2) n'existe
pas sur cette machine, et les entretiens n'ont laissé aucun DXF ici.

Où en prendre :

- fichiers d'entretien / prospects du propriétaire (hors machine) —
  la source la plus utile, à déposer dans `specs/import-corpus/` ;
- corpus open-source de découpe laser (Thingiverse « laser cut »,
  Ponoko, dépôts CC0) — **nécessite un téléchargement**, non autorisé
  dans ce lot ;
- les `.dwg` de LibreDWG déjà présents dans l'image (chemin DWG du
  produit, hors périmètre DXF de ce lot).

### 2. Non-faits mesurés

- **F3 / gap < 0,5 mm** : aucun fichier dont l'écart d'un contour
  ouvert soit *connu* inférieur à 0,5 mm. F3 ne mesure ici que la
  présence de primitives à recoudre. À chiffrer aux lots B/C.
- **DXF binaires** : 2 seulement (c82 R2000, c83 R2018). Aucun binaire
  ancien (R12) : la suite LibreDWG n'en embarque pas.
- **ezdxf n'embarque aucun DXF d'exemple** dans le paquet pip : vérifié
  par `find / -iname '*.dxf'` dans l'image — les seuls DXF de l'image
  sont ceux de LibreDWG et les deux fixtures du dépôt. La source
  « dépôt ezdxf `examples/` » citée au plan §3 n'est donc pas
  disponible hors ligne.
- **Aucun DWG** dans ce corpus (lot A ne demande que du DXF).
- **Aucune mesure d'import** ici : ce lot inventorie, il n'importe pas.
  Les statuts read/repaired/refused sont le travail des lots B et C.

