# Rapport P4 — worker de finalisation navigateur — 2026-09-08

Fiche `docs/FICHE-LOT4-T2-2026-09-06.md` chantier B, masterplan §4 T2.
Hash : **`HASH_PENDING`**. Vitest **511/511**. Pas de déploiement
(attendre GO vérificateur). U3 n’a pas démarré.

## Livré

Post-pass BPP (grille multi-tôles, hole-fill, résiduel, SVG, DXF,
rapport) exécuté dans `app/workers/finalize.worker.js` (Vite
`new URL(..., import.meta.url)`). Même fonction
`assembleBrowserArtifacts` que le thread principal ; repli main si
Worker absent ou résultat vide. État `progress.stage.finalizing` /
« Finalisation… ». `layoutAabb` importé explicitement (plus d’auto-import
Nuxt dans le worker).

## Verrous

| Verrou | 0,1 | 2 |
|---|---|---|
| pièces | 900/900 | 900/900 |
| tôles grille | **[587, 313]** | **[573, 327]** |
| long task après solve | **52 ms** (< 100) | **74 ms** (< 100) |
| long task session | 64 ms | 74 ms |
| CLS | 0,0246 | 0,0194 |
| `check_svg_dir.py` | VERDICT OK (0 / 0) | VERDICT OK (0 / 0) |

Harnais : `QA_OUT=.qa-pw/e2e-local-p4-01d` et `.qa-pw/e2e-local-p4-2`.

## Non-faits

- Grille SPP (`buildGridAlternative` + mini-pools wasm) reste sur le
  thread principal (T-A du harnais est BPP).
- P5 / P6 / U3 : pas ouverts.
- Déploiement P4 : **non**.
