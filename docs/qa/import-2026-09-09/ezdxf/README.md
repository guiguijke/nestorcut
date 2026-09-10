# Résultats ezdxf — lot C (PLAN-IMPORT-2026-09-09 §3, grille §4)

Un JSON par fichier, produit par `scripts/qa-import-ezdxf.py` exécuté
**dans l'image docker fileprocessing** (ezdxf et shapely n'existent pas sur
le poste). Le script n'appelle que du code de production :
`dxf_utils.read_dxf_file` puis `core.geometry.build_geometry.build_geometry`,
dans l'ordre de `core/main.py`. Aucun fichier produit n'a été modifié.

## Commande

```bash
docker run --rm -i \
  -v "//c/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/.testparts:/data:ro" \
  -v "//c/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/docs/qa/import-2026-09-09/ezdxf:/out" \
  nest2d-file-processing-worker:dev \
  python - /data --out /out --version "$(git rev-parse --short HEAD)" \
  < scripts/qa-import-ezdxf.py 2>/dev/null
```

`--tolerance` vaut 0,01 par défaut : la valeur que le produit écrit dans
`flattening` à l'upload (`server/core/project/dxf.js`). Résumé sur stdout,
logs JSON de `worker_common` sur stderr.

## Sémantique des champs (à lire avant le lot D)

| champ | ce qui est réellement mesuré |
| --- | --- |
| `id` | radical du nom de fichier, assaini `[A-Za-z0-9._-]` — c'est la clé de jointure avec `corpus.md` et les JSON wasm |
| `status` | `read` = rien à réparer ; `repaired` = l'auditeur ezdxf a corrigé et/ou du linework est resté pendant et/ou une entité n'a pas pu être convertie ; `refused` = exception, document illisible, `Entity count is 0` ou `Closed parts is 0` (les deux messages exacts du worker) |
| `unitDeclared` | `$INSUNITS` du document **source** (0 = sans unité) ; `null` pour un SVG |
| `unitDetected` | nom de l'unité déduite du code. `unitless` (0) : la chaîne ezdxf traite alors le fichier **comme du mm** (`insunits_to_mm` rend 1,0) — ce n'est pas une détection, c'est un défaut |
| `scaleApplied` | facteur vers le mm canonique effectivement appliqué |
| `entities` | comptes par `dxftype()` du modelspace **source** (avant suppression des TEXT/MTEXT et avant explosion des blocs) |
| `parts` | pièces fermées retenues — exactement ce que le worker écrirait dans `polygonParts` (filtre bbox < 0,1 mm compris) |
| `holes` | somme des anneaux intérieurs de ces pièces |
| `openContours` | segments de linework restés **pendants** (`shapely.ops.polygonize_full` → `dangles`) après nodage : du trait qui n'a fermé aucune face. Ce n'est pas un compte d'entités `LINE` |
| `openContoursClosed` | **toujours `null`** : la chaîne ezdxf n'a pas d'étape de fermeture comptable (`GRID_SIZE = 1e-4` recolle des micro-jointures sans jamais les dénombrer) |
| `blocksFlattened` | nombre d'`INSERT` de premier niveau du modelspace source (`decompose_bounded` les résout récursivement — les INSERT imbriqués ne sont pas comptés séparément) |
| `splines` | nombre de `SPLINE` du modelspace source |
| `splinesHandled` | `sampled` si `splines > 0`, `null` sinon — la chaîne ezdxf ne refuse jamais un spline (`flattening(distance=tolérance)`) |
| `ms` | durée de l'import **de production** seul (conversion DWG + `read_dxf_file` + `build_geometry` + `to_mongo_dict`), instrumentation exclue |

## Champs à `null` par construction (non mesurables côté ezdxf)

- `openContoursClosed` — pas d'étape de fermeture comptable.
- `parts` / `holes` / `openContours` sur un refus antérieur à la
  polygonisation (`Entity count is 0`) : rien n'a été mesuré, `null` et non `0`.
- `unitDeclared` / `unitDetected` pour un SVG : il n'y a pas de `$INSUNITS`
  (svgelements normalise en px CSS 96 dpi, puis mm).

## Formats non-DXF

Le coureur détecte le format **par signature de contenu**
(`core.format_detect`), comme le worker : un SVG passe par
`svg_bytes_to_drawing`, un DWG par `dwgread` puis `read_dxf_file` — le DXF
issu de la conversion devient alors la source mesurée (unités, entités,
auditeur).
