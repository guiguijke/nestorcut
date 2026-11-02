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
| [`../doc/encryption-premium.spec.md`](../doc/encryption-premium.spec.md) | Coffre zero-knowledge (fichier-clé), livré en opt-in sur tous les plans : référence crypto et cycle de vie (hors `docs/`) |

## Pilotage (en cours)

| Fichier | Contenu |
|---|---|
| [`MASTERPLAN-2026-09-05.md`](MASTERPLAN-2026-09-05.md) | **Boussole** : la référence du nesting dans le navigateur (§0), séquenciation T0-T5, registre des décisions, forme des instructions à l'implémenteur (§8) |
| [`PLAN-UI-PRO-2026-09-07.md`](PLAN-UI-PRO-2026-09-07.md) | Interface « atelier » professionnelle : diagnostic D1-D10, direction unique, six lots U0-U5 avec verrous et sélecteurs QA à migrer |
| [`PLAN-IMPORT-2026-09-09.md`](PLAN-IMPORT-2026-09-09.md) | Phase C import (tête de T3) : corpus ≥ 30 DXF, coureurs wasm et ezdxf sur une grille JSON commune, classement des causes, spécification du rapport de réparation — lots A-E parallélisables, aucun code produit |
| [`RECETTE-PROPRIETAIRE-2026-09-14.md`](RECETTE-PROPRIETAIRE-2026-09-14.md) | Recette des priorités 3 et 4 en production, à faire par le propriétaire avant toute nouvelle feature |
| [`PLAN-coupe-commune.md`](PLAN-coupe-commune.md) | Coupe commune en grappes : dette d'abord (kerf explicite livré), lignes communes ensuite |

## Archives (cycles clos)

Les captures et sorties des campagnes archivées restent dans `qa/<campagne>/`.

| Dossier | Cycle | Issue |
|---|---|---|
| `archive/2026-07-moteur/` | Feuille de route des trous dans jagua-rs (28/07), plan warm-start et alternatives directionnelles du BPP (01/08) | Alternatives directionnelles (B) et plomberie warm-start (A2) implémentées ; séquence intercalée (A1) annulée après un A/B négatif. Les trous passent par le canal capillaire (`AGENTS.md` piège 2) ; la spec de support natif des trous dans jagua-rs n'a pas été implémentée |
| `archive/2026-08-audits/` | Audits du 29 et 31 août, plans A / P-Q, poids wasm PR2, Mode Local PR5 | Correctifs livrés (voir `AGENTS.md` §5) |
| `archive/2026-09-bpp/` | BPP : bandes résiduelles, poches, livraisons des 1er et 2 septembre | Déployé |
| `archive/2026-09-multitoles/` | Audit multi-tôles du 3 septembre, plans correctifs 1-4, infaisable & alternatives | Déployé |
| `archive/2026-09-perf-ux/` | Plan perf/UX en 6 lots, mesure P3, lots 1 → 3 (rapports, vérifications L1 → L3-bis), lot 4 (proposition, fiche, vérification de la phase A) | Lots 1-3 déployés en prod le 06/09 (T1 clos) ; lot 4 clos le 09/09, phase C livrée le 10/09 |
| `archive/2026-09-import-eclatement/` | Dernière tôle (lot 5-moteur, tranche 1) et éclatement des DXF en pièces unitaires (import avancé, lots E0-E4) | Dernière tôle : tranches 1, 1-bis, 1-ter, 2 et correctifs hole-fill déployés les 10-11/09 (règle vivante : `AGENTS.md` piège 54). Éclatement : E0-E4 déployés le 14/09, E4-e (enveloppe concave) gelé |
| `archive/2026-09-sheetcam-job/` | Étude du format `.job` SheetCam (lots J1-J11), audit UX du flux `.job` et lot J11, correctif de la vue DXF figée (H1), audit de bout en bout des priorités 3 et 4 | Livré : J11-ter GO le 16/09, H1 déployé le 14/09 (règle vivante : `AGENTS.md` piège 62), audit exécuté le 14/09 |
| `archive/2026-09-documentation-langues/` | Documentation dans le site vitrine (Starlight, lots D1-D5) et chantier des langues (pt-BR, it, de, es) | D1-D5 livrés (D5 fusionné le 16/09) ; langues closes le 23/09 (six langues, V0.9.7) |
| `archive/2026-09-reprise-lots-clos/` | Passation du 13/09, retrait du pipeline « strip », tags d'images (`promote-latest`), lot C1 « inscription », audit de licence du dépôt | Retrait « strip » (lot S, 13/09) et lot D1 livrés (`:latest` ne bouge que par `promote-latest`, `AGENTS.md` §6) ; C1 clos le 08/09 ; licence close le 08/09 (dépôt neuf à historique unique, PolyForm Noncommercial) ; §3-§5 de la passation périmés |
| `archive/2026-09-stabilisation/` | Retrait de la promesse e-mail (M2) et vague d'audit de stabilisation (AUD-1 à AUD-3) | M2, M2-bis, M3, M3-bis et M3-ter déployés (V0.9.8) ; AUD-1 à AUD-3 absorbés par le point global du 27/09 (privé), M4 déployé en V0.9.9 |

Convention de nommage : `AUDIT-`, `PLAN-`, `RAPPORT-` (implémenteur),
`PLAN-CORRECTIF-` (vérification + plan correctif du vérificateur),
`FICHE-`, `JALON-`, suffixe date `AAAA-MM-JJ`.

## Documents privés (hors dépôt)

`specs/` (gitignoré, jamais commité) : référence des décisions et documents internes. Pas de lien depuis ici.

| Fichier | Contenu |
|---|---|
| `specs/ROADMAP-V1-2026-11.md` | **Reste-à-faire V1** (état au 02/11/2026) : la feuille de route de la V1 |
| `specs/POINT-GLOBAL-2026-09-27.md` | Point global du 27/09 (vérificateur) : état de la production, audit, features restantes, décisions du propriétaire (§8, recopiées dans `specs/90-decisions.md`). Sorti du dépôt public le 02/11 |
| `specs/JALON-UTILISATEURS-T1-2026-09-06.md` | Guide d'entretiens et grille de décision du jalon utilisateurs. Sorti du dépôt public le 02/11 |
| `specs/90-decisions.md` | Journal chronologique des décisions du propriétaire |
| `specs/AUDIT-SECURITE-2026-09-27.md`, `specs/AUDIT-SECURITE-2026-10-25.md` | Constats de sécurité (le dépôt est public) |
| `specs/THREAT-MODEL.md`, `specs/CYBERSECURITY.md` | Promesses privacy exactes, posture pentest |
| `specs/infra/` | `stripe-go-live.md`, `DEPLOY-HETZNER.md`, adresses du homelab, procédure du dépôt neuf |

Les hashes de commits cités dans les documents antérieurs à la re-création du dépôt (2026-09)
renvoient au dépôt archivé privé.
