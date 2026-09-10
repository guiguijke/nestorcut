#!/usr/bin/env bash
# Lot A (docs/PLAN-IMPORT-2026-09-09.md §3) — assemblage du corpus d'import.
#
# Rassemble dans .testparts/corpus/ (gitignoré) les DXF déjà présents sur la
# machine ou dans les images docker. AUCUN téléchargement. Idempotent.
# Les fichiers sont nommés <id>__<nom d'origine> : l'id est le préfixe avant
# le double underscore, le nom d'origine est conservé pour la traçabilité.
#
# Sources (voir docs/qa/import-2026-09-09/corpus.md pour provenance/licence) :
#   - .testparts/                       (fichiers du propriétaire)
#   - C:/Users/.../Projects/SmartTHC    (fichiers du propriétaire)
#   - docs/cam-validation/              (dépôt, exports NestorCut)
#   - server/seed/demo/                 (dépôt, corpus de la démo, généré ezdxf)
#   - workers/geometry/parity/corpus_extra/ (dépôt, fixtures ezdxf synthétiques)
#   - image docker nest2d-file-processing-worker:dev,
#     /opt/libredwg-src/test/test-data  (suite de tests GNU LibreDWG, GPL v3)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/.testparts/corpus"
SMARTTHC="C:/Users/guiguijke/OneDrive/Projects/SmartTHC/Premium_Documentation/SmartTHC Case"
IMAGE="${FP_IMAGE:-nest2d-file-processing-worker:dev}"

rm -rf "$OUT"; mkdir -p "$OUT"

n=0
put() {  # put <chemin source> [nom d'origine]
  n=$((n+1)); id=$(printf 'c%02d' "$n")
  base="${2:-$(basename "$1")}"
  cp "$1" "$OUT/${id}__${base}"
}

# --- fichiers du propriétaire (vraies exports CAO)
put "$REPO/.testparts/Piece_Trou.DXF"
put "$REPO/.testparts/Piece_Fillx4.DXF"
put "$SMARTTHC/MARK TOP FACE.DXF"          "MARK_TOP_FACE.DXF"
put "$SMARTTHC/Top Face Marking Final.dxf" "Top_Face_Marking_Final.dxf"

# --- exports / entrées de la validation CAM du dépôt
for f in _src_simple _src_holed _src_multi \
         cam_1_piece_simple cam_2_piece_trous \
         cam_3_multi_rotations_mm cam_4_multi_rotations_inch; do
  put "$REPO/docs/cam-validation/$f.dxf"
done

# --- corpus de la démo produit (24 pièces de tôlerie marine)
for f in "$REPO"/server/seed/demo/marine_lpl_*.dxf; do put "$f"; done

# --- fixtures de parité (générées par workers/geometry/parity/build_corpus.py)
for f in "$REPO"/workers/geometry/parity/corpus_extra/*.dxf; do put "$f"; done

# --- suite de tests GNU LibreDWG, extraite de l'image docker
TMP="$(mktemp -d)"
docker run --rm "$IMAGE" sh -lc 'cd /opt/libredwg-src/test/test-data && tar cf - \
  r1.4/entities.dxf r2.6/entities.dxf r2.6/dim.dxf r2.10/entities.dxf \
  r2.10/block.dxf r9/entities.dxf r10/entities.dxf r10/tmp_line.dxf \
  r11/entities-2d.dxf r11/entities-3d.dxf r12/Leader.dxf r13/v.dxf \
  r14/Leader.dxf example_r12.dxf example_r13.dxf example_r14.dxf \
  sample_r14.dxf 2000/PolyLine2D.dxf 2000/TS1.dxf 2010/gh209_1.dxf \
  2013/gh109_1.dxf 2018/Dynblocks.dxf example_2000.dxfb example_2018.dxfb \
  sample_2000.dxf sample_2018.dxf' | tar xf - -C "$TMP"

for rel in r1.4/entities.dxf r2.6/entities.dxf r2.6/dim.dxf r2.10/entities.dxf \
           r2.10/block.dxf r9/entities.dxf r10/entities.dxf r10/tmp_line.dxf \
           r11/entities-2d.dxf r11/entities-3d.dxf r12/Leader.dxf r13/v.dxf \
           r14/Leader.dxf example_r12.dxf example_r13.dxf example_r14.dxf \
           sample_r14.dxf 2000/PolyLine2D.dxf 2000/TS1.dxf 2010/gh209_1.dxf \
           2013/gh109_1.dxf 2018/Dynblocks.dxf example_2000.dxfb \
           example_2018.dxfb sample_2000.dxf sample_2018.dxf; do
  put "$TMP/$rel" "libredwg_$(echo "$rel" | tr '/' '_')"
done
rm -rf "$TMP"

echo "corpus: $n fichiers dans $OUT"
