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

**Reporté d'U2-ter (constat vérificateur 08/09)** : dans la liste des
projets, le badge « Démo » se tronque en « D » quand le nom du projet est
long — le badge ne doit pas se compresser (`min-width` + `flex-shrink: 0`
sur le badge, ellipse sur le NOM, jamais l'inverse). Verrou : capture de
la colonne Projets avec un nom long, badge « Démo » entier.

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

### U2 — GO partiel, cinq retouches fermées avant déploiement (vérificateur, 08/09, commit `cea3317`)

Rejoué par le vérificateur sur le build local U2 (bundle servi vérifié : `project-preflight` présent) : harnais `scripts/qa-e2e-local-2sheets.mjs` deux configurations **verts et identiques aux références** (0,1 : [587, 313] ; 2 : [573, 327] ; 900/900 ; `check_svg_dir.py` 0 chevauchement, 0 hors tôle) ; vitest 509 ; sélecteurs conservés. Planche : sections, pré-vol, cartes résultat sans bloc-bouton, thèmes cohérents.

Retouches (une passe, commit unique, captures refaites) :

1. **Pluriels et aire du pré-vol** (`pages/project/[slug].vue`, `data-testid="project-preflight"`, et le compteur d'en-tête) : « 1 pièces · 1 fichiers · ≈ 1 tôles » → accord au singulier (`Intl.PluralRules` ou le helper i18n existant du lot 3) ; « — m² » masqué quand l'aire n'est pas connue (projet serveur sans géométrie locale), jamais un tiret dans la phrase.
2. **Rotations** (`MainSettings.vue`) : le champ numérique « Rotations · pas » ne s'affiche que si le segment « Autre » est actif ; sur 1 · 2 · 4 · 8 il disparaît (doublon aujourd'hui).
3. **Cartes résultat** (`UserResultItem.vue`) : plus de rectangle gris vide quand il n'y a pas de vignette (autre appareil, échec) ; sur la carte terminée serveur, la vignette est aujourd'hui recouverte par « Rapport de nesting » / « Télécharger » — vignette entière en haut, boutons dessous, rien ne se chevauche.
4. **Planche** : `u2-resultats.png` est octet-identique à `u2-projet-clair.png` — refaire avec la colonne résultats après la retouche 3 ; ajouter `u2-cta-bas.png` (bas de la colonne réglages : CTA collé avec sa sous-ligne « ≈ N tôles · mode »), preuve manquante du verrou.
5. **Longues tâches et CLS** : `docs/qa/perf-audit-2026-09-05/l1-verif/qa-e2e-freeze.mjs` est périmé (il attend un champ « Spacing » d'avant kerf/sécurité, timeout l. 127). Porter son observateur (l. 29 : `longtask` ; ajouter `layout-shift`) dans `scripts/qa-e2e-local-2sheets.mjs` avec dump `longtasks.json` et `cls.json` dans `QA_OUT`, puis rejouer à 0,1 : **long task max < 500 ms, CLS < 0,1** sur la page projet. Valeurs dans le rapport.

Reporté à U3 (noté, pas une retouche U2) : stats d'en-tête de `LiveNestingView` en `UiStat`. Après la passe : GO visuel final puis déploiement app (procédure habituelle, aucun worker).

### U2 — GO final (vérificateur, 08/09, commit `0bf868c`)

Cinq retouches vérifiées sur la planche refaite (pluriels, champ rotations masqué hors « Autre », cartes sans rectangle vide et vignette dégagée, `u2-resultats.png` distinct, `u2-cta-bas.png`). Rejoué par le vérificateur sur le build servi : configuration 2 → 900/900, [573, 327], 0 chevauchement, long task max 267 ms, CLS 0,0235 ; configuration 0,1 de l'implémenteur relue (228 ms, 0,0246, [587, 313]). **GO déploiement app** (aucun worker). **Déployé prod 08/09** : image `ghcr.io/guiguijke/nest2d-app:latest` SHA `c6c7a43` (`NUXT_PUBLIC_GIT_COMMIT_SHA`), app recréée 2026-09-08T11:38:45Z ; nesting-worker inchangé (2026-09-07T14:20). `/benchmarks` : version corpus **`45c49f3` inchangée** ; « image déployée `c6c7a43` ». Capture `docs/qa/atelier-ui/u2-prod.png` (session QA Agent, accueil authentifié — un GET SSR `/project/:slug` répond 302 `/home` via `getProject` sans cookie au fetch interne, préexistant). U3 commence après P4 ; y inclure les stats live en `UiStat`.

### U2-ter — retouches propriétaire (08/09) : plus de formes en pilule, page profil pleine largeur, abonnement

Retour du propriétaire sur la prod U2 : « je n'aime pas du tout les boutons trop arrondis, c'est assez moche » (presets de tôle, interrupteurs), « la page profil est trop centrée et n'utilise pas tout l'écran », bug d'affichage dans la partie abonnement. Décision (charte : rayon 4 px, 2 px pour les badges, 50 % réservé aux avatars) :

1. **Zéro pilule hors avatar.** `--radius-full` ne sert plus qu'aux avatars (`Avatar.vue`, `profile.vue` l. 65). Passer à `var(--radius)` (4 px) ou `var(--radius-s)` (2 px, badges/puces) chaque occurrence : `MainSettings.vue` l. 557 et 603 (presets de tôle, chips), `ui/UiSwitch.vue` l. 33 et 46 (piste rectangulaire 4 px, curseur carré 2 px, 32 × 18 px), `ui/UiButton.vue` l. 100, `ui/UiBadge.vue` l. 39 (puce d'état : carré 6 px, rayon 2 px), `Subscription.vue` l. 241, `FileParts.vue`, `FreeNestBanner.vue`, `ResultModal.vue` (3), `VaultMenuButton.vue` (2), `VaultSettings.vue`, `benchmarks.vue`, `changelog.vue` (2), `plans.vue`, `project/[slug].vue` l. 1020. Verrou : `git grep -n "radius-full" app | grep -v -i avatar` = **0** ligne hors `profile.vue` l. 65 et `Avatar.vue` ; `git grep -n -E "border-radius:\s*(999|9999)px|border-radius:\s*50%" app` = 0 hors avatars.
2. **Page profil pleine largeur** (`pages/profile.vue`) : même grille que l'accueil (colonnes gauche / centre / droite, gouttières identiques), contenu aligné à gauche de la colonne centrale, plus de bloc centré à 420 px. Ordre : identité (nom, badge Vérifié contour, avatar 64 px, Déconnexion en bouton fantôme à droite du nom), Activité (`UiStat` ×5 comme l'accueil), Abonnement, Newsletter, Coffre, Suppression de compte. Largeur de texte max 720 px, mais les cartes prennent la colonne.
3. **Abonnement** (`components/Subscription.vue`) : la carte « NestorCut Pro » chevauche la carte d'état (marge négative ou position absolue à corriger) — deux cartes empilées avec 16 px d'écart, ou côte à côte ≥ 1024 px ; le badge « Unlimited (test grant) » en aplat bleu pilule devient `UiBadge` contour ; `max-width: 420px` retiré (la carte suit la colonne).
4. **Captures** : `docs/qa/atelier-ui/u2ter-reglages.png` (presets + interrupteurs), `u2ter-profil-clair.png`, `u2ter-profil-sombre.png` (1440 px, page entière), `u2ter-abonnement.png`. Harnais deux configurations rejoués (les presets et `label.size__checkbox` sont des sélecteurs du harnais), vitest, script de contraste d'U0 sur le profil.

Une passe, un commit, GO visuel du vérificateur, puis déploiement app.


#### U2-ter — livré (08/09), en attente de GO visuel

**1. Zéro pilule hors avatar — 20 occurrences traitées.** `--radius-full`
(50 %) ne subsiste que dans `tokens.css` (sa définition, commentée
« avatars ») et dans `Avatar.vue`. Correspondance appliquée : `var(--radius)`
(4 px) pour ce qui se clique ou se lit comme un contrôle, `var(--radius-s)`
(2 px) pour les badges et les puces.

| Fichier | Ligne | Élément | Nouveau rayon |
|---|---|---|---|
| `components/MainSettings.vue` | 557 | preset de tôle (`.presets__chip`) | `--radius` |
| `components/MainSettings.vue` | 603 | icône d'aide « ? » | `--radius` |
| `components/ui/UiSwitch.vue` | 33 | piste (32 × 18 px) | `--radius` |
| `components/ui/UiSwitch.vue` | 46 | curseur (14 × 14 px) | `--radius-s` |
| `components/ui/UiButton.vue` | 100 | spinner | `--radius-s` |
| `components/ui/UiBadge.vue` | 39 | puce d'état (6 px, était `50%`) | `--radius-s` |
| `components/ResultModal.vue` | 1222 / 1265 / 1279 | bascule de vue / chip stratégie / onglet | `--radius` / `--radius-s` / `--radius` |
| `components/VaultMenuButton.vue` | 239 / 306 | point d'état / icône d'aide | `--radius-s` / `--radius` |
| `components/VaultSettings.vue` | 268 | point d'état | `--radius-s` |
| `components/FileParts.vue` | 71 | pastille de couleur de pièce | `--radius-s` |
| `components/FreeNestBanner.vue` | 169 / 176 | jauge et son remplissage | `--radius-s` |
| `components/Subscription.vue` | 241 | badge d'état (supprimé, → `UiBadge`) | — |
| `pages/benchmarks.vue` | 211 | badge de verdict | `--radius-s` |
| `pages/changelog.vue` | 112 / 162 | badge de date / puce de liste | `--radius-s` |
| `pages/plans.vue` | 330 | badge de plan | `--radius-s` |
| `pages/project/[slug].vue` | 1020 | badge | `--radius-s` |
| `pages/profile.vue` | 65 | badge « Vérifié » (supprimé, → `UiBadge` contour) | — |

**Écart assumé sur le plan** : le plan laissait `profile.vue` l. 65 dans
l'exception « avatars ». C'était le badge « Vérifié », pas un avatar — il
est passé en `UiBadge` contour comme le demande le point 2 du même plan, et
l'exception se réduit donc à `Avatar.vue` + la définition du jeton.

Verrous (arbre propre, HEAD) :

```
git grep -n "radius-full" app | grep -v -i avatar          → 0 ligne
git grep -n -E "border-radius:\s*(999|9999)px|border-radius:\s*50%" app → 0 ligne
```

**2. Page profil sur la grille de l'accueil.** `pages/profile.vue` passe du
layout `profile` (colonne centrée à 660 px) au layout `auth` — la grille de
l'accueil, `240px | 1fr | 260px`, mêmes gouttières, colonnes Projets et
Résultats des deux côtés. Identité sur une ligne : avatar **64 px**
(`Avatar.vue`, taille `m` : 140 → 64 ; la taille `s` de l'en-tête est
inchangée), nom en `--font-display`, badge « Vérifié » en contour,
**Déconnexion** en `UiButton variant="ghost"` poussé à droite. Ordre :
identité → Activité (`UserStats`, `UiStat` × 5, déjà partagé avec
l'accueil) → Abonnement → Code promo → Newsletter → Coffre → Suppression de
compte. Le bloc coffre, jusqu'ici centré et borné à 520 px, suit la colonne
et s'aligne à gauche (texte borné à 720 px).

**3. Abonnement.** Les cartes ne se touchent plus : `.subscription` passe en
`align-items: stretch` + `gap: 16px` (elles étaient empilées sans écart —
d'où le « chevauchement » vu sur un compte qui affiche la carte d'état ET
la carte Pro), `max-width: 420px` retiré (la carte suit la colonne),
contenu aligné à gauche, contour `--separator-secondary` comme les autres
cartes, bouton borné à 280 px. Le badge en aplat bleu pilule devient
`UiBadge tone="ok" dot` (contour) aux trois emplacements.

**Verrous rejoués** : `npx vitest run` → **513/513** ; `node
scripts/ui-contrast-check.mjs` → AA 100 % clair et sombre ; harnais
navigateur deux configurations (`scripts/qa-e2e-local-2sheets.mjs`,
sélecteurs `label.size__checkbox` et presets intacts) → space 0,1 :
900/900, 55,4 %, long task max 73 ms / 57 ms après solve, CLS 0,019 ;
space 2 : 900/900, 55,4 %, long task max 67 ms / 58 ms après solve, CLS
0,025.

**Captures** (1440 px, page entière) : `docs/qa/atelier-ui/u2ter-profil-clair.png`,
`u2ter-profil-sombre.png`, `u2ter-abonnement.png`, `u2ter-reglages.png`
(presets + interrupteurs). Script : `scripts/u2ter-check.mjs`.

**Aucun déploiement** — attente du GO visuel.

### U2-ter — GO (vérificateur, 08/09, commit `7f2d682`)

Verrous rejoués : `git grep radius-full app` hors avatars et `tokens.css` = 0 ; aucun `border-radius` 999px/50 % hors avatar ; `UiSwitch` piste 4 px / curseur 2 px, `UiBadge` 2 px, presets de tôle 4 px (capture réglages) ; profil sur la grille pleine largeur, badge « Vérifié » contour, abonnement sans chevauchement. L'écart assumé (badge Vérifié de `profile.vue` l. 65 passé en contour) est conforme au point 2. **GO déploiement app.** Résidu pour U4 : dans la liste des projets, le badge « Démo » est tronqué (« D ») quand le nom est long — le badge ne doit pas se compresser (min-width, nom en ellipse).


**Déployé prod 08/09** : app seule, `ghcr.io/guiguijke/nest2d-app:latest`
digest `sha256:8d44bf54f3c7ae2a…`, `NUXT_PUBLIC_GIT_COMMIT_SHA=7f2d682ddd6b9934…`,
app recréée 2026-09-08T19:08:30Z ; `nesting-worker` **inchangé**
(2026-09-08T14:50:28Z, P5). Contrôle non invasif sur le CSS réellement
servi (68 feuilles, 262 122 octets, pages publiques `/plans`,
`/changelog`, `/benchmarks`) : **0** `border-radius: 50%`, **0**
`border-radius: 999px`, `var(--radius-full)` uniquement pour l'avatar.
Captures publiques : `docs/qa/atelier-ui/u2ter-prod-public-plans.png`
(badges de plan carrés), `u2ter-prod-public-changelog.png`,
`u2ter-prod-public-benchmarks.png`.

**Pages authentifiées — arbitrage propriétaire (08/09)** : plutôt que de
toucher à l'authentification de production, les captures des deux pages
authentifiées sont prises sur le **build local Docker du même commit**,
avec un compte créé pour l'occasion par le script
`scripts/u2ter-fresh-account.mjs` (inscription autonome, aucun compte de
production modifié) :

- `u2ter-projet.png` — page projet complète : presets de tôle à 4 px,
  interrupteurs rectangulaires, badge « DEMO » du bandeau en contour 2 px ;
- `u2ter-profil-compte-neuf.png` — profil pleine largeur d'un compte neuf
  (bandeau e-mail non vérifié, donc PAS de badge « Vérifié » : le badge
  suit bien `emailVerified`) ;
- `u2ter-compte-neuf-accueil.png` — accueil du même compte.

Toutes les captures ci-dessus ont été **reprises après un rebuild de
l'image locale sur un arbre propre à HEAD** (image du 2026-09-08 20:03 UTC)
— demande propriétaire, et à raison : les dates de fichier ne prouvent
rien ici, `git add` réécrit les fichiers en CRLF et rajeunit leur mtime.
Contrôle direct sur le CSS RÉELLEMENT construit :

```
grep -c 'border-radius:50%' .output/public/_nuxt/*.css   → 0 partout
grep -l 'radius-full'       .output/public/_nuxt/*.css   → Avatar.css (la règle
                                                            avatar) + entry.css
                                                            (la définition du jeton)
```

`u2ter-reglages.png`, `u2ter-abonnement.png` et `u2ter-projet.png` sont
ressorties **octet pour octet identiques** au premier tirage : l'interface
n'a pas bougé entre les deux builds (seules les captures qui montrent la
liste des projets diffèrent — de nouveaux projets de test s'y sont
ajoutés).

Le build déployé, lui, est attesté côté prod par le contrôle du CSS servi
et les trois captures publiques ci-dessus. **Résidu confirmé à l'œil sur
`u2ter-projet.png`** : dans la colonne Projets, « Demo — Marine sheet
metal » affiche un badge tronqué « ● D » — porté dans les verrous d'U4.

### U3 — cadrage validé, ordre imposé en deux passes (vérificateur, 09/09)

La décomposition proposée par l'implémenteur est retenue : tout le script reste dans `ResultModal.vue` (orchestrateur sur `DialogWrapper`), trois enfants de **présentation seulement** — `ResultAlternatives.vue` (onglets + ligne « proposé en premier »), `ResultViewer.vue` (pager de tôle, couleur / DXF en `UiSegmented`, affichage, plein écran), `ResultReport.vue` (bandeau, résumé, tableau, leviers, badges, détails techniques, exports) — chacun recevant **un objet unique** re-exposé en computeds, les blocs de template déplacés sans réécriture.

- **Passe 1 — extraction pure, zéro changement visuel** (1 j, un commit) : les captures avant / après de la modale sont **octet-identiques** ou n'en diffèrent que par des `data-testid` ajoutés ; verrous : md5 des SVG de tôle inchangés, `qa-c02c03-modal.mjs` vert, `resultQuality.test.js` inchangé et vert, `a11y-modal-desktop.json` / `mobile` identiques à HEAD. Sélecteurs listés au plan migrés sur `data-testid` **dans le même commit** que le harnais qui les lit. GO du vérificateur sur cette passe avant la suivante.
- **Passe 2 — l'espace de résultat** (2 j) : plein écran à 24 px, visionneuse 2/3 + rapport 1/3, onglets d'alternatives, rapport selon le plan, mobile empilé. Verrous : les mêmes, plus captures `docs/qa/atelier-ui/u3-{modal-clair,modal-sombre,modal-mobile,rapport}.png`, 0 sérieuse a11y, focus piégé, Échap, retour de focus.
- Le socle P6 (`485a491`) part avec le déploiement de la passe 2 (mesure au repos `fbc88cc` : 70 / 75 / 82 ms après solve, aucun timeout, P6 pas plus lent que P5 — validée).

### Retouche immédiate (propriétaire, 09/09) : le badge « Démo » sort de la carte projet

Cause lue dans `app/components/UserProjectItem.vue` : le nom du projet est un **nœud texte nu** dans `.project__label` (flex, `nowrap`, `overflow: hidden`, `text-overflow: ellipsis` l. 205-212) — l'ellipse ne s'applique jamais à un texte nu dans un conteneur flex, le texte garde sa largeur et c'est le badge `PrivacyChip` qui est comprimé (« D ») puis poussé hors de la carte. Correction, un commit, avant U3 passe 1 :

1. Envelopper le nom : `<span class="project__name">{{ projectName }}</span>` avec `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.
2. Le badge : `flex-shrink: 0` sur `.project__badge` (et `.project__nesting`), largeur naturelle, jamais tronqué.
3. Retirer `text-overflow` du conteneur `.project__label` (inutile une fois le span en place).
4. Verrous : capture `docs/qa/atelier-ui/badge-demo-{clair,sombre}.png` de la colonne projets à 240 px avec « Démo — Tôlerie marine » (nom en ellipse, badge entier), harnais : `.project` / `.project__badge` restent des sélecteurs lus (inchangés), vitest.


**Livré (09/09)** — `UserProjectItem.vue`, un commit :

| Point | Fait |
|---|---|
| 1. Nom enveloppé | `<span class="project__name">` + `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| 2. Badge et mention | `flex-shrink: 0` sur `.project__badge` **et** `.project__nesting` |
| 3. Conteneur | `overflow: hidden` et `text-overflow: ellipsis` retirés de `.project__label` (`white-space: nowrap` conservé — il sert encore aux enfants) |

Mesuré sur le build local reconstruit, sonde dans `scripts/badge-demo-check.mjs` (bornes lues dans le DOM, pas seulement l'œil) :

```
clair  :: badge "Demo" 62px | nom 104px ellipse=true | badge dans la carte=true
sombre :: badge "Demo" 62px | nom 104px ellipse=true | badge dans la carte=true
```

— le badge fait sa largeur naturelle (62 px, texte entier) au lieu d'être écrasé à « D », le nom est bien tronqué (`scrollWidth > clientWidth`), et le badge reste dans les bornes de la carte. Toutes les lignes en profitent (« clever-tur… » + « This device » entier). Captures `docs/qa/atelier-ui/badge-demo-{clair,sombre}.png` (colonne à 240 px).

Verrous : `npx vitest run` **517/517** ; les sélecteurs lus par les scripts QA (`.project`, `.project__badge`, `.project__btn`) sont **inchangés** — seul `.project__name` s'ajoute. Capture en anglais : « Demo — Marine sheet metal » est plus long que le libellé français, le cas est donc plus dur, pas moins.

Non-fait signalé : `scripts/qa-private-badge-and-dirs.mjs` ne peut pas tourner en l'état (`waitUntil: 'networkidle'` sur `/home`, que le flux SSE des résultats ne laisse jamais atteindre ; son `BASE` par défaut pointe encore le port 3000). Défaut **préexistant** du script, sans rapport avec cette retouche — à corriger quand on migrera les scripts QA sur `data-testid` (U3).

**Pas de déploiement** : le correctif est poussé et prêt. Il part avec U3 passe 2, ou immédiatement sur un mot du vérificateur — la règle « GO puis déploiement » reste, y compris pour trois lignes de CSS.

#### U3 passe 1 — extraction pure (09/09), en attente du GO avant passe 2

`ResultModal.vue` (1 555 lignes) est découpé en **quatre** fichiers, **sans
une ligne de rendu changée** : les blocs de template sont *déplacés* (par
tranches de lignes, pas retapés) et les règles de style qui les visent
suivent avec eux.

| Fichier | Contenu | Lignes |
|---|---|---|
| `ResultModal.vue` | orchestrateur : **toute** la logique, la coquille, le pager de tôle, le bandeau et la barre de densité | 735 |
| `ResultAlternatives.vue` | onglets d'alternatives + ligne « proposée en premier » | 107 |
| `ResultViewer.vue` | bascule couleur/DXF, visionneuse (live, SVG, DXF, placeholder), plein écran, téléchargement par tôle | 251 |
| `ResultReport.vue` | bandeaux d'information, rapport complet (densité, tôles, chute, leviers unfit/partiel, badges, détails techniques), barre d'actions | 637 |

Le mécanisme qui rend l'extraction *pure* : les enfants sont **purement
présentatifs** et reçoivent un **objet unique** (`:d="bundle"`) qu'ils
re-exposent sous les mêmes noms — c'est ce qui a permis de déplacer les
templates sans les réécrire. Les écritures d'état des blocs déplacés
(mode d'affichage, plein écran, téléchargements locaux, fermeture,
intention d'export) deviennent des **événements** ; la politique d'export
(paywall D-RAP-11) reste dans l'orchestrateur, où elle a toujours été.
Le `ref` du bloc rapport est exposé par l'enfant (`defineExpose`) pour que
l'ouverture « Rapport de nesting » garde son `scrollIntoView`.

Ce qui **n'est pas** fait, et qui est la passe 2 : dialogue plein écran
deux volets, pager migré dans une barre d'outils, `UiSegmented`, slug en
bouton « Copier l'identifiant », empilement mobile, migration des
sélecteurs QA vers `data-testid`.

Verrous rejoués : `npx nuxt build` vert ; `npx vitest run` **517/517** ;
**`scripts/qa-c02c03-modal.mjs` intégralement vert** après découpe — les
dix-huit contrôles du modal passent sur un vrai calcul 900 pièces
(onglet actif « GRID Option 1 · 2 sheets · 55.4% material · offcut
543,9 × 1000 mm », densités homogènes 55,4/55,4, `whyFirst` vérifié vrai
contre les aires de chute 543 900 / 482 300 mm², barre « Material
density », « Sheet utilization » absent, badges de verdict sans post-pass,
détails techniques repliés, ligne moteur propre). C'est le contrôle qui
compte pour une extraction : les sélecteurs et le contenu sont intacts.

Pas de capture jointe : la passe 1 ne change **rien** à l'écran par
construction, une planche ne prouverait rien ; elle vient avec la passe 2,
où le rendu bouge. Pas de déploiement — attente du GO.

### U3 passe 1 — vérification (09/09, commit `2e99ddb`) : GO **suspendu à une preuve**

Rejoué par le vérificateur : harnais T-A 0,1 sur le build passe 1 (9 s, [587, 313]), puis **diff pixel** des captures de la modale contre le build précédent (`.qa-pw/e2e-p6-verif-01`, même fixture, même viewport) — la preuve que l'implémenteur n'a pas jointe :

| Capture | Pixels différents | Lecture |
|---|---|---|
| `04-modal-color.png` | 74 569 | couleurs des pièces (hash de fichier par run) + nom du zip : attendu |
| `05-modal-dxf.png` | 1 987 | nom du zip : attendu |
| `06-modal-final.png` | **279 989** | **tout le contenu de la modale est décalé de ~131 px vers le haut** : les onglets d'alternatives (« GRID Option 1 … », « Option 2 … ») et la croix de fermeture ne sont plus dans la capture ; la barre d'actions et les badges apparaissent en bas. 131 px = hauteur des deux onglets + croix |

Fichiers : `docs/qa/atelier-ui/u3-p1-verif/{06-modal-final-AVANT-p6build,06-modal-final-APRES-passe1,diff-06}.png`. Deux hypothèses, une seule est acceptable : (a) le conteneur est **scrollé** (le `scrollIntoView` du rapport, désormais déclenché depuis l'enfant, part plus tôt ou plus loin qu'avant) — c'est un changement de comportement visible, à remettre à l'identique ; (b) les onglets et la croix ne sont **plus rendus** dans cet état — régression franche (le contrôle `qa-c02c03` lit le DOM, pas l'écran, il ne l'attrape pas). Instruction : (1) dire lequel, avec le `scrollTop` du conteneur de la modale au moment de la capture et le nombre de `.alts__tab` dans le DOM ; (2) corriger pour que `06-modal-final.png` du harnais soit **pixel-identique au build précédent hors nom de zip et couleurs de pièces** (diff ≤ 3 000 pixels, tous dans les zones nom de zip / couleur) ; (3) joindre les trois captures et le chiffre. Le GO passe 1 tombe à ce constat ; la passe 2 n'ouvre pas avant.


#### Réponse de l'implémenteur (09/09) : **cas (a)**, et l'écart ne vient pas de l'extraction — il vient du harnais

**Le chiffre demandé, d'abord.** Sonde ajoutée dans le harnais juste avant
`06-modal-final.png` (`modal-state.json`), sur le build passe 1 :

```
{"alts":2,"bodyScrollTop":131,"bodyScrollHeight":1071,"bodyClientHeight":940,
 "innerPaddingTop":"48px","closeTop":-92,"firstTabTop":-53,
 "focused":"BUTTON…modal__part-download"}
```

**Cas (a) : le conteneur est scrollé.** Les onglets sont bel et bien
rendus (`alts: 2`) ; `.modal-body` porte 1 071 px de contenu pour 940 px
de hauteur et se trouve défilé de **131 px**, ce qui sort la croix
(`closeTop: -92`) et le premier onglet (`firstTabTop: -53`) du cadre. La
cause est dans le harnais, pas dans l'interface : à l'étape 9 il **clique
le bouton de téléchargement**, ce clic le focalise, et le navigateur fait
défiler le conteneur pour l'amener à l'écran.

**Ce que l'extraction n'a pas fait.** J'ai reconstruit l'image du commit
**précédent** (`dfdd0ef`, avant découpe) et rejoué le même harnais :

| Build | `modal-state.json` |
|---|---|
| `dfdd0ef` (avant extraction) | `alts 2 · scrollTop 131 · 1071/940 · closeTop −92 · firstTabTop −53` |
| `2e99ddb` (passe 1) | `alts 2 · scrollTop 131 · 1071/940 · closeTop −92 · firstTabTop −53` |

**Identiques au pixel de mesure près.** Et le diff pixel entre ces deux
runs : **1 665 pixels**, tous dans une bande unique `y 100-149`, boîte
englobante `(673, 111) → (1044, 121)` — soit 371 × 10 px : la ligne du
**nom de zip**. Rien d'autre ne bouge.

**Pourquoi la baseline montrait autre chose.** J'ai diffé la baseline du
vérificateur contre un run du **code strictement identique à celui qui l'a
produite** : **269 147 pixels** d'écart, du même ordre que les 279 989
attribués à la découpe. `06-modal-final.png` n'était donc pas
reproductible : selon que le téléchargement aboutit ou non dans le run, le
clic scrolle ou ne scrolle pas, et la capture bascule entre deux états à
131 px d'écart. Le diff « avant / après » mesurait ce tirage au sort, pas
le refactor.

**Correctif appliqué au harnais** (`scripts/qa-e2e-local-2sheets.mjs`) :
avant la capture finale, on relâche le focus et on remet `.modal-body` en
haut. La capture redevient déterministe — c'est la condition pour que la
règle « la preuve est un diff pixel » ait un sens.

**Le verrou demandé, avec le harnais stabilisé** :

| Comparaison | Pixels | Boîte | Verdict |
|---|---|---|---|
| `dfdd0ef` vs `2e99ddb`, `06-modal-final.png` | **1 396** | `(673, 242) → (1044, 252)` | **≤ 3 000**, un seul bloc de 371 × 10 px = le nom de zip |

Fichiers : `docs/qa/atelier-ui/u3-p1-verif/06-modal-final-{AVANT-dfdd0ef,APRES-2e99ddb}-harnais-stable.png`,
`diff-06-harnais-stable.png` (masque), `modal-state-{AVANT,APRES}.json`.
Sur la capture stabilisée du build passe 1, la croix et les **deux**
onglets sont à leur place.

**Ce que je retiens, et qui m'incombe** : la règle 3 est juste, et je ne
l'ai pas appliquée — j'ai écrit qu'une planche « ne prouverait rien » pour
une extraction, alors que c'est exactement là qu'elle prouve quelque
chose. Le contrôle DOM `qa-c02c03` était vert et le serait resté sur une
vraie régression de mise en page. Corollaire que j'ajoute : **une capture
de référence non reproductible n'est pas une référence** — le diff pixel
n'a de valeur qu'accompagné du contrôle que deux runs du même code
donnent la même image.

### U3 passe 1 — GO (vérificateur, 09/09, `2e99ddb` + harnais `9c4c03b`)

Cas (a) démontré par l'implémenteur et relu : sur les DEUX builds (avant découpe `dfdd0ef`, après `2e99ddb`) la modale est dans le même état (`alts: 2`, `scrollTop 131`, croix à −92, premier onglet à −53) ; le décalage venait du clic de téléchargement du harnais qui focalise le bouton et fait défiler `.modal-body` — seulement quand le téléchargement aboutit, d'où une capture de référence non reproductible (269 147 px entre deux runs du même code). Ma baseline du 08/09 était ce tirage au sort ; la faute de méthode est partagée. Harnais stabilisé (focus relâché, `scrollTop = 0`, `modal-state.json`) : diff avant / après **1 396 px, un seul bloc 371 × 10 px = nom du zip**. Capture stabilisée relue : croix et onglets en place. **GO passe 1, GO déploiement app** (badge « Démo » + extraction pure + harnais). Règle ajoutée : une capture de référence n'en est une que si deux runs du même code donnent la même image ; tout diff pixel rapporte d'abord ce contrôle.



### U3 passe 1 — GO, déployé prod (09/09)

**GO du vérificateur** sur la passe 1 (extraction pure) et sur la retouche
du badge « Démo », après relecture du diagnostic : les deux builds sont
dans le même état, l'écart venait de la capture de référence, non
reproductible. La règle est écrite : *une référence n'en est une que si
deux runs du même code donnent la même image* — le harnais la garantit
maintenant (focus relâché, `.modal-body` remise en haut avant la capture
finale).

**Déployé prod 09/09** : app seule, `ghcr.io/guiguijke/nest2d-app:latest`
digest `sha256:129cbbd229249174…`,
`NUXT_PUBLIC_GIT_COMMIT_SHA=9c4c03ba79d782a5…`, app recréée
2026-09-08T22:08:00Z ; `nesting-worker` **inchangé** (P5, 14:50:28Z), file
vide au moment du déploiement. Contenu : badge « Démo », extraction pure
U3 passe 1, harnais stabilisé.

**Contrôle en production**, colonne Projets à 240 px, en français (le cas
que le propriétaire a signalé) :

```
clair :: badge "Démo" 62px | nom 104px ellipse=true | badge dans la carte=true
```

Capture `docs/qa/atelier-ui/badge-demo-prod.png` : « Démo — Tôleri… » en
ellipse, badge « ● Démo » entier et dans la carte. La capture a été prise
avec un compte créé pour l'occasion sur la production
(`scripts/badge-demo-check.mjs` accepte `QA_EMAIL` / `QA_PASSWORD` /
`QA_REGISTER`), **supprimé juste après** (utilisateur, projets, jobs et
fichiers : `db.users.countDocuments` = 0). Aucun compte existant n'a été
touché ; l'inscription a déclenché la notification administrateur
habituelle.

#### U3 passe 2 — l'espace de résultat (09/09), première livraison

**Fait** — le dialogue est devenu un espace de travail :

| Point du plan | Livré |
|---|---|
| Plein écran à 24 px | `DialogWrapper` gagne une variante `fullscreen` (`calc(100vw − 48px)` × `calc(100vh − 48px)`), utilisée par le seul dialogue de résultat |
| Deux volets 2/3 – 1/3 | `.result-space__panes` en grille `2fr minmax(320px, 1fr)` ≥ 768 px ; **c'est le volet rapport qui défile**, jamais le dialogue (`bodyScrollTop 0`, `scrollHeight == clientHeight` mesurés) |
| Onglets d'alternatives | en tête, pleine largeur |
| Barre d'outils de la visionneuse | le pager de tôle **quitte le haut du dialogue** pour la barre ; couleur/DXF passe en `UiSegmented` ; le bouton plein écran ne flotte plus au-dessus du dessin, il est dans la barre |
| L'affichage suit son volet | plus de tailles fixes calculées sur le viewport (`width: min(620px, 78vw)`…) : la scène pilote |
| En-tête du rapport | méthode + explication + **identifiant copiable** (bouton, toast `useToast`) + densité en **grand chiffre** ; la ligne de densité qui la répétait dans le corps est retirée |
| Tableau par tôle | il **défile** dans son conteneur (`min-width: 620px` + `overflow-x: auto`) au lieu d'être rogné à droite dans le volet 1/3 |
| Mobile < 768 px | volets **empilés, visionneuse d'abord**, une seule zone de défilement (la colonne) — la première version superposait le rapport sur la visionneuse, corrigé et recapturé |
| Migration `data-testid` | `alt-tab` (+ `data-active`), `alts-why`, `result-headline`, `result-explain`, `result-density(-value)`, `report-badge` (+ `data-ok`), `report-engine`, `report-row`, `report-actions`, `view-mode-{color,dxf}` (nouvelle prop `testid` d'`UiSegmented`), `sheet-{prev,label,next}`, `viewer-{toolbar,stage,fullscreen}`, `result-area`, `result-name`, `result-report-btn` — **les deux harnais migrés dans le même commit** |
| `UiToast` | il n'était **monté nulle part** : `useToast()` n'affichait rien. Monté une fois dans `app.vue` |

**Verrous** : `npx nuxt build` vert ; `npx vitest run` **517/517** ;
`qa-c02c03-modal.mjs` **intégralement vert sur les `data-testid`** (les
dix-huit contrôles, dont la barre « Material density », l'absence de
« Sheet utilization », les badges de verdict et les détails repliés) ;
harnais principal vert, 900/900, `[587, 313]`, long task max 69 ms /
après-solve 63 ms, CLS 0,0246.

**Captures** (harnais stabilisé) : `docs/qa/atelier-ui/u3-modal-clair.png`,
`u3-modal-sombre.png`, `u3-modal-mobile.png`, `u3-rapport.png`.

**Reste à faire sur la passe 2**, énoncé sans détour — ce n'est pas fini :

1. **`CapacityPanel` réutilisé** pour le partiel / le refus : le rapport
   garde ses bandeaux `report__unfit` et `report__partial` d'origine.
2. **Zoom molette + glisser** dans la visionneuse : non implémenté (le
   plein écran et le pager le sont).
3. **Stats live en `UiStat`** (en-tête de `LiveNestingView`) : non fait.
4. **`a11y-modal-desktop.json` / `mobile`** : **aucun outil axe dans le
   dépôt** (`axe-core` / `@axe-core/playwright` absents de
   `node_modules`). Produire ces fichiers demande d'ajouter une dépendance
   de développement — décision propriétaire, je ne l'ai pas prise seul.
   Les points vérifiables sans axe (focus piégé, Échap, restitution du
   focus) sont dans `DialogWrapper` et inchangés par cette passe, mais je
   ne les ai **pas** mesurés : je ne les compte pas comme tenus.
5. Finition : « All parts are placed » flotte encore entre l'en-tête et la
   carte du rapport.

**Pas de déploiement** — attente du GO visuel. Le socle P6 (`485a491`)
partira avec.

### U3 passe 2 — GO visuel partiel (vérificateur, 09/09, `2c6995b`) ; passe 3 de finition avant déploiement

La structure est la bonne : plein écran, deux volets, le rapport défile et pas le dialogue, onglets en tête, densité en grand chiffre, mobile empilé. Verrous relus (vitest 517, `qa-c02c03` sur `data-testid`, harnais 900/900, après-solve 63 ms). **Un défaut préexistant rendu évident par la planche, et qui touche toute la prod** : le dialogue est rendu dans la police serif par défaut du navigateur. Cause lue : `global.scss` pose `font-family: $font_body` sur `.main` seulement, et `DialogWrapper` téléporte vers `body` — tout dialogue (résultats, newsletter, suppression de compte) sort du périmètre de la police. Décision a11y : **oui, ajouter `@axe-core/playwright` en dépendance de développement** (arbitrage délégué) — c'est le seul moyen de tenir les verrous 0 sérieuse écrits au plan.

**Passe 3 (un commit, GO visuel, puis déploiement app avec le socle P6)** :

1. **Police du dialogue** : `font-family: $font_body` et `color: var(--text)` posés sur `body` dans `global.scss` (la règle `.main` peut rester) ; vérifier sur la modale de résultats, la modale newsletter et le dialogue de suppression ; capture avant / après de la modale.
2. **UiSegmented** (`ui/UiSegmented.vue`) : `white-space: nowrap` sur les segments — « Color preview / DXF view » se replie sur deux lignes dans la barre d'outils.
3. **Tableau par tôle** dans le volet rapport : plus de colonne rognée (« 60. »). Sous 1 200 px de volet : colonnes `#`, Tôle, Pièces, Densité, Chute ; « Utilisé » et « Libre » passent en info-bulle ou en ligne secondaire. Aucun défilement horizontal invisible.
4. **« All parts are placed »** : ligne d'état sous la densité, alignée à gauche, en `UiBadge` succès (vert contour) — pas une phrase centrée orpheline.
5. **Partiel / refus** : `CapacityPanel` réutilisé dans le volet rapport pour `isUnfit` (leviers chiffrés), à la place du bloc `report__unfit` maison ; verrou : harnais en configuration refus (`QA_EXPECT=refusal`) capture `u3-refus.png`.
6. **Stats live en `UiStat`** dans l'en-tête de la vue live (temps, densité, layouts, cœurs), plan U2 reporté deux fois — dernière fois.
7. **Zoom molette + glisser** dans la visionneuse (borné ×0,5 – ×8, double-clic = ajuster) ; « ajuster » dans la barre d'outils.
8. **a11y** : `npm i -D @axe-core/playwright`, script `scripts/qa-a11y.mjs` (pages : home, projet, modale résultats desktop et mobile, auth) qui écrit `docs/qa/ui-pro-2026-09-07/a11y-{page}.json` ; verrou **0 violation sérieuse ou critique** ; focus piégé, Échap ferme, retour de focus au déclencheur mesurés par le même script sur la modale.
9. Captures refaites : `u3-modal-clair`, `u3-modal-sombre`, `u3-modal-mobile`, `u3-rapport`, `u3-refus`, `u3-live-stats`. Harnais deux configurations, `qa-c02c03`, `resultQuality.test.js`, md5 des SVG.

Note de méthode : pour la capture prod du badge « Démo », l'agent a créé puis supprimé un compte sur la production. Sans dommage et proprement nettoyé, mais **toute écriture en production hors déploiement se demande avant**, au propriétaire — la règle vaut pour les comptes de test comme pour le reste.


#### U3 passe 3 — finition (09/09), les neuf points

Règle de méthode acceptée en tête de passe : **toute écriture en
production hors déploiement se demande d'abord au propriétaire, comptes de
test compris.**

| Point | Livré | Preuve |
|---|---|---|
| 1. Police du corps | `font-family: var(--font-body)` + `color: var(--text)` + `line-height` posés sur **`body`** | `font-family` calculée sur `.modal-body` : **Inter** pour les trois dialogues (résultat, newsletter, suppression de projet) ; la même règle neutralisée à l'exécution rend `"Times New Roman"` — `docs/qa/atelier-ui/u3-police.json`, captures `u3-police-{avant,apres,newsletter,suppression}.png` |
| 2. Segments | `white-space: nowrap` sur `.ui-seg__opt` ; la classe morte `.view-toggle` (styles d'avant `UiSegmented`) supprimée | « Color preview / DXF view » sur une ligne, `u3-modal-clair.png` |
| 3. Tableau par tôle | **requête de conteneur** sur `.report__table-wrap` : cinq colonnes (`#`, Tôle, Pièces, Densité, Chute) sous 1 200 px de **volet**, sept au-delà ; « Utilisé » et « Libre » passent en ligne secondaire sous le format ; format compacté (`1000 × 1000 mm` au lieu de `1000 mm × 1000 mm`) ; cellules format et chute autorisées à respirer sur deux lignes | `TABLE FIT: {"wrapClientWidth":469,"tableScrollWidth":469,"overflowPx":0,"visibleColumns":["#","Sheet","Parts","Density","Offcut"]}` (`table-fit.json`) — **0 px de débordement**, plus aucune colonne rognée |
| 4. « All parts are placed » | `UiBadge` ton succès, aligné à gauche, sous la densité (`data-testid="result-state"`) ; en partiel, badge `warn` + le décompte demandé | `u3-rapport.png` |
| 5. Partiel / refus | `CapacityPanel` réutilisé dans le volet rapport, **même modèle** `capacityPanelModel` que la page projet (planchers d'espacement, garde de kerf, « ajouter une tôle » dérivé des réglages courants) ; le composant gagne `tone` (`warn` pour le partiel, Z3), `title`, `detail`, `showRetry` ; les bandeaux maison `report__unfit` / `report__partial` et leurs styles sont supprimés | harnais en configuration refus : `CAPACITY LEVERS: ["About 2 sheets needed…","About 471 parts max…","About 0 mm max spacing…"]`, actions add-sheet + retry, `u3-refus.png` |
| 6. Stats live | en-tête de `LiveNestingView` en `UiStat` : **écoulé, densité, tôles, cœurs** (le compteur de cœurs animé passe par un `slot` ajouté à `UiStat`) | `u3-live-stats.png` — `15.2s ELAPSED · 55.4% DENSITY · 2 SHEETS · ×4 CORES` |
| 7. Zoom molette + glisser | sur l'aperçu couleur (le mode DXF a la navigation de `dxf-viewer`), borné ×0,5 – ×8, zoom centré sur le curseur, double-clic ou « Ajuster » remet à plat ; **au repos aucune transformation n'est écrite** | `ZOOM: {"transformAuRepos":"none","buteeHaute":{"a":8},"apresGlisser":{"e":122,"f":46},"buteeBasse":{"a":0.5},"boutonAjuster":true,"transformApresAjuster":"none","boutonAjusterApres":0}` (`zoom.json`) — glisser de 120 × 40 px rendu exactement |
| 8. a11y | `@axe-core/playwright` en dépendance de développement, `scripts/qa-a11y.mjs` (auth, home, projet, modale desktop, modale mobile) | **0 violation, tous impacts confondus, sur les cinq pages** (`docs/qa/ui-pro-2026-09-07/a11y-*.json`) ; `a11y-modal-focus.json` : focus piégé sur 40 Tab et 10 Maj+Tab, Échap ferme, focus rendu au déclencheur |
| 9. Captures | `u3-modal-clair`, `u3-modal-sombre`, `u3-modal-mobile`, `u3-rapport`, `u3-refus`, `u3-live-stats` | toutes reprises sur le build final |

**Ce que le point 1 a réellement demandé.** La règle **ne peut pas** vivre
dans `app/assets/scss/global.scss` : ce fichier n'est pas une feuille
globale, c'est un **prélude de préprocesseur** injecté par vite
(`additionalData`) en tête de chaque bloc `<style lang="scss" scoped>`, où
le compilateur SFC suffixe le dernier sélecteur de chaque règle. `.main` y
survit parce que l'élément porte l'attribut de portée — **94 occurrences de
`.main[data-v-…]` dans le CSS bâti** ; `body` n'est l'élément d'aucun
composant, la règle serait écrite `body[data-v-…]` et ne matcherait jamais.
Elle est donc posée dans `app/assets/css/main.css`, la seule feuille
réellement globale, et `global.scss` porte le commentaire qui explique
pourquoi — c'est un piège à documenter, pas un détail de rangement.

**Ce que le point 8 a coûté, et qui n'était pas prévu.** Le premier passage
d'axe a rendu **9 violations sérieuses ou critiques**, dont aucune ne vient
de U3 : ce sont les jetons de couleur eux-mêmes. Corrigé au niveau des
jetons, en gardant la teinte :

| Jeton / surface | Avant | Après | Contraste |
|---|---|---|---|
| `--accent` (texte ET fond du bouton primaire) | `#007bff` | `#0069d9` (l'ancien `--accent-hover`) | 3,98 → **5,22** sur blanc ; 3,83 → **5,03** pour le libellé posé dessus |
| `--accent-hover` | `#0069d9` | `#0057b8` | — |
| `--text-3` | `#6d7590` | `#5f6782` | 4,40 → **5,40** |
| `--label-tertiary` (alias legacy, 44 nœuds) | `#767e9a` | `#5f6782` | 3,88 → **5,40** (et 3,52 → 4,90 sur carte en retrait) |
| Badges de verdict du rapport | `rgb(46,125,50)` | `var(--ok)` `#157036` | 4,23 → **5,09** |
| Pied de page (surface toujours sombre) | jetons du thème clair | palette explicite redéfinie sur `.footer` (AGENTS #21) | 2,11 → **10,56** |

Deux défauts de balisage avec : le compteur de quantité des fiches fichier
n'avait **aucun nom accessible** (`aria-label` ajouté), et le conteneur du
tableau qui défile n'était **pas atteignable au clavier**
(`tabindex="0"` + `role="region"`).

**Le bouton « désactivé » ne l'était pas.** `MainButton` ne posait que la
classe `button--disabled` (`pointer-events: none`) : la souris était
bloquée, mais le bouton restait dans l'ordre de tabulation, activable au
clavier, et annoncé actif par un lecteur d'écran. L'attribut `disabled`
(ou `aria-disabled` + `tabindex="-1"` sur un `<a>`) est désormais posé.
Effet de bord mesuré : le harnais, qui lisait `isDisabled()`, cliquait
depuis la passe 2 sur une flèche « tôle suivante » morte et perdait
**30 s par clic** — 16 captures au lieu de 4 et six minutes de banc pour
rien. Corrigé des deux côtés (attribut + lecture de la classe en secours).

**Le refus n'était pas détectable par le harnais.** `QA_EXPECT=refusal`
attendait `.content__error`, que `[slug].vue` ne rend justement **pas**
quand le panneau de capacité s'affiche (`v-if="localComputeError &&
!capacityPanel"`) : un refus déjà à l'écran partait en **721 s de timeout**.
Le harnais lit maintenant `[data-testid="capacity-panel"]` — refus détecté
en **2,2 s**.

**Verrous rejoués sur le build final** : `npx nuxt build` vert ;
`npx vitest run` **517/517** (dont `resultQuality.test.js` inchangé) ;
`qa-c02c03-modal.mjs` **intégralement vert** ; `qa-a11y.mjs` **GO** ;
harnais **deux configurations** — espacement 0,1 (900/900, long task max
65 ms, CLS 0,0278) et espacement 2 (900/900, long task max 70 ms, CLS
0,0269), `bodyScrollTop 0` et `scrollHeight == clientHeight` dans les deux.

**md5 des SVG de tôle** : les empreintes **diffèrent**, et il faut le dire
précisément — chaque passage du harnais crée un projet neuf, donc des
slugs de fichiers neufs, donc une **palette de pièces** différente. Mesure
faite fichier par fichier entre les deux builds : **587 / 587 attributs
`d` identiques**, **587 / 587 `transform` identiques**, taille d'octets
identique ; le seul écart porte sur `fill` / `stroke`. C'est exactement
l'exclusion « hors nom de zip et couleurs de pièces » déjà actée en passe 1.
La géométrie exportée n'a pas bougé.

**Non-faits, énoncés :**

1. Le `CapacityPanel` du **volet rapport** (cas `isUnfit` / `isPartial`)
   n'a **pas** été vu à l'écran : produire un résultat non découpable ou
   partiel sur commande n'est pas à ma portée avec le corpus de banc. Le
   composant et son modèle sont vérifiés par la configuration refus de la
   page ; le branchement dans le rapport est relu, pas capturé.
2. Le thème sombre n'est **pas** passé à axe (le script audite le thème
   clair) — `u3-modal-sombre.png` reste une relecture à l'œil.
3. `playwright` n'est toujours **pas** déclaré dans `package.json` (il
   était déjà installé hors verrou) : seul `@axe-core/playwright` l'est.
   Le déclarer ferait télécharger les navigateurs à chaque build d'image
   (`npm install` en étape de build) — arbitrage à trancher à part.
4. Résidu de charte noté pour U4 : les badges de verdict du rapport et le
   badge de la vue live gardent `--radius-l` (8 px) alors que la charte
   pose 2 px pour les badges — non touché ici pour ne pas brouiller la
   comparaison visuelle de cette passe.

**Pas de déploiement** — attente du GO visuel. Le socle P6 (`485a491`)
part avec.
