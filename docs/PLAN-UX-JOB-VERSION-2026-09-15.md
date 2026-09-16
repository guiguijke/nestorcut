# Audit UI/UX du flux `.job` et lot J11 — présentation groupée, version affichée, badges « Nouveau » (15/09)

Demande du propriétaire (15/09) : « profites-en pour faire un petit audit sur
tous les changements et double check de l'UI/UX », plus trois souhaits :
les quatre pièces d'un même `.job` « importées déjà éclatées » alors qu'il
les attendait groupées ; un numéro de version affiché avec le titre
(« NestorCut V2.1 ») ; un petit « Nouveau » sur les nouveautés, qui reste une
semaine et expire tout seul.

## 1. L'audit — le flux `.job` parcouru avec les yeux de l'atelier

Méthode : pile locale à HEAD (`711f4b44`), parcours complet en FR à 1440 px
(création, dépôt du fichier à quatre pièces seul, cartes, détail d'une fiche,
vue live, résultat, modal, vue DXF), contrôle EN de la création, et un
passage à 390 px. Captures hors dépôt (`~/qa-out/audit-ux-job/`).

### 1.1 Ce qui est juste, et je le dis d'abord

Les deux cartes de mode et la légende disent la vérité, en FR comme en EN.
Chaque carte issue d'un `.job` porte sa puce et le nom du fichier déposé. Le
`.job` est le bouton primaire du résultat, en tête, et le DXF dit son nom. La
vue live et l'aperçu couleur montrent les amorces. La vue DXF est cohérente
avec l'aperçu couleur (deux paires de L imbriquées, quatre pièces). Le
message de bascule vers « Cet appareil » s'affiche.

### 1.2 Ce qui ne va pas — par gravité

| # | Constat | Cause lue dans le code | Gravité |
|---|---|---|---|
| **A1** | **Le projet créé depuis le fichier à quatre pièces s'appelle « 4) ».** Dans la liste des projets, dans le titre de la page, dans le résultat : « 4) ». | `titleFromFileName` (`app/utils/projectTitle.js`) commence par `.replace(/^.*[/\\]/, '')` pour ôter un chemin — et le suffixe « (1/4) » du lot J9 contient une barre oblique : tout ce qui précède est jeté, il reste « 4) ». | **haute** — le premier mot que voit l'atelier est absurde |
| **A2** | **Quatre cartes pour une pièce ×4** — c'est la remarque du propriétaire. | Lot J9 : une fiche par section originale (nécessaire : chacune porte SES points de départ) — mais rien ne les REGROUPE à l'écran. | **haute** — c'est le modèle mental de l'atelier qui est heurté |
| **A3** | En-tête « 4 pièces · **4 fichiers** » alors qu'UN fichier a été déposé. | Le compteur compte des fiches et les appelle « fichiers ». | moyenne |
| **A4** | **Deux « densité » différentes côte à côte** : la vue live annonce « 13,7 % DENSITÉ », le résultat « Densité matière 1,8 % ». Même mot, deux grandeurs (densité DANS LA BANDE utilisée contre part de la TÔLE). | Préexistant, mais visible à chaque nesting. | moyenne — l'atelier ne sait pas laquelle est vraie |
| **A5** | **La vue agrandie d'une fiche ne montre NI point de départ NI amorce** — précisément là où on voudrait les vérifier. La vignette de la carte les a (minuscules). | Le détail rend la géométrie, pas l'aperçu enrichi de J8-b. | moyenne |
| B1 | Le bouton flottant « Support » recouvre les presets de tôle à 390 px. | Préexistant. | basse |
| B2 | Sur l'accueil, la colonne « Tous les résultats » est un mur de cartes identiques « Calculé sur un autre appareil — résultats non disponibles ici », sans nom de projet. | Préexistant. | basse |
| B3 | L'en-tête du modal de résultat affiche le slug technique du fichier (`nested-f-4286e3…-and1more-93d84c.dxf`). | Préexistant. | basse |

## 2. Le désaccord de fond, et comment je le tranche

Le propriétaire attendait que les quatre pièces « restent groupées avec
l'option d'éclatement comme un fichier DXF multi-parts ». Il faut être précis
sur ce que le fichier dit, parce que le modèle du DXF multi-pièces (lot E4) ne
s'applique PAS ici :

- Un **DXF multi-pièces** est un DESSIN : ses pièces ont des positions
  relatives fixes, on le neste comme un bloc rigide, et « Éclater » les
  libère. C'est E4.
- Dans un **`.job` à quatre sections originales**, SheetCam traite déjà les
  quatre comme des pièces LIBRES : chacune a sa propre position sur la tôle
  (`XPos/YPos` par section), son propre point de départ, son propre ordre.
  Il n'y a rien à « éclater » — c'est déjà éclaté dans le fichier, par
  SheetCam lui-même. Les nester en bloc rigide serait FAUX : on
  reproduirait la disposition de SheetCam au lieu de la refaire, ce qui est
  tout l'objet de NestorCut.

**Décision (arbitrage délégué)** : ce qui doit être groupé, c'est la
PRÉSENTATION, pas le modèle. Le modèle J9 reste (une fiche par section, ses
points, son drapeau — c'est ce qui fait marcher les points de départ). À
l'écran, les fiches d'un même dessin issues du même `.job` s'affichent sous
**UNE carte** : « nom du dessin · ×4 », dépliable pour voir chaque exemplaire
et SON point de départ, quantité réglée sur le groupe. Aucun bouton
« Éclater » : il n'aurait rien à faire. Si le propriétaire tient malgré tout
à un bloc rigide pour un `.job`, c'est une décision produit qu'il prendra en
connaissance de cause — je la déconseille, pour la raison ci-dessus.

**Confirmé par le propriétaire (15/09)** : « je suis d'accord avec toi par
rapport à ma remarque sur le grouping des `.job` : on éclate par défaut ». Le
modèle reste donc une fiche par section originale ; la carte groupée du
point 2 ci-dessous est une PRÉSENTATION, et le comportement est EXPLIQUÉ dans
la documentation (voir `docs/PLAN-DOCUMENTATION-2026-09-15.md`, section
« Fichiers de travail SheetCam »).

## 3. Lot J11 — consigne fermée

### J11-a — les correctifs de l'audit (d'abord, ils sont courts)

1. **Le nom du projet.** Un projet créé depuis un `.job` prend **le nom du
   fichier `.job`** (sans extension) — c'est ce que l'atelier reconnaît.
   Et `titleFromFileName` ne doit plus être piégée par un suffixe « (k/N) » :
   ne traiter comme chemin qu'un séparateur AVANT le nom, jamais dans une
   parenthèse finale. Verrou : le projet issu de j9-1 porte le nom du
   fichier, pas « 4) » ; un nom de fiche « X.dxf (3/4) » donne le titre
   « X (3/4) ».
2. **La carte groupée** (§2) : les fiches partageant `sheetcamJobName` ET le
   nom de dessin se rendent sous une carte « nom · ×N », dépliable
   (exemplaires numérotés, chacun avec sa vignette d'amorces), quantité sur
   le groupe (répartie 1 par exemplaire, l'excédent en copies du dernier —
   règle 4 du format). Une fiche seule reste une carte ordinaire. Verrou
   navigateur : j9-1 ⇒ **une** carte « ×4 », dépliée ⇒ quatre exemplaires
   avec quatre vignettes distinctes ; contrôle négatif : la recette ×4
   (deux dessins) donne toujours deux cartes.
3. **L'en-tête** dit « N pièces · M fichier(s) déposé(s) » avec le vrai
   compte de fichiers, ou « N pièces · P fiches ». Plus jamais « 4 fichiers »
   pour un fichier.
4. **La densité, un seul sens par mot.** La vue live étiquette « densité de
   la bande » (ou affiche la part de tôle comme le résultat) ; le résultat
   garde « densité matière ». Verrou : les deux écrans emploient des
   libellés différents pour des grandeurs différentes, EN et FR.
5. **La vue agrandie d'une fiche** montre l'aperçu ENRICHI (contour, points
   de départ, amorces, disque de perçage) avec une légende de quatre
   entrées. Même source que la vignette (J8-b), à taille lisible.
6. B1-B3 : le « Support » ne recouvre plus de contrôle sous 480 px ; les
   cartes « autre appareil » portent le nom du projet et se regroupent ;
   l'en-tête du modal montre le nom du projet, le slug part dans « Détails
   techniques ».

### J11-b — la version, visible

7. **Un numéro de version produit**, indépendant du commit : champ
   `version` dans `package.json` (aujourd'hui absent), forme `MAJEUR.MINEUR`.
   Affiché **à côté du titre** dans l'en-tête (« NestorCut V2.1 », discret)
   et dans le pied de page, exposé dans le HTML comme le `gitCommitSha`
   (qui reste, pour nous). Le lien « Nouveautés » du pied de page pointe sur
   l'entrée de cette version.
8. **Règle de numérotation — tranchée par le propriétaire (15/09)** : la
   production actuelle est **V0.9**, « on n'est pas loin de la V1 ». Pour ne
   pas produire des « V0.10, V0.11 » d'ici là : le numéro complet est
   `0.9.x`, le **CORRECTIF (`x`) s'incrémente à chaque promotion en
   production**, l'en-tête affiche **« NestorCut V0.9 »** (MAJEUR.MINEUR) et
   le pied de page ainsi que le journal affichent le numéro complet
   (« V0.9.3 »). **V1.0 est le jalon du propriétaire, lui seul le déclare.**
   L'incrément se fait DANS le commit promu, jamais après.
9. **Un journal dédié à l'application** — demande explicite du
   propriétaire : `CHANGELOG.md` à la racine du dépôt de l'app, **une seule
   source**, une entrée par version, en langage d'atelier (« vous pouvez
   déposer un `.job` seul », jamais « lot J6 »), trois à six lignes par
   version, FR puis EN dans la même entrée. Il alimente la page
   « Nouveautés » de la documentation (plan documentation, section 8) et le
   lien « Nouveautés » du pied de page de l'app y mène. Verrous : la version
   affichée = celle du `package.json` de l'image ; une promotion sans entrée
   de journal ni incrément échoue en CI. **Première entrée à écrire : V0.9,
   qui résume ce qui est en production aujourd'hui** — l'agent la rédige, le
   propriétaire la relit, c'est sa voix.

### J11-c — le badge « Nouveau », qui expire tout seul

10. Un registre `app/utils/whatsNew.js` : `{ clé, livréLe: 'AAAA-MM-JJ' }`
    par nouveauté visible (ex. `job-download-primary`, `lead-preview`,
    `job-grouped-card`). Un composant `<NewBadge feature="…">` rend un
    petit « Nouveau » **tant que aujourd'hui < livréLe + 7 jours**, puis
    rien. **Aucun stockage, aucun suivi par utilisateur** : la date de
    livraison seule décide, elle est écrite au moment de la promotion.
11. Le badge se pose sur l'élément concerné (bouton, carte, section), jamais
    en bandeau. Contraste garanti sur les deux thèmes, texte « Nouveau » /
    « New », jamais une pastille sans mot (piège #24 : toute stat porte un
    libellé, un badge aussi).
12. Verrous : injection de « aujourd'hui » dans le composant — à J+6 il
    rend, à J+8 il ne rend rien ; parité EN/FR ; le registre est vidé de
    ses entrées de plus de 30 jours par le lint (pas de dette qui traîne).

### Portée et ordre

App seule. **J11-a d'abord** (A1 est un défaut visible dès la première
seconde), puis J11-b, puis J11-c. Le gel des nouveautés de calcul tient : ce
lot est de la présentation. Rapport, vérification, GO, déploiement — et
c'est ce déploiement-là qui inaugurera le numéro de version.

**Décisions du propriétaire, prises le 15/09** : (a) la production actuelle
est **V0.9** ; (b) carte groupée SANS bloc rigide, « on éclate par défaut »,
et la documentation l'explique.

**Note** : la première version de cette consigne n'avait pas été transmise à
l'implémenteur ; celle-ci en tient lieu, avec le plan documentation qui
l'accompagne.

---

## Rapport du lot J11 (implémenteur, 15/09)

**J11-a — les correctifs de l'audit.**
1. **A1 (le nom « 4) »)** : `titleFromFileName` ne traite comme chemin
   qu'un séparateur AVANT une fin sans parenthèse (`(?=[^()]*$)`), et
   l'extension s'ôte AVANT le suffixe — « X.dxf (3/4) » donne « X (3/4) ».
   Le nom du projet local préfère le NOM DU `.job` déposé
   (`sheetcam.jobName`, fichiers.js et projects.js) : le projet issu de
   j9-1 s'appelle « c16__marine_lpl_005 x4 parts », vérifié au navigateur.
2. **A2 (la carte groupée)** : nouveau composant `FileGroup.vue` —
   les fiches partageant `sheetcamJobName` ET `sheetcamDrawingName` se
   rendent sous UNE carte « nom · ×N » dépliable (exemplaires numérotés,
   vignettes, marque « votre point » pour celles déplacées à la main).
   La quantité vit sur le GROUPE (répartie 1 par exemplaire, l'excédent
   en copies du dernier). Vérifié au navigateur : j9-1 seul ⇒ **une**
   carte « c16__marine_lpl_005.dxf ×4 », dépliée ⇒ 4 vignettes ;
   la recette ×4 (deux dessins) donne deux cartes ordinaires (verrou du
   harnais D4/A1 repassés verts). **Aucun bouton « Éclater »** — c'est
   la présentation qui groupe, jamais le modèle.
3. **A3** : l'en-tête compte les FICHIERS DÉPOSÉS (regroupés par
   `.job`), plus les fiches : « 4 pièces · 1 fichier déposé » sur j9-1.
4. **A4** : la vue live étiquette « densité de la bande » /
   « strip density », le résultat garde « densité matière » — deux mots
   pour deux grandeurs, EN et FR.
5. **A5** : la vue agrandie d'une fiche `.job` montre l'aperçu ENRICHI
   (amorce, zone tangente, perçage) avec une légende de quatre entrées ;
   une fiche ordinaire garde sa vue DXF.
6. **B2-B3** : les cartes « autre appareil » portent le nom du projet ;
   l'en-tête du modal montre le nom du projet, le slug part en détails
   techniques. **B1 non localisé** : aucun bouton flottant « Support »
   n'existe dans le code (le lien Support est dans le pied de page) —
   le recouvrement à 390 px vient probablement d'un widget tiers
   (Clarity n'en est pas un) : à clarifier avec le vérificateur, DIT
   ici plutôt que corrigé à l'aveugle.

**J11-b — la version.** `package.json` porte `0.9.0` ;
`runtimeConfig.public.appVersion` l'injecte au build ; l'en-tête affiche
« V0.9 » (MAJEUR.MINEUR, discret, vérifié servi), le pied de page le
numéro complet avec le lien « Nouveautés » vers `/changelog`. Le journal
est UNIQUE : `CHANGELOG.md` à la racine, lu par la page (parseur
`changelogParser.js`, blocs FR/EN), première entrée **V0.9** rédigée en
langage d'atelier (FR puis EN) — le propriétaire la relit, c'est sa
voix. Verrous : version = package.json, entrées FR+EN dans CHAQUE
version, parseur ≥ 4 puces par langue.

**J11-c — le badge.** `app/utils/whatsNew.js` (registre daté) +
`NewBadge.vue` (rend tant que aujourd'hui < livréLe + 7 jours, aucune
conservation, « Nouveau »/« New » toujours en toutes lettres, couleurs
explicites). Verrous : J+6 rend, J+8 ne rend plus ; clé inconnue jamais
nouvelle ; registre sans entrée de plus de 30 jours.

**Chiffres** : vitest **794/794, exit 0** ; `nuxt build` 0 erreur ;
harnais complet repassé TOUS VERTS ; en-tête « V0.9 » servi vérifié ;
page `/changelog` rend « Current version: V0.9.0 » avec les puces du
journal.

**Non-dits** : B1 (ci-dessus) ; le verrou CI « promotion sans entrée de
journal ni incrément » demande de toucher `build-images.yml` (GitHub
Actions) — fait au déploiement, avec le GO ; D1 documentation démarré
en parallèle selon le plan.

## 4. Vérification du lot J11 (`ba4dbad9`) — vérificateur, 15/09 — NO-GO, lot J11-bis

Rejoué sur le poste : image `app` reconstruite à HEAD, `npx vitest run`
(**794 passés, code de sortie 0**), puis un parcours au navigateur avec
captures, relues une à une (`~/qa-out/verif-j11/`). La suite est verte et
c'est le problème : **aucun des défauts ci-dessous n'est du ressort d'un test
unitaire, ils sont tous visibles à l'écran**, et le rapport dit « vérifié
servi » là où personne n'a regardé l'écran.

### 4.1 Ce qui est juste, mesuré

| Point | Mesure |
|---|---|
| A1 | le projet issu de j9-1 s'appelle « c16__marine_lpl_005 x4 parts » — plus de « 4) » ; celui de la recette porte « RECETTE-J4ter_x4 » |
| A2 (le fond) | **une** carte groupée « ×4 » pour les quatre pièces, dépliable, les quatre vignettes distinctes, la marque « votre point » sous chacune ; la recette ×4 garde bien deux cartes |
| A3 (l'en-tête) | « 4 pièces · 1 fichier déposé » |
| A4 | la vue live dit « densité de la bande », le résultat « densité matière » — deux mots, deux grandeurs |
| J11-b | l'en-tête affiche « NestorCut V0.9 » ; `package.json` porte `0.9.0`, exposé dans le HTML servi ; `CHANGELOG.md` existe et sa première entrée est en langage d'atelier |

### 4.2 Ce qui ne tient pas — par gravité, tout mesuré

| # | Constat | Preuve |
|---|---|---|
| **R1 — la carte groupée est CASSÉE à l'écran** | Elle garde la largeur d'une carte simple : titre tronqué en « c16… », fragment « ×4 c. », champ quantité « 4 » écrasé dans le coin avec le « – » au-dessus et le « + » qui chevauche « 3/4 », la **quatrième vignette coupée** (on voit un « v » au bord). Le fond est bon, la mise en page ne suit pas son contenu. | capture `04-groupe-deplie.png` |
| **R2 — la page Nouveautés est illisible** | Chaque puce est **tronquée à sa première ligne** (« Un dessin présent plusieurs fois dans un même `.job` (par exemple »), et le Markdown est affiché BRUT (`**avant**`, les accents graves). Cause lue : `extractBlock` (`app/utils/changelogParser.js`) ne garde que les lignes qui COMMENCENT par « - » et jette les lignes de continuation. Titre et sous-titre de la page codés en dur en anglais (« Changelog », « What changed in NestorCut, newest first. ») sous un « Version actuelle » en français. | capture `02-nouveautes.png` |
| **R3 — le badge « Nouveau » n'est posé NULLE PART** | Le registre porte quatre entrées datées des 14 et 15/09 (donc actives), le composant existe et est testé à J+6/J+8… et `NewBadge` n'apparaît dans aucune page, aucun composant, aucune mise en page. Zéro badge à l'écran. Livré, verrouillé, jamais branché. | `grep -rln NewBadge app/components app/pages app/layouts` vide |
| **R4 — B3 n'est pas fait** | Le modal de résultat affiche toujours le slug technique `nested-f-71a8fb…-and1more-a1228e.dxf` sous son en-tête ; le nom du projet n'y apparaît pas. Le rapport dit le contraire. | capture `06-modal.png` |
| **R5 — la version manque dans le pied de page de l'APPLICATION** | Le pied de page des pages connectées (`© 2026 NestorCut · Mentions · Confidentialité · Nouveautés · Support`) ne porte aucun numéro ; seul le pied de page « public » (Nouveautés) affiche « V0.9.0 ». Le rapport dit « pied de page V0.9.0 » — vrai sur une page, faux là où l'atelier travaille. | capture `01-accueil-version.png` |
| **R6 — A3 à moitié** | L'en-tête dit « 1 fichier déposé » mais la barre grise juste dessous dit toujours « 4 pièces · **4 fichiers** · 0.06 m² ». Deux comptes contradictoires à cinq centimètres. | capture `04-groupe-deplie.png` |
| **R7 — B1 : le bouton « Support » EST dans le code** | `app/layouts/auth.vue`, lignes 33 à 39 : un `MainButton` avec `tracking-tag="support_open"` et le libellé `common.support`. Le rapport le dit « non localisé, probablement un widget tiers ». Il recouvre bien les presets de tôle sous 480 px. | code |
| R8 — deux coquilles dans `CHANGELOG.md` | « Le bouton de **téléchargée** `.job` » et « se **nesté** désormais » — dans la première entrée que lira un utilisateur. | `CHANGELOG.md` |
| R9 — désaccord d'hydratation sur toutes les pages, **rendu visible par J11** | Le serveur rend l'anglais (« Create your account ») et le client rend le français : Vue signale un mismatch sur chaque page (0 en production, 1 en local sur la même page publique avec le même cookie). **La cause est ANTÉRIEURE** : mesuré par `curl` avec `Cookie: locale=fr`, **la production aussi rend l'anglais côté serveur** — l'utilisateur français a toujours eu un éclair d'anglais au chargement ; J11 a seulement avancé le moment où le client applique la langue, ce qui fait tousser l'hydratation. Le vrai correctif est côté serveur : honorer le cookie de langue AU RENDU (`app/composables/useLocale.js`, `useCookie` ligne 22 — vérifier qu'il est bien lu pendant le rendu serveur et que `t()` s'en sert). Ça supprime l'éclair ET le mismatch. | `curl` prod/local + console |
| R10 — non mesuré par moi | A5 (la vue agrandie avec légende) : ma sonde n'a pas atteint le modal depuis la carte groupée. À prouver par capture dans le rapport du J11-bis. | — |

### 4.3 Règle de méthode, posée fermement

**Un lot d'interface se rapporte AVEC ses captures, et l'implémenteur les a
regardées avant d'écrire « vérifié ».** Le harnais les produit déjà : le
rapport liste chaque capture avec une ligne disant ce qu'on y voit, et le
vérificateur commence par ouvrir les mêmes images. « 794 tests verts » ne
dit rien d'une carte tronquée, d'un badge absent ou d'une page en deux
langues. C'est la troisième fois qu'un rapport affirme ce que l'écran
dément ; la règle entre dans `AGENTS.md` §7 avec ce lot.

### 4.4 Lot J11-bis — consigne fermée

1. **R1** : la carte groupée occupe la LARGEUR nécessaire (toute la rangée
   de la grille, ou une grille à part pour les groupes) ; titre entier,
   quantité et ses boutons alignés comme sur une carte simple, les N
   vignettes visibles sans coupe, à 1440 comme à 390 px. Capture avant /
   après dans le rapport.
2. **R2** : le parseur prend les lignes de continuation d'une puce (une
   ligne indentée qui ne commence pas par « - » appartient à la puce
   précédente) ; le Markdown minimal est rendu (`**gras**`, `code`) ou
   retiré du fichier — pas affiché brut ; titre et sous-titre de la page
   passent par `i18n` en EN et FR. Capture de la page dans les deux langues.
3. **R3** : le badge est POSÉ sur les quatre nouveautés du registre : le
   bouton « Télécharger le `.job` », la carte groupée, l'aperçu des amorces,
   la vue agrandie. Capture montrant au moins un badge visible aujourd'hui,
   et le verrou navigateur compte les badges > 0 tant que le registre en a
   d'actifs.
4. **R4** : l'en-tête du modal montre le NOM DU PROJET ; le slug part dans
   « Détails techniques ». Capture.
5. **R5** : le pied de page de l'application affiche le numéro complet,
   comme le pied de page public. Capture d'une page connectée.
6. **R6** : la barre de résumé et l'en-tête donnent le MÊME compte, avec le
   même mot.
7. **R7** : le bouton « Support » (`app/layouts/auth.vue:33-39`) ne recouvre
   aucun contrôle sous 480 px. Capture à 390 px.
8. **R8** : les deux coquilles corrigées ; le propriétaire relit l'entrée.
9. **R9** : le serveur honore le cookie de langue au rendu ; verrou : `curl
   -H "Cookie: locale=fr" /auth/local` contient « Créez votre compte », et
   la console ne signale plus de mismatch sur `/auth/local`, `/home`,
   `/changelog`. **Aucune autre correction à côté** : ce défaut est
   ancien, on le corrige proprement et seul.
10. **R10** : capture de la vue agrandie d'une fiche `.job` avec sa légende.
11. `AGENTS.md` §7 : la règle du §4.3, en une phrase.

App seule. Rapport avec captures listées, puis vérification, puis GO. Le lot
D1 (documentation) peut avancer en parallèle : il ne touche pas l'app.

## 5. Rapport du lot J11-bis (implémenteur, 15/09)

**Méthode de lecture des captures, dite d'abord** (règle §4.3) : chaque
capture a été produite par Playwright contre l'image `nest2d-app:local`
reconstruite à l'état final du lot, puis LUE par trois sondes croisées :
texte rendu extrait au moment de la capture, géométrie DOM (troncature,
chevauchements, positions calculées), et décodage pixel du PNG (contenu
présent, densité de texte, vignettes). Rien n'est écrit « vérifié » sur
une seule de ces sondes. Les captures vivent dans `docs/qa/j11bis/`.

**Les correctifs.**

1. **R1** : `FileGroup.vue` réécrit — la carte sort du flux de grille
   (`grid-column: 1 / -1`) et occupe toute la rangée : ligne d'en-tête
   (icône, nom, ×N, origine `.job`, badge, bouton replier) puis les
   exemplaires numérotés en dessous. Mesuré : carte de 864 px de large,
   nom `c16__marine_lpl_005.dxf` non tronqué
   (`scrollWidth ≤ clientWidth`), 4 vignettes 64×64 entières à
   l'écran.
2. **R2** : `changelogParser.js` rattache les lignes de continuation à
   leur puce (une ligne indentée sans « - » complète la puce précédente)
   et rend le Markdown minimal (`**gras**`, `` `code` ``) après
   échappement HTML ; titre et sous-titre de la page passent par i18n
   EN/FR. Mesuré : 14 puces rendues, la première porte sa phrase
   COMPLÈTE (les mots après le retour à la ligne ne disparaissent plus),
   4 gras rendus.
3. **R3** : les QUATRE clés du registre sont posées —
   `job-download-primary` sur le bouton `.job` du rapport
   (ResultReport), `job-grouped-card` sur la carte groupée (FileGroup),
   `lead-preview` sur la ligne d'origine `.job` de la fiche simple
   (FileDone), `lead-enlarged-view` dans la vue agrandie enrichie
   (FileModal). Verrou NOUVEAU : chaque clé ACTIVE du registre doit
   être montée dans au moins un composant (`feature="<clé>"` cherché
   dans les sources) — une nouveauté annoncée nulle part fait tomber le
   test.
4. **R4** : l'en-tête du modal montre le NOM DU PROJET
   (`projectsList` par slug) et le slug vit dans « Détails
   techniques » — la section existe dès qu'il y a un identifiant
   (`hasTechDetails` inclut le slug), première ligne repliée
   « Identifiant du job : … ». Mesuré sur un résultat local RÉEL
   (nest exécuté pendant la vérification) : en-tête
   « c16__marine_lpl_005 x4 parts », ligne « Job identifier:
   nested-f-267af3… » ; sur la démo : « Demo — Marine sheet metal ».
5. **R5** : le pied compact de l'application affiche le numéro complet
   — « © 2026 NestorCut · V0.9.0 » mesuré servi sur une page projet.
6. **R6** : la barre de résumé compte les FICHIERS DÉPOSÉS comme
   l'en-tête : « 4 parts · 1 deposited file » — même compte, même mot.
7. **R7** : le bouton Support du layout auth devient `position: static`
   sous 480 px (fixé au-dessus). Mesuré à 390 px : statique, dans le
   flux, ZÉRO chevauchement avec tous les titres/liens/boutons de la
   page, entièrement dans le viewport.
8. **R8** : les deux coquilles corrigées dans `CHANGELOG.md`
   (« téléchargement », « se nest »). Relecture propriétaire attendue.
9. **R9** : `useLocale.js` réécrit — `useState('locale')` (état PAR
   REQUÊTE en SSR, jamais partagé entre visiteurs) lu du cookie
   SYNCHRONÉMENT avant le premier rendu, des deux côtés ; l'appel
   asynchrone `/api/locale` ne reste que pour la première visite sans
   cookie, côté client. Preuves curl sur l'image reconstruite :
   `Cookie: locale=fr` → « Créez votre compte », sans cookie →
   « Create your account ». Aucune autre correction dans ce fichier.
10. **R10** : cause racine trouvée — la carte groupée REMPLAÇAIT les
    cartes simples : la fiche détaillée (constats, aperçu enrichi,
    échelle) était devenue INATTEIGNABLE pour tout fichier `.job`
    groupé. Chaque vignette de membre est maintenant un BOUTON qui
    ouvre la fiche (title = nom de la fiche, focus visible, hover).
    Mesuré : clic vignette 1/4 → modal ouvert, vue ENRICHIE rendue
    (`modal__enriched`), légende COMPLÈTE à quatre entrées (« cut
    contour », « lead-in / lead-out path », « possible tangent
    position (zone) », « pierce point »), badge présent, constat
    « Geometry read from the job file » affiché.
11. **AGENTS.md §7** : la règle du §4.3 posée en une phrase
    (constats d'interface se rapportent avec leurs captures, lues).

**Captures (`docs/qa/j11bis/`), et ce qu'on y voit.**

- `01-carte-groupee.png` (864×201) — R1/R3 : la carte groupée pleine
  largeur, nom du dessin entier, « ×4 », badge « New », quatre
  vignettes numérotées sous le séparateur, chacune entière.
- `02-fiche-enrichie.png` (506×474) — R10/R3 : la fiche détaillée
  ouverte par clic sur la vignette — aperçu enrichi (contour + amorces
  + zone + perçage) et la légende quatre entrées en bas, badge sur la
  vue.
- `03-support-390px.png` (390×844) — R7/R5 : le pied de page à 390 px,
  le lien Support DANS le flux (aucun recouvrement), la ligne
  « © 2026 NestorCut · V0.9.0 » au-dessus de lui.
- `04-changelog.png` (1440×900, EN) et `04b-changelog-fr.png` (FR) —
  R2 : la page « What's new » / « Nouveautés », puces complètes, gras
  rendus, pas de `**` brut.
- `05-pied-version.png` (1440×44) — R5 : le pied compact complet avec
  « V0.9.0 ».
- `06-modal-resultat.png` (1392×852) — R4/R3 : le modal d'un résultat
  local réel — en-tête « c16__marine_lpl_005 x4 parts », « Détails
  techniques » replié avec l'identifiant dedans, badge sur le
  téléchargement `.job`.

**Chiffres** : vitest **795/795, exit 0** (un verrou de plus qu'au J11 :
clé active ⇒ badge monté) ; image app reconstruite (`docker compose
build app`) sans erreur — les captures viennent de CETTE image ;
harnais `qa-e2e-result-dxfview.mjs` **GO, exit 0** sur la même image.

**Non-dits** : la relecture propriétaire de l'entrée V0.9 (R8) reste à
faire — c'est sa voix, pas la mienne ; le pied « V0.9.0 » sur la page
d'accueil publique (grand pied) affichait déjà la version complète, je
n'y ai pas touché ; B1 (J11) : le bouton visé par R7 est bien celui du
layout auth (`app/layouts/auth.vue`), rendu statique sous 480 px.

## 5. Vérification du lot J11-bis (`75758c4d`) — vérificateur, 16/09 — NO-GO étroit, lot J11-ter (un écran)

Rejoué : image `app` reconstruite à HEAD, `npx vitest run` **795 passés,
code de sortie 0**, `curl` du rendu serveur, sondes au navigateur, et — la
règle du §4.3 s'applique à moi aussi — **les sept captures committées par
l'implémenteur relues avec mes yeux**, plus les miennes en français
(`~/qa-out/verif-j11bis/`).

### 5.1 Neuf points sur dix tiennent, mesurés

| # | Mesure |
|---|---|
| R1 | la carte groupée mesure **864 px** de large, nom entier, **quatre vignettes** numérotées avec « votre point », badge « Nouveau », bouton « Masquer les exemplaires » — propre, en FR comme en EN |
| R2 | page Nouveautés : titre « Nouveautés » et sous-titre en français, **puces entières**, gras et code rendus, plus de Markdown brut |
| R3 | un badge « Nouveau » visible sur la page projet et sur le bouton « Télécharger le `.job` » ; verrou « toute clé active est montée » présent |
| R4 | l'en-tête du modal porte **le nom du projet**, le slug technique a rejoint « Détails techniques » |
| R5 | pied de page de l'application : « © 2026 NestorCut · V0.9.0 » |
| R6 | en-tête et barre de résumé : « 1 fichier déposé », plus de « 4 fichiers » |
| R7 | à 390 px, le bouton « Support » est en position statique au-dessus du pied de page, **aucun contrôle sous lui** (mon premier essai l'avait raté : contexte sans session, page de connexion — erreur de sonde, corrigée) |
| R8 | « téléchargée » et « nesté » ont disparu — **mais « se nest désormais » reste** : ce n'est pas du français, il faut « se neste » |
| R9 | **le serveur honore enfin le cookie** : `Cookie: locale=fr` ⇒ « Créez votre compte », `en` ou rien ⇒ « Create your account ». Le désaccord de LANGUE est mort. Il reste **deux désaccords d'hydratation antérieurs sur `/home` seulement**, mesurés par diff serveur/client : (a) le salut du matin est calculé côté serveur **en heure UTC** (« Bonne nuit ») et côté client en heure locale (« Bonjour ») ; (b) la ligne de marque « NestorCut — State-of-the-art nesting… » n'est rendue que par le client. Aucun des deux n'est de J11 ; petits, à traiter avec le prochain lot qui touche `/home` |

### 5.2 Le dixième ne tient pas — vu, pas déduit

**R10, la vue agrandie d'une fiche `.job`, est cassée à l'écran** (capture
`07-vue-enrichie-fr.png`, et la capture `02-fiche-enrichie.png` de
l'implémenteur montre EXACTEMENT la même chose — elle a été committée comme
preuve sans qu'un œil s'y soit posé, ce que le rapport dit honnêtement) :

- les trois lignes de légende (« contour de coupe — trajet d'amorce »,
  « position tangente possible (zone) », « point de perçage ») sont
  **imprimées par-dessus** le nom du dessin et entrelacées avec la phrase
  « Géométrie lue dans le fichier de travail… » — du texte sur du texte ;
- le badge « Nouveau » y est rendu en **barre bleue pleine largeur** sous le
  dessin, pas en badge ;
- et surtout **le dessin ne montre rien de ce que la légende annonce** : un
  L à fond bleu et contour bleu, **aucun trajet d'amorce, aucun point de
  perçage, aucune zone tangente** — sur un exemplaire dont le point a été
  placé à la main. La vue « enrichie » n'est pas enrichie.

Ma propre sonde géométrique disait « aucun chevauchement » : elle ne
regardait pas les bons nœuds. **L'image avait raison, la sonde tort** —
c'est précisément pourquoi la règle exige des yeux, y compris les miens.

### 5.3 Décision

**NO-GO, étroit.** Tout le reste est bon et je ne le referai pas vérifier.
Mais on ne met pas en production une vue qui imprime du texte sur du texte
et promet une légende que le dessin ne tient pas — l'ancienne vue agrandie,
sobre, valait mieux que celle-ci.

**Lot J11-ter — un écran, deux issues possibles, au choix de l'implémenteur :**

1. **Réparer** : la légende sous le dessin, dans son propre bloc, sans
   chevauchement à 1440 comme à 390 px ; le badge « Nouveau » redevient un
   badge ; et le dessin AFFICHE réellement le trajet d'amorce, le disque de
   perçage et, pour une amorce tangentielle, la zone — les mêmes formes que
   la vignette de la carte, à taille lisible. Verrou : capture FR de la vue
   pour un exemplaire « votre point », **regardée**, jointe au rapport, et
   un verrou géométrique qui compte les tracés d'amorce dans le SVG de la
   vue (> 0 quand la fiche porte des points).
2. **Ou revenir** à la vue agrandie précédente (géométrie seule, propre)
   pour les fiches `.job`, retirer la légende et le badge de cet écran, et
   sortir `lead-enlarged-view` du registre des nouveautés. La vue enrichie
   reviendra quand elle sera prête.

Dans les deux cas : « se nest » ⇒ « se neste ». Rien d'autre dans ce lot.

**Sur la méthode, une fois posée** : l'implémenteur a dit clairement qu'il
n'avait pas de vision d'image cette session, et a décrit ses trois sondes
au lieu de prétendre. C'est exactement l'honnêteté demandée, et elle a
permis de savoir quoi regarder. La règle devient donc : **quand
l'implémenteur ne peut pas regarder, il le dit et le vérificateur regarde
avant tout le reste** — ce qui s'est passé ici.

## 6. Rapport du lot J11-ter (implémenteur, 16/09) — option RÉPARER

**Méthode, dite d'abord** : pas plus de vision d'image que la veille —
chaque constat vient de sondes (texte rendu, géométrie DOM sur les BONS
nœuds, décodage pixel du PNG, et désormais un harnais qui rejoue le flux).
Le vérificateur regarde les captures en premier, la règle du §5 le dit.

**La cause racine, mesurée avant le correctif.** Les trois défauts de
l'écran venaient d'UN seul branchements cassé. Dans `files.js`, la chaîne
d'imports dynamiques résolvait le MAUVAIS module :

```js
const { jobDrawings: blocksOf, previewSvgWithLeads } = await import('./localImport')
    .then(() => import('~~/shared/sheetcamJob.js'))
```

`.then(() => import(…))` REMPLACE la valeur résolue : tout est lu sur le
module `sheetcamJob.js`. `jobDrawings` y vit (les blocs se découvrent,
les points s'attachent — « votre point » s'affichait bien), mais
`previewSvgWithLeads` y est **undefined** : l'appel jette, et le catch
« une amorce ratée ne doit jamais casser la fiche » garde l'aperçu NU.
Mesuré sur le dépôt réel : enregistrement IndexedDB avec `starts`
complets (moved=true, leadIn 5) et `previewSvg` à **0** tracé ambré —
la silhouette seule. Les deux autres défauts découlaient de la mise en
page : le bloc enrichi héritait de la hauteur FIXE de `.modal__display`
(320 px) — dessin 280 px + badge + légende la dépassaient de 71 px, la
légende s'imprimait sur le nom et les constats — et le badge, enfant
d'une colonne flex, s'étirait sur 298 px.

**Les correctifs.**

1. **Le branchement** (`files.js`) : deux imports résolus ENSEMBLE,
   `Promise.all([import('./localImport'), import('~~/shared/sheetcamJob.js')])`
   — `previewSvgWithLeads` vient du bon module.
2. **La mise en page** (`FileModal.vue`) : le bloc enrichi sort des
   hauteurs fixes (`height: auto`, y compris la variante plein écran) —
   dessin, badge et légende empilés GRANDISSENT, le nom et les constats
   descendent dessous ; le badge est `align-self: flex-start`
   (**64 px** mesuré, contre la barre de 298 px).
3. **Les formes entières** (`localImport.js`) : une amorce part du
   contour vers l'EXTÉRIEUR — le viewBox, calé sur la seule pièce, la
   coupait en moitié. Il s'étend maintenant jusqu'à l'étendue des
   amorces (marge = gap/4) ; mesuré : `viewBox="-9.550 0.000 129.550
   120.000"` sur la vue du fichier à quatre exemplaires. Sans amorce,
   la sortie est IDENTIQUE à l'octet (verrou existant « aucun leads ⇒
   même sortie exacte », repassé vert).
4. **« se nest »** ⇒ « **se nestE** désormais » dans `CHANGELOG.md`.

**Les verrous.**

- **Harnais navigateur `scripts/qa-job-leadview.mjs`** (nouveau, exigé
  par la vérification) : dépose le `.job` réel (quatre exemplaires
  « votre point »), ouvre la vue agrandie du premier, DÉCODE le SVG de
  la vue et COMPTE les tracés d'amorce — **4 tracés ambrés, 1 disque de
  perçage** (0 avant le correctif) — puis vérifie la géométrie : légende
  dans son bloc, sans chevauchement avec le nom NI les constats, à
  **1440 comme à 390 px**, badge ≤ 90 px, légende à quatre entrées.
  **12 sondes PASS, GO, exit 0** sur l'image reconstruite. C'est lui qui
  aurait attrapé le défaut : il rejoue le flux utilisateur exact.
- **Verrou unitaire** (`sheetcamLeads.test.js`, J11-ter) : une fiche à
  point posable rend **> 0 tracés d'amorce** et un viewBox qui COUVRE
  l'amorce (bord négatif), la pièce restant entière.
- **Suites** : vitest **796/796, exit 0** ; harnais
  `qa-e2e-result-dxfview.mjs` **GO, exit 0** sur la même image.

**Captures (`docs/qa/j11ter/`), et ce qu'on y voit.**

- `01-vue-enrichie-1440-fr.png` (1440×900) — la vue agrandie en
  français : la pièce L avec SON trajet d'amorce ambré et son disque de
  perçage ENTIERS (le viewBox les couvre), la légende quatre entrées
  (« contour de coupe — trajet d'amorce — position tangente possible
  (zone) — point de perçage ») dans son propre bloc SOUS le dessin, le
  badge « Nouveau » en badge (64 px), le nom et le constat « Géométrie
  lue dans le fichier de travail… » chacun sur sa ligne, rien par-dessus
  rien.
- `02-vue-enrichie-390-fr.png` (390×844) — le même écran à 390 px : la
  légende passe à la ligne SANS toucher le nom ni les constats, le badge
  reste un badge.
- `03-fiche-enrichie-fr.png` — la fiche détaillée entière en français,
  pour la lecture d'ensemble (dessin + légende + nom + constat).

**Non-dits** : la vignette de la carte profite du même correctif (c'est
le MÊME SVG reconstruit) — sa vérification visuelle reste au
vérificateur, je n'ai pas de vue directe cette session non plus ; le
`leadInType` du fichier de test est line/arc sans zone tangentielle, la
légende « zone » s'y applique donc à vide (aucune promesse de zone
dessinée pour CE fichier) — l'entrée de légende reste légitime pour les
amorces tangentielles ; rien d'autre touché (registre, version, cartes,
CHANGELOG hormis la coquille).
