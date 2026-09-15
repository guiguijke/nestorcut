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
