# Rapport U2 — page projet — 2026-09-08

Plan `docs/PLAN-UI-PRO-2026-09-07.md` §U2 + retouche §7, puis
**passe GO partiel** (cinq retouches, commit unique).

Hash : **`e1c1ed0`** (`fix(ui): passe U2 GO partiel`).
Vitest **510/510**. Pas de déploiement U2 — GO visuel final requis.

## Passe GO partiel (cinq retouches)

### 1. Pluriels et aire

`pluralSelect` + `tp(base, n)` (`app/utils/i18n.js`, `useLocale`).
Compteur d’en-tête et carte pré-vol composés, jamais un gabarit
toujours-pluriel.

Mesuré sur Piece_Trou (1 fichier, 1 pièce, géométrie locale) :
- en-tête : `1 pièce · 1 fichier`
- pré-vol : `1 pièce · 1 fichier · 0.01 m² · ≈ 1 tôle à cet espacement · densité max ≈ 85 %`
- CTA : `Imbriquer 1 pièce` + sous-ligne `≈ 1 tôle · Cloud · 24 h`

L’aire (`project.preflightArea`) n’est poussée que si
`report.totalInflatedMm2 > 0` — jamais « — m² ».

### 2. Rotations

`InputField` des rotations : `v-if="rotationSeg === 'other'"`.
Sur 1 · 2 · 4 · 8 le champ numérique n’existe pas. Harnais : clic
`.rotations__seg [role="radio"]` texte `^4$`, repli sur l’ancien
`label.input` Rotations.

### 3. Cartes résultat

Plus de rectangle gris sans vignette (échec / autre appareil /
purgé). Rangée SVG seulement si `result.svgs?.length` et carte
ni échec ni ailleurs. `.result__controls` en `position: relative`
sous la vignette (`margin-top: 8px`) — plus de superposition
« Rapport de nesting » / « Télécharger ».

### 4. Planche

MD5 distincts (u2-resultats n’est plus un doublon de u2-projet-clair) :

| Fichier | MD5 |
|---|---|
| `u2-projet-clair.png` | `8A3DB1889C8E603A76B834AD2B75886C` |
| `u2-resultats.png` | `67DC82F60BED0406859CF6A786FC92A4` |
| `u2-cta-bas.png` | `06A6664F227988F4BF45A217101C7530` |

- `u2-projet-clair.png` / `u2-projet-sombre.png` — projet local, cartes
  « autre appareil » sans rectangle gris, rotations sans champ numérique.
- `u2-reglages.png` — pré-vol accordé, carte serveur terminée : vignette
  en haut, boutons dessous.
- `u2-resultats.png` — colonne Piece_Trou (échec ×2 + Terminé avec
  vignette et boutons).
- `u2-cta-bas.png` — CTA collé `Imbriquer 1 pièce` + sous-ligne.

### 5. Longues tâches et CLS

Observateur porté dans `scripts/qa-e2e-local-2sheets.mjs`
(`PerformanceObserver` `longtask` + `layout-shift`, skip
`hadRecentInput`). Dump `QA_OUT/longtasks.json` et `cls.json`.

Rejeu `QA_SPACE=0.1 QA_OUT=.qa-pw/e2e-local-u2p-01` :

| Métrique | Cible | Mesuré |
|---|---|---|
| long task max | < 500 ms | **228 ms** |
| CLS | < 0,1 | **0,0246** |
| pièces | 900/900 | 900/900 |
| tôles (grille) | [587, 313] | **[587, 313]** |
| `check_svg_dir.py` 0,1 / 1000×1000 | 0 chevauchement, 0 hors tôle | **VERDICT OK** (0 / 0) |

6 long tasks (50, 112, 109, 228, 51, 64 ms). Compute done 9 s.
Rotations : segmented 4. Kerf/safety 0 / 0,05.

## Livré au premier commit U2 (`cea3317`)

- Carte pré-vol (`data-testid="project-preflight"`), `capacityReport`.
- Canvas fond `--surface` ; vue live `min-height: 60vh`.
- Réglages en sections Tôles / Espacement et kerf / Rotations / Sens /
  Options. `CapacityPanel.vue` extrait.
- CTA collé + sous-ligne.
- Retouche §7 : miniature muette, un badge « Échec ».

## Sélecteurs QA

Aucun sélecteur du harnais retiré. Ajouts : `project-preflight`,
`settings-sheets|spacing|rotations|directions|options`,
`settings-kerf`, `settings-safety`. `.rotations__seg` pour le 4.

| Ancien | Statut |
|---|---|
| `.atelier__nest` | conservé |
| `input.counter__value` | conservé |
| `.stage__status` | conservé |
| `label.input` / `.input__value` / `.input__suffix` | conservés (InputField ; Rotations masqué hors Autre) |
| `.size__sheet` / `.size__line` | conservés |
| `label.size__checkbox` | conservé (sur `UiSwitch`) |
| `.files__item` / `.file__name` | conservés |
| `.compute__option` | conservé |
| `.content__error` | conservé |
| `.project` / `.project__badge` | conservés |
| `.result__cancel` / `.result__placeholder` | conservés (placeholder CSS encore là, plus rendu sans SVG) |
| `data-testid="capacity-panel"` et leviers | conservés |
| `data-testid="live-cancel"` | conservé |

## Verrous

| Verrou | Mesuré |
|---|---|
| `npx vitest run` | **510/510** (était 509 ; +1 `pluralSelect` / nestFiles.one) |
| `capacityPanel.test.js` | 8/8 |
| Harnais 0,1 | **vert** — [587, 313], 900/900, gap ≥ 0,1, longtask 228 ms, CLS 0,0246 |
| Harnais 2 | **non rejoué cette passe** (vérificateur : vert [573, 327] sur `cea3317`) |
| Planche | `docs/qa/atelier-ui/u2-*.png` dont `u2-cta-bas.png` |

## Non-faits

- `LiveNestingView` : stats d’en-tête **pas** migrées en `UiStat`
  (reporté à U3, noté dans le plan).
- Déploiement U2 : **non** — C1-b-bis reste en prod ; U2 attend le
  GO visuel final.
- Harnais space 2 : non rejoué ici (sélecteurs inchangés hors rotations).
