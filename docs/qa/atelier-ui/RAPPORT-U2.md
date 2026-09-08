# Rapport U2 — page projet — 2026-09-08

Plan `docs/PLAN-UI-PRO-2026-09-07.md` §U2 + retouche §7 (cartes résultat).
Vitest **509/509**. Hash : le commit `feat(ui): lot U2`.

## Livré

- **Carte pré-vol** au-dessus du canvas (`data-testid="project-preflight"`),
  recalculée via `capacityReport` à chaque réglage.
- **Canvas** fond `--surface` ; vue live `min-height: 60vh`.
- **Réglages en sections** : Tôles / Espacement et kerf / Rotations /
  Sens / Options. Rotations = `UiSegmented` 1·2·4·8 + Autre (le champ
  `label.input` reste). Directions : icônes SVG, classe
  `.compute__option` conservée. Options = `UiSwitch` (racine
  `label.size__checkbox` conservée).
- **CTA collé en bas** de la colonne réglages + sous-ligne
  « ≈ N tôles · mode ».
- **`CapacityPanel.vue`** : extraction, classes `.capacity-panel__levers li`
  et `data-testid` inchangés.
- **Retouche §7** : miniature muette (plus de bloc gris titré comme un
  bouton) ; carte d'échec = nom/cause en texte + **un** badge « Échec ».

## Sélecteurs QA

Aucun sélecteur du harnais retiré. Ajouts : `project-preflight`,
`settings-sheets|spacing|rotations|directions|options`,
`settings-kerf`, `settings-safety`.

| Ancien | Statut |
|---|---|
| `.atelier__nest` | conservé |
| `input.counter__value` | conservé |
| `.stage__status` | conservé |
| `label.input` / `.input__value` / `.input__suffix` | conservés (InputField) |
| `.size__sheet` / `.size__line` | conservés |
| `label.size__checkbox` | conservé (sur `UiSwitch`) |
| `.files__item` / `.file__name` | conservés |
| `.compute__option` | conservé |
| `.content__error` | conservé |
| `.project` / `.project__badge` | conservés |
| `.result__cancel` / `.result__placeholder` | conservés |
| `data-testid="capacity-panel"` et leviers | conservés (composant extrait) |
| `data-testid="live-cancel"` | conservé |

## Verrous

| Verrou | Mesuré |
|---|---|
| `npx vitest run` | **509/509** |
| `capacityPanel.test.js` | 8/8 |
| Harnais 4 mm / 0,1 / 2 | **non rejoués ce lot** (sélecteurs conservés ; à rejouer au GO) |
| Planche | `docs/qa/atelier-ui/u2-*.png` |

## Captures

- `u2-projet-clair.png` / `u2-projet-sombre.png`
- `u2-resultats.png` (colonne : Partiel / Terminé / Échec, miniature muette)
- `u2-reglages.png` (sections + pré-vol)

## Non-faits

- Harnais e2e et CLS Playwright : non rejoués (attendre GO visuel avant
  un déploiement U2).
- `LiveNestingView` : stats d'en-tête pas encore migrées en `UiStat`
  (le plan les voulait ; la scène live ≥ 60 vh est posée).
- Déploiement U2 : **non** — C1-b-bis est en prod ; U2 attend le GO visuel.
