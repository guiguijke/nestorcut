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
