# Plan d'implémentation — interface « atelier » professionnelle — 2026-09-07

Plan du vérificateur pour l'implémenteur (GLM 5.3 Max), forme du
masterplan §8 : périmètre fermé, verrous chiffrés avec leur commande,
ordre imposé, rapport constat par constat, une seule option proposée quand
un choix se présente. Objectif produit (masterplan §0) : **la référence du
nesting dans le navigateur** — l'interface doit ressembler à un outil
d'atelier sérieux, pas à un prototype.

## 0. Diagnostic (captures `docs/qa/ux-audit-2026-09-05/`, `docs/qa/atelier-ui/`, inventaire du code)

Ce qui fait « prototype » aujourd'hui, constat par constat :

| # | Constat | Preuve |
|---|---|---|
| D1 | **Aucun système** : 31 couleurs hexadécimales en dur (5 rouges, 3 verts, restes de palette Tailwind), 30 tailles de police, 14 rayons, aucun jeton d'espacement, d'ombre ou de z-index ; seuls 19 jetons de couleur existent (`app/assets/css/main.css:37-104`). | inventaire §1, §4 |
| D2 | **23 styles de bouton** (1 primitive `MainButton` + 22 `<button>` ad hoc), 11 fichiers avec `<input>` bruts hors `InputField`, aucune primitive carte / badge / état vide / toast. | inventaire §4 |
| D3 | **Le bleu saturé sert à tout** : action primaire, badge « Cet appareil », toggle de thème (le bouton le plus visible de l'écran), avatar, liens, sélection. Aucune hiérarchie visuelle. | `d01-home.png`, `d02-project.png` |
| D4 | **Cartes dans des cartes** : résultat « Nesting failed » = pilule rouge dans un cadre dans une carte ; réglages = champs encadrés dans une carte encadrée dans une colonne. | `d09-capacity-refusal.png` |
| D5 | **Le dessin de la tôle n'est pas le héros** : canvas « Ready to nest » vide encadré, vue live à 480 px de large, rapport de résultat en modale à défilement long où le dessin occupe un tiers de la hauteur. | `d10-running-22s.png`, `d06-modal-top.png` |
| D6 | **Chiffres en police mono partout** dans le rapport (onglets, tableaux, libellés), nom de fichier zip brut affiché, barre « Sheet utilization » répétée. | `d06-modal-top.png` |
| D7 | **Barre d'en-tête sans poids** : pilule « Workspace » centrée seule, six contrôles de poids égal à droite, emoji dans le titre d'accueil, flèches unicode (←, ↓, ↙) en guise d'icônes. | `d01-home.png` |
| D8 | **Contenu vide non traité** : « Results · 0 sheets » ×8 dans la colonne des résultats, tuile « 0 DXF files », « Your nested results will be here ». | `d01-home.png` |
| D9 | Thème sombre existant (`data-theme="primary"`) mais non tenu par les 31 hex en dur. | inventaire §1 |
| D10 | Pied de page marketing (logo, sept liens, deux lignes) répété dans l'application. | `05-project-dark.png` |

Ce qui est **bien** et se garde : la structure trois colonnes (projets /
travail / résultats), le choix « Cet appareil / Nos serveurs » avec ses
phrases, la vue live avec badge de faisabilité, les leviers chiffrés du
refus de capacité, `DialogWrapper` (a11y déjà faite), les polices
auto-hébergées (Inter + Poppins, aucune requête Google Fonts — c'est une
promesse de vie privée), la page /benchmarks.

## 1. Direction (une seule, pas de variantes)

**« Atelier » : sobre, dense, lisible, un seul accent.** Références de ton :
outils de FAO et de CAO récents (barres d'outils neutres, dessin sur fond
clair uni, chiffres tabulaires), pas un SaaS marketing.

- **Palette** = charte `../nestorcut-website/BRAND.md`, déjà à moitié
  présente dans `main.css` : marine `#1A2340` (texte), bleu `#007BFF`
  (accent, **réservé** aux actions primaires, à la sélection et aux liens),
  brume `#F8FBFF` (fond de page), blanc (surfaces), acier `#E1E8F0`
  (bordures), `#55627D` (texte secondaire). Sémantiques : succès
  `#0F8A4B`, avertissement `#B7791F`, danger `#C8102E` (déjà `--error-text`),
  info = accent. Sombre : mêmes rôles, surfaces `#141B33` / `#1A2340`,
  texte `#E6ECF7`, bordures `rgba(230,236,247,.14)`.
- **Angles** : charte « 4 px partout » → `--radius-s: 2px` (badges),
  `--radius: 4px` (boutons, champs, cartes), `--radius-l: 8px` (dialogues,
  canvas). Plus de 999 px sauf avatar.
- **Typographie** : Inter pour tout l'UI ; Poppins 600 réservé au h1 de page
  et au wordmark ; **plus de SF Mono pour les nombres** — Inter avec
  `font-variant-numeric: tabular-nums` (classe utilitaire `.num`) ; mono
  uniquement pour les identifiants techniques (slug, nom de fichier).
  Échelle : 12 / 13 / 14 / 16 / 20 / 24 / 32 px, corps **14 px** (13
  aujourd'hui), interlignes 1,45 (texte) et 1,2 (titres).
- **Espacement** : échelle 4 pt — 4 / 8 / 12 / 16 / 24 / 32 / 48. **Une**
  bordure par niveau : une carte ne contient jamais une autre carte bordée.
- **Ombres** : deux niveaux (`--shadow-1` carte survolée, `--shadow-2`
  dialogue). Rien d'autre.
- **Icônes** : un seul jeu, traits 1,75 px, 24 icônes maximum, SVG inline
  copiés de Lucide (MIT) dans `app/components/ui/UiIcon.vue` (aucune
  dépendance npm). Plus d'emoji, plus de flèches unicode.
- **Statuts** : jamais un aplat bleu pour un état. Badge contour + point
  coloré : neutre (Cet appareil), succès (Terminé), avertissement (Partiel),
  danger (Échec), info (En cours).

## 2. Périmètre et ordre (six lots UI, un commit-PR par lot)

Séquencement avec le lot 4 : **U0 démarre dès la clôture de P9** et peut
courir en parallèle du diagnostic P9 (fichiers disjoints) ; **P4 (worker de
finalisation) se livre avant U3** car les deux touchent `ResultModal.vue`
et `LiveNestingView.vue` ; P5 et P6 s'intercalent librement. Aucun lot UI ne
touche `residualClient.js`, `structureClient.js`, `capacityClient.js`,
`localBridge.js`, `localJobPrivate.js` ni le serveur.

### U0 — Fondations (2 j) : jetons + primitives, zéro changement de flux

Fichiers : `app/assets/css/tokens.css` (nouveau, importé par `main.css`),
`app/assets/scss/variables.scss`, `app/components/ui/` (nouveau dossier),
`MainButton.vue`, `InputField.vue`.

1. `tokens.css` : couleurs sémantiques (`--bg`, `--surface`, `--surface-2`,
   `--border`, `--border-strong`, `--text`, `--text-2`, `--text-3`,
   `--accent`, `--accent-hover`, `--on-accent`, `--ok`, `--warn`, `--danger`,
   `--info`, et leurs fonds `--ok-bg`… ), espacement `--sp-1..--sp-7`,
   rayons, ombres, `--z-header/--z-aside/--z-dialog/--z-toast`, échelle de
   police `--fs-12..--fs-32`, `--lh-text`, `--lh-title`. Bloc
   `[data-theme="primary"]` redéfinissant **uniquement** les couleurs.
   Les 19 anciens jetons deviennent des alias des nouveaux (compatibilité
   pendant la migration), supprimés en U5.
2. Primitives `app/components/ui/` : `UiButton` (= `MainButton` étendu :
   `variant` primary / secondary / ghost / danger, `size` s / m, `loading`,
   `icon` + `aria-label` obligatoire si icône seule), `UiField` (=
   `InputField` étendu : libellé au-dessus, suffixe d'unité, aide, erreur,
   `inputmode` numérique, `step` ±), `UiBadge` (tones ci-dessus),
   `UiCard` (un niveau, slots header / body / footer, jamais imbriquée),
   `UiSegmented` (remplace directions, unités, vue couleur/DXF),
   `UiSwitch`, `UiStat` (valeur `.num` + libellé), `UiEmptyState` (icône,
   titre, phrase, action), `UiToast` + `useToast()` (aria-live polite,
   4 s, trois usages au plus : copie, téléchargement lancé, préférence
   enregistrée), `UiIcon` (sprite inline).
3. Migration mécanique : les 22 `<button>` ad hoc → `UiButton` ; les 11
   `<input>` bruts → `UiField` ; les 31 hex → jetons ; `font-size` et
   `border-radius` → jetons.

Verrous U0 (commandes dans le rapport) :

| Verrou | Cible | Commande |
|---|---|---|
| Hex en dur hors `tokens.css` et drapeaux SVG | **0** | `grep -rnE "#[0-9a-fA-F]{3,8}\b" app --include=*.vue --include=*.scss --include=*.css \| grep -v tokens.css \| grep -v LocaleSwitcher` |
| `<button` hors `app/components/ui/` | **0** | `grep -rn "<button" app --include=*.vue \| grep -v components/ui/` |
| `<input` hors `ui/` et hors `type="file"`/`checkbox` internes aux primitives | **0** | idem avec `<input` |
| Valeurs `font-size` distinctes | **≤ 7** | `grep -rhoE "font-size:\s*[^;]+" app \| sort \| uniq -c` |
| Valeurs `border-radius` distinctes | **≤ 4** (2/4/8/50 %) | idem |
| Contraste AA des couples texte/fond des jetons, deux thèmes | **100 %** | script `scripts/ui-contrast-check.mjs` (nouveau, calcule WCAG sur `tokens.css`) |
| Poids CSS du bundle client | **≤ +10 %** vs HEAD | `npx nuxt build` puis taille de `.output/public/_nuxt/*.css` |
| Aucune dépendance npm ajoutée ; fonts toujours auto-hébergées | 0 requête externe | `package.json` diff ; onglet réseau du harnais (déjà filtré : 0 domaine tiers) |
| Non-régression | vitest vert, harnais 2 configurations, `qa-c01`, `qa-c02c03`, `qa-badge-overlap`, `qa-l4-orphan` verts | commandes habituelles |

### U1 — Coquille : en-tête, colonnes, accueil (2 j)

Fichiers : `MainHeader.vue`, `layouts/auth.vue`, `Footer.vue`,
`UserProjects.vue`, `UserProjectItem.vue`, `UserResults.vue`,
`UserResultItem.vue`, `pages/home.vue`, `UserStats.vue`.

- En-tête 56 px : à gauche logo N + « NestorCut » + lien « Espace de
  travail » (texte, plus de pilule centrée) ; à droite **trois** boutons
  fantômes de même poids (unités, langue, thème — le thème n'est plus un
  carré bleu plein) + coffre (icône, état par point) + avatar-menu. Rien
  d'autre.
- Colonne projets : lignes de 56 px (nom sur une ligne tronquée, badge
  contour « Cet appareil » / « Démo », méta « il y a 12 min · 1 résultat »),
  ligne active = barre d'accent 2 px à gauche + fond `--surface-2` (plus de
  cadre bleu) ; champ de recherche au-dessus dès **8** projets ; corbeille
  visible au survol/focus seulement (test `qa-badge-overlap` conservé).
- Colonne résultats : carte = **nom du projet · densité · N tôles**, badge
  d'état sémantique, miniature 64 px, date ; échec = « Échec · <raison
  courte> » en ton danger contour, plus jamais « Results · 0 sheets » (si
  `placed === 0` et pas d'échec : « Aucune pièce posée »).
- Accueil : plus d'avatar géant ni d'emoji ; « Bonjour Guillaume » en h1
  Poppins 24 px ; quatre `UiStat` (projets, imbrications ce mois, pièces
  imbriquées, taux de réussite) — la tuile « DXF files » disparaît ; carte
  « Nouvelle imbrication » conservée telle quelle en contenu, restylée.
- Pied de page dans le layout `auth` : **une ligne** (© · Mentions ·
  Confidentialité · Changelog · Support) ; le grand pied de page reste sur
  `default`/`doc`.

Verrous U1 : captures avant/après (§4) ; hauteur d'en-tête 56 px ; **0**
aplat bleu hors action primaire et sélection (revue visuelle du
vérificateur) ; `a11y-home-desktop.json` régénéré : 0 violation sérieuse ;
i18n : nouvelles clés dans les deux langues, `i18nDict.test.js` vert.

### U2 — Page projet, le cœur (3 j)

Fichiers : `pages/project/[slug].vue`, `MainSettings.vue`,
`LiveNestingView.vue` (style seulement), `SheetAxes.vue`, nouveau
`CapacityPanel.vue` (extraction de `.capacity-panel` de la page, classes
`.capacity-panel__levers li` **conservées** : `capacityPanel.test.js` et
le harnais en dépendent).

- **Carte pré-vol** au-dessus du canvas, calculée par `capacityClient.js`
  (déjà instantané) : « 900 pièces · 2 fichiers · 1,09 m² · ≈ 2 tôles à cet
  espacement · densité max ≈ 88 % », mise à jour à chaque changement de
  réglage. C'est la démonstration « navigateur » : la réponse avant le
  calcul.
- Canvas : rapport d'aspect réel de la tôle, fond `--surface`, axes
  discrets, occupe la largeur de la colonne centrale ; en calcul, la vue
  live prend **≥ 60 vh** ; barre d'état au-dessus : quatre `UiStat` de même
  poids (temps, densité, layouts, cœurs) + badge de faisabilité + bouton
  Annuler (`data-testid="live-cancel"` conservé).
- Réglages en **sections titrées** (Tôles / Espacement et kerf / Rotations /
  Directions / Options) : libellés au-dessus, unité en suffixe, presets en
  chips contour, rotations = `UiSegmented` 1 · 2 · 4 · 8 + « Autre », la
  ligne « → 0°, 90°… » devient une aide en `--text-3` ; directions =
  `UiSegmented` avec icônes SVG ; options = `UiSwitch`.
- CTA « Imbriquer 900 pièces » **collé en bas** de la colonne réglages,
  avec sous-ligne « ≈ 2 tôles · Cet appareil ».
- Sélecteurs QA à conserver ou migrer **dans le même commit** avec le
  harnais : `.atelier__nest`, `input.counter__value`, `.stage__status`,
  `label.input`, `.input__value`, `.input__suffix`, `.size__sheet`,
  `.size__line`, `label.size__checkbox`, `.files__item`, `.file__name`,
  `.upload input[type=file]`, `.compute__option`, `.content__error`,
  `.project`, `.project__badge`, `.result__cancel`, `.result__placeholder`.
  Règle : **ajouter des `data-testid`** aux éléments que le harnais lit et
  faire pointer le harnais dessus (10 `data-testid` existent aujourd'hui) ;
  le rapport liste chaque sélecteur migré.

Verrous U2 : harnais 4 mm deux configurations verts (partiels + leviers) ;
e2e 0,1 et 2 (`qa-e2e-freeze.mjs`) : long task max inchangée (< 0,5 s) et
CLS < 0,1 sur la page projet (mesure Playwright `PerformanceObserver`) ;
`capacityPanel.test.js` vert ; captures §4.

### U3 — Résultats : de la modale-liste à l'espace de résultat (3 j, après P4)

Fichiers : `ResultModal.vue` (découpé en `ResultViewer.vue` +
`ResultReport.vue` + `ResultAlternatives.vue`, `ResultModal.vue` devenant
l'orchestrateur sur `DialogWrapper`), `SheetSvgPreview.vue`,
`UserResultItem.vue` (téléchargements).

- Dialogue **plein écran** (marge 24 px), deux volets : **visionneuse 2/3**
  (barre d'outils : onglets tôle, couleur / DXF en `UiSegmented`, ajuster,
  plein écran ; zoom molette + glisser) et **rapport 1/3** défilant.
- Onglets d'alternatives en haut : « Grille · 74,2 % · 2 tôles »,
  « Compaction · 93,4 % · 2 tôles », le premier proposé marqué (la ligne
  « proposé en premier » de `qa-c02c03` reste, une seule ligne de qualité,
  pas de barre « Sheet utilization » dupliquée).
- Rapport : en-tête densité (grand `.num`), tôles, chute réutilisable ;
  tableau par tôle en `tabular-nums` ; téléchargements (tout · par tôle ·
  rapport) en `UiButton` ; `CapacityPanel` réutilisé pour partiel / refus ;
  détails techniques repliés (conservés) ; le slug devient un bouton
  « Copier l'identifiant » (`useToast`).
- Mobile (< 768 px) : volets empilés, visionneuse d'abord.
- Sélecteurs à migrer : `.alts__tab`, `.report__badges .report__badge`,
  `.report__engine`, `.report__table tbody tr`, `.modal__summary
  .summary__value`, `.view-toggle__btn`, `.results__item`, `.result__area`.

Verrous U3 : `qa-c02c03-modal.mjs` vert (mis à jour sur `data-testid`) ;
`resultQuality.test.js` inchangé et vert (une seule définition de la
densité) ; `a11y-modal-desktop.json` / `mobile` : 0 sérieuse, focus piégé,
Échap ferme, retour de focus ; md5 des SVG de tôle inchangés (le rendu du
dessin ne change pas, seul le cadre change) ; captures §4.

### U4 — États, mouvement, accessibilité (1,5 j)

- États vides (`UiEmptyState`) : projets, résultats, fichiers ; squelettes
  pendant le chargement des résultats ; erreurs = carte ton danger avec
  raison + action (Réessayer / Ajouter une tôle).
- Focus visible 2 px accent sur tout élément interactif ;
  `prefers-reduced-motion` respecté (transitions ≤ 150 ms sinon) ; cibles
  tactiles ≥ 40 px.
- Thème sombre : passage de **chaque** écran des captures §4 ; 0 hex
  résiduel garanti par le verrou U0.

Verrous U4 : axe 0 sérieuse sur home, projet, modale, auth, plans (deux
thèmes) ; navigation clavier complète du parcours « déposer → régler →
imbriquer → ouvrir le résultat → télécharger » enregistrée en vidéo
Playwright ; captures §4.

### U5 — Pages secondaires et nettoyage (1,5 j)

- Auth, compte, plans, changelog, licences, légal : jetons et primitives,
  largeur max 960 px, formulaires en `UiField`.
- Suppression des alias des 19 anciens jetons, de `fonts.scss`
  ré-émis dans chaque bloc scopé (le déplacer en import global unique :
  `additionalData` ne garde que `variables.scss` et `mixins.scss`), des
  icônes `mask-image` de `MainButton`, des 12 clés i18n manquantes en FR.
- `docs/DESIGN-SYSTEM.md` : jetons, primitives, règles (une bordure par
  niveau, accent réservé, `.num`), captures de référence.

Verrous U5 : `additionalData` réduit (mesure : taille CSS ≤ HEAD −15 %) ;
parité i18n 589 = 589 ; captures §4 complètes.

## 3. Non-objectifs (ne pas faire, même si tentant)

Pas de Tailwind ni de bibliothèque de composants ; pas de renommage de
`data-theme="primary"` (cookie et SSR en dépendent) ; pas de changement
de route ni d'API ; pas de nouvelle police ni de police distante ; pas de
modification de la sémantique du rapport (`resultQuality`), du calcul, du
pré-contrôle ni des miroirs JS du post-pass ; pas de refonte du produit
« strip » (il reçoit les jetons en U5, rien de plus) ; pas de renommage
de clés i18n existantes ; pas de captures écrasant des fichiers suivis
(sorties sous `docs/qa/ui-2026-09/`, règle AF7).

## 4. Preuve visuelle et revue

- Script `scripts/ui-captures.mjs` (dérivé de `ux-global-review.mjs`) :
  **12 écrans nommés** (accueil, projet vide, projet prêt, calcul en cours,
  résultat option 1, résultat option 2 tôle 2, refus de capacité, partiel,
  auth, compte, plans, benchmarks) × 2 thèmes × 2 largeurs (1440, 390),
  sortie `docs/qa/ui-2026-09/<lot>/<écran>-<thème>-<largeur>.png`, plus
  une planche `index.html` avant/après.
- Chaque lot se termine par la planche ; le vérificateur rend un **GO
  visuel** (ou une liste de retouches fermée) avant le lot suivant.
  Aucun déploiement d'un lot UI sans ce GO.

## 5. Rapport attendu par lot (forme §8)

Pour chaque verrou du lot : valeur mesurée et commande ; liste des
sélecteurs QA migrés (ancien → `data-testid`) ; liste des fichiers touchés
; non-faits énoncés ; hashes réels ; planche de captures. Quand un choix
se présente (par exemple un composant qui ne rentre pas dans les
primitives), l'implémenteur propose **une** option avec capture et attend.

## 6. Charge et jalons

U0 2 j → U1 2 j → U2 3 j → (P4) → U3 3 j → U4 1,5 j → U5 1,5 j : **13 jours**
d'implémentation, revue comprise, en parallèle de la phase B du lot 4 et
du jalon utilisateurs. Premier effet visible pour un utilisateur : fin de
U1 (coquille et accueil) ; effet « outil pro » : fin de U3.

## 7. Journal des GO visuels

### U0 — GO (07/09, 18 h, commit `f79c003`)

Vérifié : 0 hex hors `tokens.css` et drapeaux ; 8 valeurs de police (7
jetons + `font-size: 0` technique) ; rayons = 4 jetons + 5 composés de
coins sélectifs (acceptés) ; contraste AA 100 % sur les deux thèmes
(script rejoué) ; CSS 300 Ko (+1,4 %) ; aucune dépendance ; vitest
485/485 ; harnais 0,1 : 900/900, grille [587, 313] ; planche : rendu
inchangé par construction, thème sombre tenu.

Écart accepté avec suivi : **22 `<button>` et 15 `<input>`** restent hors
`app/components/ui/` (le plan les voulait en U0). Report accordé parce que
chacun appartient à un écran que U1-U3 refont ; en contrepartie, chaque
rapport de lot donne les deux compteurs (commande du §U0), U1 traite ceux
de l'en-tête, des colonnes, de l'accueil et du pied de page, et les deux
compteurs sont à **0 à la fin de U3**. Rien d'autre à reprendre : U1 peut
démarrer.

### U1 passe 1 — GO partiel, retouches fermées avant le GO U1 (07/09, 20 h, commit `49d9e51`)

Vérifié : en-tête allégé, bouton de thème en fantôme, lignes de projets
compactes, accueil sans avatar ni emoji, pied de page d'application sur
une ligne (visible en bas de la page projet), hex 0, vitest 485/485,
harnais 0,1 : 900/900 et grille [587, 313], `qa-badge-overlap` vert.
Compteurs hors `ui/` : 22 boutons, 15 champs (commandes du §U0 ; le
rapport dit 25/12 avec une autre commande — utiliser celles du plan).

Retouches à livrer dans la passe 2, toutes fermées :

1. **`UiBadge` n'est pas conforme** : ovales à 999 px en capitales, contour
   bleu accent pour « Cet appareil » et « Démo » — c'est encore de l'accent
   partout, sous une autre forme. Attendu (§1 « Statuts ») : rayon
   `--radius-s` (2 px), casse normale, 11-12 px, contour `--border-strong`
   + point 6 px ; ton **neutre** pour « Cet appareil » (gris), info pour
   « Démo », succès / avertissement / danger réservés aux états de résultat.
   Vaut pour la colonne projets, l'accueil et le titre de projet.
2. **Les cinq statistiques sur `UiStat`** : « Ce mois-ci » et « Taux de
   réussite » sont encore les anciennes tuiles à chiffres bleus.
3. **« Espace de travail » à gauche**, à côté de la marque (le lien est
   resté centré).
4. **Accueil : supprimer « Projets récents »** — la colonne de gauche
   liste déjà les mêmes projets ; une seule liste.
5. **Preuve du pied de page** : la capture `planche-03-auth-pied-compact`
   montre le grand pied de page du layout `doc` (page d'inscription), pas
   celui du layout `auth` ; fournir la capture du bas de la page projet.
6. Le reste de la passe 2 annoncée : colonne résultats (« projet · densité
   · N tôles », état sémantique, fin de « Results · 0 sheets »), recherche
   dès 8 projets, unités / langue sur `UiSegmented`, `a11y-home-desktop.json`
   régénéré à 0 sérieuse, migration des boutons et champs de l'en-tête,
   des colonnes et de l'accueil avec les deux compteurs dans le rapport.

Planche attendue : accueil clair / sombre, page projet clair / sombre
avec la colonne résultats remplie (un terminé, un partiel, un échec), bas
de page projet.

### U1 passe 2 — GO visuel (vérificateur, 08/09, planche `docs/qa/atelier-ui/p2-0{1..5}-*.png`, commit 982fc4d)

Les six retouches sont fermées : badges contour gris casse normale, cinq stats homogènes, « Espace » à gauche, plus de « Projets récents », pied une ligne prouvé sur la page projet, colonne résultats avec Terminé / Partiel / Échec dans les deux thèmes. **Une retouche reportée dans U2** (page projet, pas bloquante) : dans les cartes de résultat, le titre (« Autre appareil », « Échec du nesting ») est rendu dans un bloc gris bordé qui ressemble à un bouton, et la carte d'échec répète « Échec du nesting » deux fois — titre en texte simple, un seul libellé d'état par carte.

