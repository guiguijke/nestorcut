# Plan — retrait de la promesse e-mail, puis vague d'audit de stabilisation (24/09)

Vérificateur, sur décision du propriétaire du 24/09. Le chantier des langues
est clos (six langues, V0.9.7). La revue de la feuille de route
(`docs/MASTERPLAN-2026-09-05.md` §9) a trouvé une promesse publique non
tenue. Le propriétaire a tranché deux points :

1. **Les notifications par e-mail : on retire la promesse** (plutôt que de
   brancher la fonction).
2. **Pas de nouveau chantier produit : une vague d'audit pour stabiliser
   l'outil existant.**

---

## 1. Lot M2 — retirer la promesse « notifications par e-mail »

### Pourquoi

Le site vend les notifications par e-mail dans l'offre Unlimited. L'application
ne peut pas en envoyer : le statut `emailNotify: 'need_notify'` n'est posé que
par `server/api/nest/[slug]/notify.post.js`, que rien n'appelle (piège n°38
d'`AGENTS.md`, relevé le 12/08). Le chantier des langues a traduit la promesse
six fois.

### Les 22 endroits, relevés par le vérificateur

| Où | Fichiers | Nombre |
|---|---|---|
| Site, grille tarifaire | `src/i18n/ui.ts`, clé `pricing.unlimited.f5`, six langues | 6 |
| Blog, article des prix, ligne 18 | `nesting-software-pricing.md`, `prix-logiciel-nesting.md`, `preco-software-nesting.md`, `prezzo-software-nesting.md`, `preise-nesting-software.md`, `precios-software-nesting.md` | 6 |
| Blog, diagramme des prix, ligne 25 | `public/diagrams/plans-{en,fr,pt,it,de,es}.svg` | 6 |
| Application, clé morte (jamais affichée) | `plans.compare.emailNotif` dans les six dictionnaires | 6 — une seule clé |

### À faire

1. **Site** : `pricing.unlimited.f5` ne garde que « annulation à tout moment »
   dans chaque langue ; la mention disparaît des six articles (la phrase reste
   correcte sans elle) ; la ligne disparaît des six diagrammes. **Règle du
   cycle allemand** : après la retouche des SVG, mesurer chaque texte contre
   **sa carte**, et **faire le diff du texte** contre les autres langues —
   seule la ligne e-mail doit manquer.
2. **Application** : supprimer la clé morte `plans.compare.emailNotif` des six
   dictionnaires (le verrou de parité suit).
3. **La chaîne morte** (arbitrage du vérificateur, conforme au piège n°38 :
   « retirer le claim + les 3 maillons ») : `notify.post.js`,
   `server/plugins/2_nest-notify.js`, et le champ `emailNotify`. **Balayage
   résiduel avant suppression** (`AGENTS.md` §7) : `scripts/`, `workers/`,
   les tests, `admin/`. Si un de ces maillons sert ailleurs, on le dit et on
   le garde.
4. `AGENTS.md` piège n°38 et `docs/STRATEGY.md` ligne 65 : notés **résolus
   par retrait** (date, décision du propriétaire).

### Publication

- **Le site part tout de suite**, seul : c'est la partie publique, celle qui
  promet. Poussée de `main` du site, **en demandant au propriétaire avant**.
- **La partie application** (clé morte, chaîne morte) ne change rien de
  visible : elle **voyage avec la première publication applicative de
  l'audit**, pas de version pour elle seule.

---

## 2. La vague d'audit — stabiliser l'outil existant

### Principe

On **mesure avant de corriger**. L'audit produit un **registre des défauts
classé par impact pour l'atelier**, avec preuve pour chaque ligne ; les
corrections viennent **après**, en lots, et le propriétaire choisit l'ordre de
tout ce qui touche au produit ou à l'argent. Trois paquets, **un rapport par
paquet**, aucun rapport intermédiaire ; le vérificateur rejoue chaque constat
avant de l'inscrire.

La leçon de la promesse e-mail s'applique à tout l'audit : **on ne vérifie pas
seulement que le code fait ce qu'il dit, on vérifie que ce qu'on dit est
vrai.**

### Paquet AUD-1 — ce que l'utilisateur rencontre vraiment

1. **Chaque promesse publique confrontée à la production.** Site vitrine
   (accueil, grille tarifaire, FAQ), documentation, articles du blog,
   diagrammes, page des plans de l'application : une ligne par affirmation
   vérifiable (« 10 nestings gratuits par mois », « 2 tôles en gratuit »,
   « 24 h puis suppression », « le coffre », « DWG converti sur nos
   serveurs », « la même qualité pour tous », les chiffres des benchmarks…),
   et pour chacune : **vraie / fausse / invérifiable**, avec la preuve (code,
   mesure, capture). Une seule langue suffit — l'anglais, la source —, les
   traductions ayant été vérifiées fidèles.
2. **Les échecs réels de la production**, **avec l'accord explicite du
   propriétaire avant toute requête**, en lecture seule, **comptes agrégés
   seulement** — aucun identifiant d'utilisateur, aucun nom ni contenu de
   fichier : sur les 30 derniers jours, les jobs par état (terminé, partiel,
   en erreur, remboursé, arrêté de façon inattendue), par mode (appareil,
   serveur) et par type d'erreur (`item_geometry`, capacité, mémoire,
   plantage, orphelin non repris). C'est le meilleur signal disponible tant
   que le jalon utilisateurs n'a pas eu lieu.
3. **Le registre des défauts connus**, consolidé depuis `AGENTS.md` et les
   plans : les 704 entités orphelines non découpées (piège 5b), l'écart
   résiduel sous l'espacement de la tôle dense (1,8867 mm, ouvert depuis le
   11/09), les 429 sur `/api/files/result/svg` pour les longues listes
   (famille du piège n°43), les restes d'hydratation de `/home`, la vue
   agrandie `.job` plafonnée à 280 px en plein écran, les titres anglais des
   pages légales et benchmarks. Pour chacun : **encore reproductible
   aujourd'hui ou non**, sur l'image à HEAD.

### Paquet AUD-2 — la justesse du cœur, mesurée sur le corpus

1. **L'import sur les 153 fichiers réels** (`specs/import-corpus/`, jamais
   nommés dans `docs/` — identifiants neutres), par les deux chemins,
   navigateur et serveur : lus, refusés (avec leur message), entités
   orphelines, contours ouverts, temps. **Parité** entre les deux chemins, et
   une ligne de base chiffrée à laquelle comparer toute correction.
2. **Le nesting sur le corpus**, par les deux chemins : les badges
   (chevauchement, espacement, hors tôle, doublons, « non vérifié ») mesurés,
   jamais déclarés ; `determinism_lock.py` natif ≡ wasm ; `check_physical.py`
   sur les sorties.
3. **Les exports relus** : le DXF exporté réimporté (unités, calques,
   géométrie à la précision près), le `.job` en aller-retour, le ZIP
   multi-tôles, le CSV du rapport.

### Paquet AUD-3 — les parcours de bout en bout

1. **Rejouer tous les harnais existants** sur l'image à HEAD (les
   `scripts/qa-*.mjs`, `validate_*_e2e.sh`, les bancs de
   `workers/nesting/bench/`) et remettre au vert — ou inscrire au registre —
   tout ce qui est rouge.
2. **Lister les parcours sans harnais** et en écrire un pour ceux qui
   comptent : au minimum le mode serveur avec un compte payant, le DWG, le
   coffre, l'export ZIP multi-tôles.
3. **Les temps au repos**, dans le navigateur, sur les cas de référence,
   comparés aux derniers chiffres mesurés (discipline de `CLAUDE.md` : aucun
   build, agent à l'arrêt, `QA_OUT` hors OneDrive).

### Règles de l'audit

- Images à HEAD avant tout banc (`assert_images_head.sh` OK).
- Chaque constat : **ce qu'on voit, comment le reproduire, la preuve**. Un
  constat sans reproduction n'entre pas au registre.
- **Aucune correction pendant l'audit**, sauf une régression bloquante en
  production — et alors on le dit et on demande.
- **Aucune écriture en production** ; les lectures de la production
  (paquet AUD-1 §2) passent par l'accord du propriétaire.
- Un verrou ajouté pendant l'audit **se prouve en échouant sur le code
  fautif**.

### Livrable

À la fin des trois paquets : **le registre**, dans ce document, chaque ligne
avec son impact (atelier bloqué / résultat faux / gêne / cosmétique), sa
preuve et son coût estimé. Le vérificateur le classe ; le propriétaire choisit
les lots de correction.

---

## 3. Relecture du lot M2 et décisions du propriétaire (24/09) — M2-bis avant publication

### Ce que M2 a bien fait

Relu sur le commit local du site `0061d3a` et la branche
`audit-stabilisation` (`74003799`) : **plus une seule mention des
notifications par e-mail** sur la grille, les six articles et les six
diagrammes ; `pricing.unlimited.f5` dit « Cancel anytime » et ses
équivalents ; les six phrases d'article restent correctes ; côté
application, clé morte et chaîne morte supprimées après balayage, piège
n°38 noté résolu, vitest 821/821.

### Un trou dans le diagramme

Le rapport disait « une ligne en moins, pas un texte raccourci » : c'est
justement le problème. Dans la colonne Unlimited des six `plans-*.svg`, les
lignes restent à `y = 165, 184, 203` puis **`241`** — la ligne `222` est
partie, **les autres n'ont pas remonté**. Regardé : un blanc au milieu de la
liste, entre « 3 layouts to compare » et « Material report export ». Retirer
une ligne d'une liste, c'est aussi resserrer la liste.

### Deux autres promesses fausses, dans le même diagramme — et ailleurs

En regardant ce diagramme, deux affirmations ne tenaient pas. Vérifiées :

1. **Les « crédits » n'existent pas.** « Credits: pay-as-you-go packs, no
   subscription » (bas du diagramme, six langues) — et l'article des prix
   leur consacre **une puce, une section entière** (« Credits: occasional
   use, no subscription ») et **sa description** (« Free, Unlimited 19 €, Pro
   39 € or credits »), dans les six langues. Or la boutique Stripe ne compte
   que **deux abonnements mensuels** (`scripts/create-live-products.mjs`),
   aucun pack, et `docs/STRATEGY.md` n'en parle pas.
2. **« Denser layouts » en Pro** (colonne Pro du diagramme) contredit la page
   des plans de l'application, qui promet au gratuit **« Same fully
   optimized result as paid plans »**, et la règle du moteur (`AGENTS.md`
   §1 : même qualité pour tous, arrêt sur plateau partout, le tier ne change
   que la vitesse). La même idée est écrite dans deux articles : l'article
   des prix (« the more time you give it… », ligne 44 environ) et l'article
   confidentialité (« more compute power gives denser layouts on big jobs »,
   ligne 44 environ), dans les six langues.

**Décisions du propriétaire (24/09)** :

- **Crédits : retirés maintenant**, dans la même poussée que l'e-mail. Ils
  reviendront le jour où les packs existeront.
- **Même qualité pour tous : Pro = plus rapide et prioritaire, pas plus
  dense.**

### M2-bis — à faire avant de pousser le site

1. **Le trou** : dans les six `plans-*.svg`, remonter les lignes sous celle
   retirée pour que la liste reste régulière (pas de 19 px).
2. **Les crédits** :
   - diagramme : retirer « Credits: … » du bandeau du bas (il ne garde que la
     garantie de remboursement de 30 jours, **qui existe** — page
     `/refund` — et la ligne du coffre) ; le titre « Four ways to pay » devient
     **« Three ways to pay »** et ses équivalents ;
   - article des prix, six langues : retirer la puce, la section entière, et
     « or credits » de la description ; l'`alt` italien « Piani NestorCut:
     Free, Unlimited, Pro, crediti » se corrige avec.
3. **« Denser layouts »** :
   - diagramme : retirer la ligne de la colonne Pro (six langues), et
     resserrer comme au point 1 ;
   - articles : réécrire les deux passages pour dire ce qui est vrai — **plus
     de puissance, c'est plus vite, pas plus dense** : le même résultat, livré
     plus tôt. **Ne pas toucher** la phrase qui compare NestorCut aux « outils
     gratuits historiques » (article plasma gratuit) : c'est une autre
     comparaison.
4. **Chercher avant de conclure** : les formes ont été repérées par le
   vérificateur, pas forcément toutes. Balayer les six langues (site, blog,
   documentation, diagrammes) pour « credit / crédit / Credits / créditos /
   crediti », « pay-as-you-go / prepaid / à l'usage », et « denser / plus
   dense / dichter / más dens / più dens / mais dens » en lien avec un plan ou
   la puissance.
5. **Les règles des dessins** : chaque texte mesuré contre **sa carte** ;
   **diff du texte** contre les autres langues — seules les lignes retirées
   doivent manquer ; les diagrammes **regardés** après coup.
6. Build, `check:links`, zéro fragment orphelin, et un **balayage final** qui
   prouve qu'il ne reste aucune des trois promesses.

Puis **demander au propriétaire avant de pousser** `main` du site.

## 4. Relecture du M2-bis (site `edf89b2`) — vérificateur, 24/09 — deux retouches avant publication

**Ce qui tient** : plus aucun crédit ni pack (les seuls « credit » restants
sont « credit card » et « a refused job never costs a nesting credit »,
légitimes) ; plus d'e-mail ; « Denser layouts » sorti des six colonnes Pro ;
le titre dit « Three ways to pay » ; la garantie de 30 jours et la ligne du
coffre restent ; la colonne Unlimited est resserrée (165, 184, 203, 222) dans
les six langues ; la phrase de l'article confidentialité dit maintenant
« more compute power delivers the same result sooner on big jobs ».

### 1. Le diagramme portugais est illisible

Colonne Pro de `plans-pt.svg` : `y = 165, 184, 199, 203`. « de processamento »
(199, la suite de « Orçamento máximo ») et « Fila prioritária » (203) sont à
4 px l'un de l'autre : **les deux lignes se superposent**. Regardé :
illisible. Le rapport disait « vérifié par les coordonnées y » — les
coordonnées disaient justement 199 et 203. **Correctif** : 165, 184, 203, 222.
**Et regarder les six images**, pas seulement les coordonnées.

### 2. Le paragraphe « anytime » se contredit

Article des prix, ligne 43, six langues. Il dit maintenant : « the more time
you give it, the denser the final layout gets. On a small job, Unlimited and
Pro often land on the same result. On a big job, Pro delivers the same result
sooner. » Lu d'un trait, juste après « It buys compute power » : plus de
temps donne plus dense, donc Pro donne plus dense ; et « souvent le même
résultat sur un petit job » laisse entendre qu'il ne l'est pas sur un gros.
La phrase finale corrigée contredit les deux phrases qui la précèdent.

La règle, décidée par le propriétaire et écrite dans `AGENTS.md` §1 : **tous
les plans s'arrêtent au même point — quand le moteur ne progresse plus
(plateau).** Pro ne cherche ni plus longtemps ni mieux ; il cherche avec plus
de cœurs à la fois, donc le même résultat arrive plus tôt, et la différence
se voit sur les gros jobs. **Réécrire le paragraphe dans ce sens**, dans les
six langues, sans « the denser the final layout gets » et sans « often the
same on a small job ».

### Pour l'audit AUD-1

La promesse « même qualité pour tous » est désormais écrite partout. L'audit
doit **mesurer** qu'elle est vraie : sur un gros job, chaque plan atteint-il
le plateau avant sa limite de temps ? Si un plan s'arrête sur sa limite de
temps avant le plateau, Pro peut donner plus dense, et c'est alors le
produit — ou la promesse — qui devra être réaligné, au choix du propriétaire.

Puis **demander au propriétaire avant de pousser** `main` du site.

## 5. Relecture des retouches M2-bis (site `15a54f9`) — vérificateur, 24/09 — GO publication du site

Le diagramme portugais **regardé** : la colonne Pro est lisible (« Orçamento
máximo / de processamento » sur deux lignes, puis « Fila prioritária »), plus
aucune superposition. Le paragraphe « anytime » dit maintenant, en anglais
comme en français : « tous les plans s'arrêtent au même point… Pro cherche
avec plus de cœurs à la fois — le même résultat arrive plus tôt ». **GO pour
pousser `main` du site**, sur l'accord du propriétaire.

**Note de méthode** : l'implémenteur a écrit qu'il ne peut pas voir les
images et que « les coordonnées font foi ». Les coordonnées ne montrent pas
une superposition de texte, un trou ou un débordement de carte — trois
défauts de ce lot que seul le regard a trouvés. **Règle** : quand
l'implémenteur ne peut pas voir une image, il le dit, il joint l'image, et
**le vérificateur la regarde avant toute publication.**

---

## 6. Lot M3 — le menu de l'application et l'accès à la documentation (demande du propriétaire, 24/09, avant l'audit)

Photo du propriétaire : la page d'accueil de l'application, **non connecté**.
Reproduit par le vérificateur en production, en français, allemand et
espagnol, à 1280, 1440 et 1600 px :

1. **« V0.9 » colle au premier lien** (« V0.9Fonctionnalités ») : l'écart
   mesuré entre le numéro de version et le premier lien va de −5 à +2 px.
2. **« Comment ça marche » passe sur deux lignes** (47 px de haut contre 29
   pour les autres), dans **toutes les langues** (« So funktioniert es »,
   « Cómo funciona ») et **même à 1600 px** : la rangée se désaligne.
3. **Le bouton « Connexion / Inscription » tombe sous « Signaler un
   problème »** : l'en-tête ne tient plus sur une ligne.
4. **Trois liens renvoient au site ANGLAIS** : « Fonctionnalités », « Comment
   ça marche » et « FAQ » pointent vers `https://nestorcut.com/#…`, quelle que
   soit la langue — un Français atterrit sur l'accueil anglais.
5. **Aucun lien visible vers la documentation**, ni déconnecté, ni connecté —
   seulement les petits « ? » des réglages. Une fois connecté, les liens du
   site disparaissent (c'est voulu, le propriétaire le confirme) ; la
   documentation, elle, doit rester accessible. Elle existe déjà dans les six
   langues.

### À faire

1. **L'en-tête déconnecté sur une ligne** (`app/components/MainHeader.vue`,
   thème secondaire) : un vrai écart entre la version et le premier lien ;
   les libellés du menu **sur une ligne** ; « Signaler un problème » et
   « Connexion / Inscription » sur la même rangée. Quand la largeur ne suffit
   plus, le **menu replié** (le bouton `header__toggler` existe déjà) prend le
   relais — **jamais un libellé qui passe à la ligne**.
2. **Les liens du site dans la langue de l'utilisateur** : l'accueil, les
   fonctionnalités, le fonctionnement et la FAQ vers
   `https://nestorcut.com/<langue>/#…` — l'anglais à la racine, les cinq autres
   sous leur préfixe, **la même règle que les liens d'aide**. Une fonction à
   côté de `docsHelpUrl` dans `app/utils/docsLinks.js`, pas une deuxième
   table.
3. **Un lien « Documentation » bien visible, dans les deux états** :
   - déconnecté : un élément du menu, à côté de « Tarifs » ;
   - connecté : un lien texte à côté d'« Espace de travail », même style ;
   - il ouvre l'**accueil de la documentation dans la langue de
     l'utilisateur** (`/docs/`, `/fr/docs/`, … `/es/docs/`), par une fonction
     `docsHomeUrl(locale)` dans `docsLinks.js` ;
   - une clé `nav.docs` dans les six dictionnaires.
4. **Verrous** qui se prouvent en échouant sur le code actuel : chaque lien
   du site et de la documentation porte le préfixe de la langue (six
   langues) ; et une sonde navigateur qui mesure, en six langues, à 1280 et
   1600 px : **chaque lien du menu tient sur une ligne**, **au moins 8 px**
   entre la version et le premier lien, l'en-tête sur **une seule rangée** ;
   à 1024 px, le menu replié.
5. **Captures jointes** (en-tête déconnecté FR et DE à 1280 et 1600,
   connecté FR avec le lien Documentation, menu replié à 1024). L'implémenteur
   ne voit pas les images : il le dit, et **le vérificateur les regarde**.

### Publication

**V0.9.8**, application seule, avec la partie application de M2 déjà sur
`main` (clé morte et chaîne mortes supprimées). `CHANGELOG.md` à six blocs :
le menu réparé, les liens vers le site dans votre langue, la documentation
accessible depuis l'application. **En demandant au propriétaire avant toute
écriture de production.** L'audit AUD-1 démarre ensuite.

## 7. Relecture du lot M3 (`52f305db`) — vérificateur, 24/09 — NO-GO étroit, M3-bis

**Le site est en ligne et juste** (vérifié : plus d'e-mail ni de crédits sur
l'accueil, diagramme portugais corrigé servi).

**Ce qui tient dans M3** : les liens du menu pointent vers le site **dans la
langue** (`https://nestorcut.com/fr/#features`, `/de/#faq`…, l'anglais à la
racine) ; le lien **Documentation** existe dans les deux états et ouvre
l'accueil de la documentation dans la langue (`/fr/docs/`, `/de/docs/`,
`/docs/`) ; `nav.docs` dans les six langues ; les libellés tiennent sur une
ligne ; vitest 825/825. Les captures regardées : à 1600 px en français,
l'en-tête est propre ; le menu replié à 1024 px aussi.

### L'en-tête déborde de l'écran dans cinq langues sur six

Sur la capture `header-de-1280.png`, le bouton de connexion est **coupé par
le bord de l'écran** (« Anmelden / Ko… »). Mesuré sur l'application
construite avec ce lot (stack locale), largeur de la page contre largeur de
l'écran :

| | 1280 px | 1366 px | 1440 px |
|---|---|---|---|
| français | 1414 — déborde | 1447 — déborde | **1484 — déborde** |
| espagnol | 1405 — déborde | 1438 — déborde | **1475 — déborde** |
| allemand | 1368 — déborde | 1401 — déborde | tient |
| portugais | 1341 — déborde | 1374 — déborde | tient |
| italien | 1302 — déborde | tient | tient |
| anglais | tient | tient | tient |

La page **défile horizontalement** et le bouton de connexion sort de l'écran —
aux largeurs d'ordinateur portable les plus courantes, et jusqu'à 1440 px en
français. Avant M3, les libellés passaient à la ligne (laid) ; maintenant ils
tiennent sur une ligne, mais l'en-tête ne tient plus dans l'écran. La sonde
vérifiait que les boutons étaient **sur la même rangée**, jamais qu'ils
étaient **dans l'écran** : elle ne pouvait pas le voir.

### M3-bis

1. **L'en-tête tient dans l'écran à toute largeur, dans les six langues.** Le
   menu replié doit prendre le relais **là où le contenu ne tient plus**,
   pas à un seuil fixe de 1024 px choisi pour l'anglais. Pistes, au choix de
   l'implémenteur : replier seulement les liens du site (fonctionnalités,
   fonctionnement, FAQ, nouveautés) en gardant Documentation et la connexion
   visibles ; déplacer « Signaler un problème » dans le menu replié ; ou
   décider du repli d'après la place réelle (mesure du contenu, requête de
   conteneur) plutôt que d'après la largeur d'écran.
2. **La sonde mesure ce qui compte** : à **1024, 1280, 1366, 1440, 1536, 1600
   et 1920 px**, dans les six langues, `document.documentElement.scrollWidth`
   ≤ largeur de l'écran, et le bord droit de **chaque** élément de l'en-tête ≤
   largeur de l'écran. Elle doit **échouer sur `52f305db`** — c'est la preuve
   qu'elle mord.
3. Détail, connecté : « **Espace** » et « **Documentation** » se lisent comme
   un seul intitulé (« Espace Documentation ») : même écart qu'entre les liens
   du menu déconnecté.
4. **Captures reprises** — dont l'allemand et le français à 1280 et 1366 —
   **jointes pour que je les regarde**.

Puis V0.9.8 comme prévu, en demandant au propriétaire avant la production.

## 8. Relecture du M3-bis (`72ffc4ce`) — vérificateur, 24/09 — un dernier pas, M3-ter

**Ce qui tient.** Mesuré par moi sur la build locale, six langues, à 1024,
1280, 1366, 1440, 1536 et 1920 px : **plus aucun débordement** — ni
défilement horizontal, ni élément de l'en-tête hors de l'écran ; le lien
Documentation et la connexion restent visibles dans la barre à toutes ces
largeurs. La sonde échoue bien sur `52f305db` (29 rouges, mes chiffres au
pixel près) et passe sur le correctif : c'est la forme demandée. Captures
regardées : l'en-tête replié tient sur une ligne ; une fois connecté,
« Espace » et « Documentation » sont nettement séparés (26 px). Au téléphone
(375 px, hors consigne), la Documentation passe dans le panneau replié :
acceptable.

**La découverte de l'implémenteur est juste, et il a bien fait de ne pas
toucher seul au layout** : `app/layouts/default.vue` plafonne l'en-tête à
**1300 px**, alors que le menu complet en demande de 1342 (italien) à 1484
(français). Conséquence du M3-bis : **le menu du site est replié derrière ☰
partout, même sur un écran de 1920 px, dans les six langues.**

### Arbitrage du vérificateur : l'en-tête déconnecté passe en pleine largeur

Le propriétaire l'a dit en ouvrant le lot : une fois connecté, ces liens
disparaissent, « ce qui est bien » — autrement dit, **déconnecté, il les veut
visibles**. Un menu toujours replié sur grand écran cache « Tarifs » et
« Fonctionnalités » au visiteur qui découvre le produit. Et le plafond de
1300 px ne vaut que pour l'en-tête **déconnecté** : connecté, l'en-tête
occupe déjà toute la largeur (logo à 16 px du bord), ce que le propriétaire
préfère (« utiliser tout l'écran », mémoire du 08/09). Les deux états
n'alignent même pas leur logo.

**Décision** : dans `app/layouts/default.vue`, l'en-tête prend **toute la
largeur**, comme l'en-tête connecté ; le **contenu** des pages publiques
garde sa largeur de lecture (1300 px — carte de connexion, pages légales).
Le repli par la place réelle, déjà écrit, fait alors le reste : **menu
complet là où il tient, replié ailleurs.**

### M3-ter

1. `main__header` sans plafond (même marges que l'en-tête connecté) ;
   `main__content` inchangé.
2. **Pas de saut au chargement.** Le rendu serveur sort replié ; sur grand
   écran, le client déplierait après coup — un menu qui s'ouvre sous les
   yeux. Le premier affichage doit être le bon : par exemple un seuil CSS par
   langue (le serveur connaît la langue, et les largeurs nécessaires sont
   mesurées), la mesure JavaScript restant le filet. **Sonde** : même page
   chargée **sans JavaScript** et **avec**, à 1280, 1440 et 1920 px, six
   langues — l'état du menu (déplié ou replié) doit être **identique**.
3. **La sonde de place reste verte** aux sept largeurs, et elle vérifie en
   plus que le menu est **déplié à 1920 px dans les six langues**.
4. Captures à regarder : français et allemand à 1920 (déplié) et à 1366
   (replié), anglais à 1440, et la page connectée pour vérifier que les deux
   logos sont à la même place.

Puis V0.9.8, en demandant au propriétaire avant la production.

### Ajout au M3-ter : le bouton ☰ ne referme pas le panneau

Le journal de travail de l'implémenteur le dit en passant : « la fermeture du
panneau par le toggler timeout (l'overlay couvre le bouton) », et la sonde a
été **changée pour fermer par un clic sur le fond**. C'est le défaut qu'il
fallait corriger, pas le test : un utilisateur qui ouvre le menu par ☰
cherche à le refermer par ☰. **À faire** : le bouton ☰ reste au-dessus du
fond et **referme** le panneau ; la sonde ferme **par le bouton** (et aussi
par le fond, et par la touche Échap). Règle déjà posée : quand une sonde
échoue sur un vrai comportement, on corrige le comportement, pas la sonde.

## 9. Relecture du M3-ter (`7bbe1827`) — vérificateur, 24/09 — GO sous une condition

**Rejoué par le vérificateur** sur la build locale : six langues × 1280, 1366,
1440, 1536, 1920 px — **aucun débordement**, et l'état du menu **identique
avec et sans JavaScript** (aucun saut au chargement) ; **menu déplié à 1920 px
dans les six langues** ; **☰ ouvre et referme**, **Échap referme**. Captures
regardées : à 1920 px, le menu complet tient sur une ligne en français et en
allemand ; connecté ou non, **le logo est à la même place**. L'implémenteur a
eu raison d'aller au-delà de la lettre de la consigne : l'en-tête connecté
n'était pas en pleine largeur comme je le croyais (`auth.vue` plafonnait à
1760 px, `doc.vue` et `profile.vue` à 1300) ; seuls les en-têtes ont changé,
les contenus gardent leur largeur. Validé.

### La condition : le clavier passe par des liens invisibles

Menu **replié** (français à 1366 px), la touche **Tab** passe par **six liens
invisibles** — ceux du panneau fermé, décalé hors de l'écran : Fonctionnalités,
Comment ça marche, Tarifs, FAQ, Nouveautés, Signaler un problème. Un
utilisateur au clavier perd son focus six fois dans le vide. Le défaut
existait déjà sur mobile ; il touche maintenant les ordinateurs portables,
puisque le menu y est replié. (Déplié à 1920 px : aucun lien invisible
atteint.)

**Correctif** : le panneau fermé sort de l'ordre de tabulation
(`inert`, ou `visibility: hidden` à la fermeture) ; ouvert, il y revient.
**Sonde** : menu replié, 25 pressions sur Tab, le focus ne tombe jamais sur un
élément invisible ; menu ouvert, les liens du panneau reçoivent le focus.

**GO sous cette condition** : correctif et sonde verte, puis fusion vers
`main` et attente du build d'intégration. Le contrôle avant déploiement
vérifiera ce point ; la production se demande au propriétaire.
