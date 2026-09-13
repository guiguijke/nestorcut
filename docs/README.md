# Documentation NestorCut — carte

Règle de rangement : la racine de `docs/` ne contient que les **documents
vivants** (référence ou pilotage en cours). Un cycle clos (audit → plan →
rapports → vérifications, une fois déployé) part dans
`archive/<année-mois-cycle>/` avec `git mv`, liens réécrits. Les captures
et sorties de QA restent dans `qa/<campagne>/`.

## Référence (vivante)

| Fichier | Contenu |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Topologie, flux, frontières, CI/CD, déploiement Hetzner + homelab |
| [`PIPELINE-MAP.md`](PIPELINE-MAP.md) | Cartographie du pipeline géométrique, parité natif/wasm |
| [`STRATEGY.md`](STRATEGY.md) | Tiers Free/Unlimited/Pro, privacy, roadmap, marqueurs `[prod]`/`[spéc]` |
| [`dwg-license.md`](dwg-license.md) | Licence et périmètre DWG |
| `cam-validation/` | Fiche de test CAM + DXF de validation |
| `upstream-wasm-proposal/` | Patches proposés en amont (jagua-rs, sparrow) |

## Pilotage (en cours)

| Fichier | Contenu |
|---|---|
| [`MASTERPLAN-2026-09-05.md`](MASTERPLAN-2026-09-05.md) | **Boussole** : la référence du nesting dans le navigateur (§0), séquenciation T0-T5, registre des décisions, forme des instructions à l'implémenteur (§8) |
| [`PLAN-PERF-UX-2026-09-05.md`](PLAN-PERF-UX-2026-09-05.md) | Plan perf/UX en 6 lots (lots 1-3 livrés, 4 en cours, 5-6 cadrés) |
| [`FICHE-LOT4-T2-2026-09-06.md`](FICHE-LOT4-T2-2026-09-06.md) | Lot 4 (T2) : verrous par chantier, décision Rust/Python, contrôles intermédiaires, recentrage navigateur |
| [`PLAN-CORRECTIF-PERF-UX-L4-PHASE-A-2026-09-07.md`](PLAN-CORRECTIF-PERF-UX-L4-PHASE-A-2026-09-07.md) | Vérification de la phase A du lot 4 (GO déploiement, verrou 15 s reporté en phase B, AI0-AI4) |
| [`PLAN-UI-PRO-2026-09-07.md`](PLAN-UI-PRO-2026-09-07.md) | Interface « atelier » professionnelle : diagnostic D1-D10, direction unique, six lots U0-U5 avec verrous et sélecteurs QA à migrer |
| [`RESTE-A-LIVRER-2026-09-10.html`](RESTE-A-LIVRER-2026-09-10.html) | Page de synthèse pour le propriétaire (10/09) : décisions en attente, chantiers restants par horizon avec effort à l'échelle, dette connue, clos — à ouvrir dans un navigateur |
| [`ETUDE-JOB-SHEETCAM-2026-09-11.md`](ETUDE-JOB-SHEETCAM-2026-09-11.md) | Nester directement un `.job` SheetCam : format décortiqué (INI + bloc binaire), neuf règles acquises par essais (pose = centre de boîte, angle horaire en radians, copies `copyOf`, ordre de coupe par `[OpOrder]`), flux produit et consigne de Phase 1 |
| [`PLAN-DERNIERE-TOLE-2026-09-09.md`](PLAN-DERNIERE-TOLE-2026-09-09.md) | Lot 5-moteur tranche 1 : la direction choisie s'applique à la tôle partielle — constat démo, cause à trois niveaux (coût SA sans direction, biais constructif faible, compaction −X), décision « SPP de la même direction dans le moteur », verrous L1-L6 |
| [`PLAN-RETRAIT-STRIP-2026-09-13.md`](PLAN-RETRAIT-STRIP-2026-09-13.md) | Retrait du pipeline « strip » (décision owner 13/09) : inventaire des références, consigne du lot S (sweep, retrait des services/routes/pages, données conservées, purge maintenue) |
| [`PLAN-ECLATEMENT-2026-09-12.md`](PLAN-ECLATEMENT-2026-09-12.md) | Priorité 1 (owner 12/09) : éclatement d'un DXF en pièces unitaires et mise à l'échelle à l'import (« import avancé »), et robustesse du moteur aux traits plus fins que l'espacement (diagnostic mesuré du « stopped unexpectedly », lots E0-E2) |
| [`PLAN-IMPORT-2026-09-09.md`](PLAN-IMPORT-2026-09-09.md) | Phase C import (tête de T3) : corpus ≥ 30 DXF, coureurs wasm et ezdxf sur une grille JSON commune, classement des causes, spécification du rapport de réparation — lots A-E parallélisables, aucun code produit |
| [`PLAN-COMPTE-INSCRIPTION-2026-09-07.md`](PLAN-COMPTE-INSCRIPTION-2026-09-07.md) | Lot C1 « inscription » : audit de la vérification d'e-mail (existante, à rendre visible), doublon d'e-mail administrateur (digest sans marqueur), newsletter proposée tous les 90 j — décisions D1-D8, périmètre fermé, verrous |
| [`AUDIT-LICENCE-DEPOT-2026-09-07.md`](AUDIT-LICENCE-DEPOT-2026-09-07.md) | Dépôt public : part héritée de nest2d mesurée, tiers (jagua MPL sans LICENSE vendorisé), documents internes exposés, options de licence non commerciale, instruction du lot L1 — décision propriétaire |
| [`JALON-UTILISATEURS-T1-2026-09-06.md`](JALON-UTILISATEURS-T1-2026-09-06.md) | Guide d'entretiens et grille de décision du jalon utilisateurs |
| [`PLAN-coupe-commune.md`](PLAN-coupe-commune.md) | Coupe commune en grappes : dette d'abord (kerf explicite livré), lignes communes ensuite |

## Archives (cycles clos)

| Dossier | Cycle | Issue |
|---|---|---|
| `archive/2026-08-audits/` | Audits du 29 et 31 août, plans A / P-Q, poids wasm PR2, Mode Local PR5 | Correctifs livrés (voir `AGENTS.md` §5) |
| `archive/2026-09-bpp/` | BPP : bandes résiduelles, poches, livraisons des 1er et 2 septembre | Déployé |
| `archive/2026-09-multitoles/` | Audit multi-tôles du 3 septembre, plans correctifs 1-4, infaisable & alternatives | Déployé |
| `archive/2026-09-perf-ux/` | Mesure P3, lots 1 → 3 (rapports, vérifications L1 → L3-bis), proposition du lot 4 | Déployé en prod le 06/09 (T1 clos) |

Convention de nommage : `AUDIT-`, `PLAN-`, `RAPPORT-` (implémenteur),
`PLAN-CORRECTIF-` (vérification + plan correctif du vérificateur),
`FICHE-`, `JALON-`, suffixe date `AAAA-MM-JJ`.

## Documents privés (hors dépôt)

`specs/` (gitignoré) : `THREAT-MODEL.md` (promesses privacy exactes),
`CYBERSECURITY.md` (posture pentest), `infra/stripe-go-live.md`,
`infra/DEPLOY-HETZNER.md`, adresses du homelab. Les hashes de commits
cités dans les documents antérieurs à la re-création du dépôt (2026-09)
renvoient au dépôt archivé privé.
