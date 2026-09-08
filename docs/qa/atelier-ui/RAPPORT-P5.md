# Rapport P5 — plateau SPP calibré (08/09)

Commits `14a1be2` (moteur + wasm) + `17cc863` (F5 SSR). **Pas déployé.**

## Moteur

Patience = max(2 s, 4 × (dernière − première amélioration)), cap = `plateau_patience_sec`.
Phase 2 démarre au plateau de la phase 1 (budget restant). `phase1_ratio` posé explicitement (retry_overshoot 0,98) garde le split historique.

- cargo test --release -p nest-engine : 75 pass + 1 ignore
- retry_overshoot --ignored : vert à vide (7,6 s)
- determinism_lock.py : natif ≡ wasm `f820cb5b8d812897d01f9748bae14f9d7e02ac11845bb3655a98c84d7d2f60a3`

## F5

`scripts/qa-e2e-f5-project.mjs` : GET `/project/:slug` avec session → URL tenue.
Cookies via `useRequestHeaders(['cookie'])` en setup ; IndexedDB skippé au SSR.

## Mono 300 wasm (100 Trou + 200 Fill, 1 tôle 1000×2000, space 0,1, –X)

| Tier | conc. | solveDoneAt (ms) | after-solve | CLS | usedShare | frontX grille | holesFilled left |
|---|---|---|---|---|---|---|---|
| standard | 4 | 12266 | 0 | 0,017 | 0,60006 (600,06 mm) | 600,6 | 200/200 |
| Free | 1 | 10061 | 54 | 0,019 | 0,60006 | 600,6 | 200/200 |

Référence 600,1 ± 0,5 mm : **tenue**. Cible 20–40 s : **sous 15 s** (mieux que la fourchette). Temps Free ≈ standard : settle idle champion SPP mono-classe.

Fichiers : `p5-300-std-cls.json`, `p5-300-std-longtasks.json`, `p5-300-free-cls.json`, `p5-300-free-longtasks.json`.

## Harnais T-A (inchangé, deux configurations)

| Space | placed | grille | after-solve | CLS |
|---|---|---|---|---|
| 0,1 | 900/900 | [587, 313] | 53 ms | 0,020 |
| 2 | 900/900 | [573, 327] | 72 ms | 0,025 |

Fichiers : `p5-ta-01-cls.json`, `p5-ta-01-longtasks.json`, `p5-ta-2-cls.json`, `p5-ta-2-longtasks.json`.
