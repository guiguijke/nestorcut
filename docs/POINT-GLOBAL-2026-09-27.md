# Point global — 27/09/2026 (vérificateur)

Demande du propriétaire : « fais le point sur l'application : petit audit
global + les features restantes à développer pour NestorCut + regarde s'il n'y
a pas aussi moyen d'améliorer l'interface admin, et notamment le suivi de ce
que font les users sans récupérer leurs données perso ».

**Méthode.** Six couloirs en lecture seule (santé du code, promesses publiques
contre le code, sécurité et données personnelles, interface admin, features
restantes, contrôle avant déploiement de la V0.9.8), chacun relu par un
contradicteur chargé de réfuter ; les constats réfutés sont écartés, les
gravités corrigées. Aucune écriture en production, aucune lecture de la base de
production : seulement des GET de pages publiques. Les constats critiques et
hauts ont été relus par le vérificateur dans le code.

**Le dépôt est public** : les constats de sécurité sont dans un document
**privé**, `specs/AUDIT-SECURITE-2026-09-27.md` (gitignoré). Ce document-ci n'en
donne que l'existence et la priorité.

---

## 1. Où en est la production

- **Production : V0.9.7** (`36307d07`). **main : V0.9.8** (`524208b2`, lots
  M2-application, M3, M3-bis, M3-ter et la condition clavier), CI verte, image
  `nest2d-app:524208b2…` publiée (digest `ab8bbf36…`) ; `:latest` n'a pas bougé.
- vitest **825/825**, code de sortie 0. `npm audit` : aucune faille haute
  atteignable en production (outillage de build ou code non appelé).
- **Contrôle avant déploiement de la V0.9.8** (rejoué sur la stack locale à
  HEAD) :
  - clavier : menu replié en français à 1366 px et en allemand à 1280 px,
    25 Tab sans focus sur un élément invisible ni sur un lien du panneau fermé ;
    ☰ ouvert, les six liens reçoivent le focus ; refermé, ils ressortent ; Échap
    referme ; déplié à 1920 px, chaque lien visible est tabulable — **la
    condition du GO M3-ter est remplie** ;
  - place : 24/24 sans défilement horizontal (six langues × 1280, 1366, 1440,
    1920), connecté 12/12 ;
  - application seule : `git diff 36307d07..524208b2 -- workers/ public/engine`
    est vide.
- **Trois fautes dans le CHANGELOG V0.9.8**, servies telles quelles par
  `/changelog` puis recopiées sur la page Nouveautés du site :
  - FR : « La promesse d'notifications » → « La promesse de notifications » ;
  - FR : « à côté d'Espace de travail » → l'écran affiche « **Espace** »
    (`fr.js:9`) ;
  - EN : « How it works » → l'écran affiche « **How It Works** » (`en.js:11`).
- **Le panneau ☰ est translucide** (capture regardée par le vérificateur,
  français à 1366 px) : la carte de connexion transparaît sous les liens,
  « Tarifs » tombe sur le logo, « Signaler un problème » sur le texte de la
  carte. Le défaut existait sous 1199 px ; depuis M3, le menu se replie jusqu'à
  1296-1454 px selon la langue, donc **sur les portables courants**. Le panneau
  doit être opaque, dans les deux thèmes.
- **La page Nouveautés du site est restée à la V0.9.6** : `sync-changelog.mjs`
  n'a pas été relancé après la V0.9.7 (`AGENTS.md` §6). Le prochain passage
  rattrapera les deux versions.
- **Promotion** : `promote-latest` retague par défaut les quatre images, et les
  images workers et admin de `524208b2` ont d'autres digests que `:latest` pour
  une source identique (argument de build `GIT_COMMIT_SHA`). Pour un
  déploiement **application seule**, lancer `promote-latest` avec
  `images=nest2d-app`.

**Conclusion V0.9.8** : GO sous réserve. Elle part **avec** le correctif de
sécurité S0 (§3), les trois corrections du CHANGELOG et le panneau opaque, sur
un nouveau SHA.

---

## 2. Ce qui tient (vérifié)

10 nestings gratuits par mois avec remboursement en cas d'échec ; 2 tôles en
Free ; essai de 7 jours ; 19 € et 39 € ; profils 1, 4 et 8 cœurs ; refus de
capacité **avant** toute consommation de quota ; 5 Mo par fichier dans les deux
modes ; coffre ouvert à tous les plans (la garde Pro est bien retirée) ; en mode
« cet appareil », **ni géométrie ni nom de fichier** ne partent au serveur (slug
aléatoire) ; fichiers supprimés à 24 h + 1 h ; webhook Stripe signé ;
téléchargements réservés au propriétaire (404 sinon) ; liste blanche sur
`/api/track` ; en-têtes de sécurité (HSTS, CSP, X-Frame-Options, nosniff,
Referrer-Policy) ; Mongo épinglé en 7.0.43.

---

## 3. Ce qu'il faut corriger

### Critique

| # | Constat | Lot |
|---|---|---|
| A-1 | **Correctif de sécurité prioritaire** — détail et consigne dans `specs/AUDIT-SECURITE-2026-09-27.md` (privé). | **S0**, dans la V0.9.8 |

### Haute

| # | Constat | Preuve | Lot |
|---|---|---|---|
| A-2 | **La purge de 24 h ne marque jamais un résultat « expiré ».** Les passes 1 et 4 filtrent sur `updatedAt`, que les jobs n'ont jamais (ils portent `update_ts` et `finishedAt`). Après 24 h, les fichiers sont bien supprimés (passe 2), mais la carte garde l'aperçu et les boutons de téléchargement, qui ne mènent plus à rien. Les instances de jobs navigateur abandonnés après prise en charge ne sont jamais nettoyées. Les tests passent parce que leurs données inventent `updatedAt`. | `server/features/purge/sweep.js:81,174` ; `server/tests/purge.test.js:68,103,149` | M4 |
| A-3 | **Des traits du DXF sortent du fichier de découpe sans avertissement** (`AGENTS.md` 5b, 704 entités sur 9 fichiers du corpus). Le serveur écrit un journal, l'utilisateur ne voit rien ; la page publique `/docs/limits` affirme pourtant « rien ne passe en silence ». | `nest-import/src/attach.rs:408-412` ; `fileprocessing/core/main.py:195-203` | M4 (constat affiché), puis couture |
| A-4 | **Le suivi produit n'est pas anonyme** : cookie `nest2d_session_id` posé dès la première visite pour un an, lisible par JavaScript, rattaché au compte ; chaque événement porte l'identifiant (qui vaut `local:<e-mail>` pour un compte e-mail), le pays et parfois le nom d'origine du fichier ; aucune durée de conservation. La politique de l'application le présente comme « anonyme, exempté ». | `server/middleware/4_tracking.ts` ; `server/api/track/index.post.ts:154-164` ; `server/core/project/dxf.js:134-138` | Suivi anonyme (§6) |
| A-5 | **Google Analytics 4 se charge sans consentement** sur le site vitrine, sans bandeau. `anonymize_ip` n'est pas un consentement. | `nestorcut-website/src/layouts/Base.astro:124-137` | Décision du propriétaire |
| A-6 | **Plusieurs promesses publiques sont fausses** (§4). | — | P (texte validé par le propriétaire) |

### Moyenne

| # | Constat | Lot |
|---|---|---|
| A-7 | **L'admin est aveugle** : « En file », « Échoués » et « Terminés 24h » valent toujours 0 (statuts `queued` / `failed` qui n'existent pas, champ `updatedAt` absent) ; la page Jobs n'affiche que les calculs serveur en cours ; la pagination revient toujours en page 1. | A1 |
| A-8 | **30 événements émis par l'application sont refusés en silence** (réponse 400 avalée), dont l'export `.job` SheetCam, l'ouverture d'un résultat, l'ouverture du paywall, l'échelle et l'éclatement des fiches ; et tout événement qui porte un booléen. C'est la dérive déjà corrigée le 12/08, revenue faute de test. | U1 |
| A-9 | Mode serveur : les vignettes, DXF et ZIP de résultat partagent le budget de 30 requêtes/min ; une liste d'environ 30 tôles le vide et le téléchargement suivant tombe en 429 (défaut déjà au registre). | M4 |
| A-10 | **La CI ne lance pas les tests quand seul `shared/` ou `admin/` change** — or `shared/` contient l'écrivain du `.job` SheetCam. | M4 |
| A-11 | **« Même qualité pour tous » n'est pas mesurée** : les plafonds de temps par plan sont des estimations (seul TODO du code, `entitlement.js:168`). Si un plafond coupe avant le plateau, c'est **le Pro** qui est touché en premier (180 s pour ses 8 walks en parallèle, contre 600 s par walk en séquence dans le navigateur). | AUD-1 |
| A-12 | Le post-pass est écrit deux fois (JS 4 844 lignes, Python 3 755) ; le test de parité tolère 400 poses divergentes sur 1 099. | Chantier 6 |
| A-13 | La liste des résultats relit **tous** les jobs du compte, documents entiers, **chaque seconde et par onglet**, sans limite ni index (`server/api/results.get.js:24-39`). Plausible, non mesuré. | M4 |
| A-14 | L'IP d'inscription est gardée à vie, affichée dans l'admin et recopiée dans l'e-mail envoyé à l'admin ; rien ne s'en sert. | U6 |
| A-15 | Échec d'import DWG : le message du worker n'est lu par personne, l'utilisateur lit « Échec de l'import » sans cause. | M4 |

### Basse (hygiène)

- Test tautologique : la sentinelle d'origine du `.job` n'est jamais exercée
  (`sheetcamJobGeometry.test.js:742-754`, `expect(true).toBe(true)`).
- Environ 6 tests restent verts **sans rien mesurer** en CI (`.testparts`
  absent, `out_user_payload.json` non suivi).
- Dépendance `vite` déclarée et morte ; Node figé en 24.11.0 dans les deux
  Dockerfile ; `npm install` au lieu de `npm ci` dans l'image de l'application.
- CSS : `global.scss` et les polices recopiés dans chaque bloc scoped
  (203 `@font-face` servis pour 3) — lot U5 jamais livré, cause du piège 24d.
- Vue `.job` agrandie limitée à 280 px en plein écran (`FileModal.vue:185-188`).
- Guillemets droits en pt/it/de/es (11 clés × 4) ; titres anglais des pages
  légales (accepté).
- `.omo/` (brouillons de l'implémenteur) n'est pas dans `.gitignore`.
- Code mort : `SelectorField.vue`, `ui/UiCard.vue`, `ui/UiEmptyState.vue`,
  `downloadLocalSvg`, `hasLocalJobs`, `onBeforeUnmount` dans un plugin ;
  `sendNestFinishEmail` sans appelant (reste du lot M2) ; message de log
  « Error in nest-notify plugin » dans `3_status-control.js:41`.
- ZIP multi-tôles : une erreur de flux produit un ZIP tronqué en 200 au lieu
  d'une erreur (plausible, non reproduit).
- Benchmarks publics sur le run `d890c92` : le post-pass worker a changé
  depuis (moteur et wasm inchangés) — à rejouer ou à justifier.
- Documents en retard : `AGENTS.md` #35 (garde du coffre déjà retirée) et §5
  (708 tests annoncés, 825 mesurés) ; `docs/README.md` cassé après « Documents
  privés » et cycles clos non archivés ; `specs/90-decisions.md` s'arrête au
  31/08 ; `MASTERPLAN` §1, §2, §4, §7 figés au 09/09 ; `RECETTE-PROPRIETAIRE`
  sans aucun verdict alors que son §E gèle les nouveautés.

---

## 4. Promesses publiques contre le code

Le texte des promesses revient au propriétaire ; le vérificateur propose.

| Promesse (où) | Réalité | Proposition |
|---|---|---|
| « Application, base et fichiers hébergés en France, par Guillaume Jerke EI » ; sous-traitants : Stripe et Resend (`privacy.astro:56-59`, `legal.astro:38`, `data/legal.en.js:191`) | Base et workers chez **Hetzner** ; **Cloudflare** termine le TLS de `app.nestorcut.com` ; Google (connexion) et Abby (comptabilité) non cités | Nommer l'hébergeur réel (obligation LCEN art. 6 : nom, adresse, téléphone) et les sous-traitants, sur le site et dans l'application |
| « Licence MIT » (mentions légales et CGU, site et app) | Dépôt sous **PolyForm Noncommercial 1.0.0** ; seule la part héritée de nest2d est MIT | Corriger dans les deux langues et les deux dépôts |
| « Vos fichiers sont chiffrés dans votre navigateur » (accueil, FAQ) | La clé est créée dans le navigateur ; le **serveur** chiffre et déchiffre | « Chiffrés sur nos serveurs avec une clé que vous seul gardez ; coffre ouvert, le serveur la tient en mémoire » |
| « Les payants calculent sur nos serveurs par défaut ; au choix à chaque job » (`faq.9`, `pricing.*.f4/f7`, `features.10`) | « Cet appareil » est coché d'office pour **tous** ; le choix se fait une fois, à la création du projet | Corriger le texte, ou changer le produit (décision) |
| « Des jobs identiques donnent des agencements identiques, à chaque fois » (`ui.ts:102`) | Faux en multi-tôles : l'arrêt dépend de l'horloge (T-F donne 88, 89 ou 90 pièces à image égale) | « Même graine, même chemin : stable ; en multi-tôles, une pièce d'écart possible » |
| « Traité en mémoire… jamais écrit sur disque » (`privacy.astro:31,50`) | Sans coffre, le fichier reste en clair dans la base 24 h ; les workers écrivent des fichiers temporaires pendant le calcul | Reformuler (ou monter `/tmp` en tmpfs sur les workers) |
| « File prioritaire », « 8 cœurs » (Pro) | Ordre de tri, pas une garantie : sous charge, un job Pro à 8 jetons passe derrière un Unlimited à 4 ; 8 threads sur 2 vCPU chez Hetzner | Nuancer, ou réserver les jetons au Pro en tête |
| CGU et remboursement de l'application | **Packs de crédits encore présents** ; date « dernière mise à jour » = date de démarrage du serveur (`TODAY = new Date()`) ; garantie de 30 jours limitée à la première période (le site : sans condition) ; « fichiers gardés tant que le compte est actif » (le site : 24 h) | Aligner sur le site ; date fixe par document |
| « SVG et DWG convertis côté serveur » (`features.7`) | Le SVG est lu dans le navigateur ; seul le DWG passe par le serveur | Corriger ×6 |
| Démo « 10 fois par mois » (`features.8`) | Illimitée en calcul local | Retirer la mention |
| Mode appareil : « le serveur ne reçoit que le nom du projet et les compteurs de quota » | Il reçoit aussi formats et nombre de tôles, espacement, quantités, rotations, et la densité obtenue | Énumérer ces paramètres |
| Politique de l'application : cookie de suivi « anonyme, exempté » | Rattaché au compte (A-4) | Réglé par le suivi anonyme, puis politique réécrite (P1) |

---

## 5. Features restantes

État vérifié **dans le code**, pas seulement dans les documents.

### Livré récemment
Import DXF/SVG et calcul en wasm dans le navigateur ; `.job` SheetCam lu et
rendu par tôle ; bloc rigide avec échelle et éclatement ; espacement = 2 × kerf
+ sécurité ; coffre pour tous ; six langues ; documentation.

### Partiel
| Feature | Ce qui manque | Taille |
|---|---|---|
| Rotations par fiche | Le serveur les accepte déjà ; **aucune interface** (`updateRotation` sans appelant) | S |
| Réserve d'amorce et point de départ | Livrés pour le `.job` seulement ; rien pour un DXF ordinaire (dépend des calques CAM) | M |
| Abonnement | Circuit complet, mais **ni portail de facturation, ni factures, ni changement de carte** dans l'application — il manquera au premier abonné | S-M |
| Un seul post-pass dans le moteur | Tranche 1 livrée ; le reste écrit deux fois (A-12) | L |
| `.job` : carte du format | Zone d'exclusion lue mais non respectée ; outils et opérations multiples ouverts | M |

### Non commencé
| Feature | Valeur | Taille | Bloqué par |
|---|---|---|---|
| **Couture des contours** + constat des traits hors pièce | Le pire défaut d'atelier : une pièce coupée incomplète sans le savoir | M | Registre de l'audit (décision du 24/09) |
| **Bibliothèque de chutes v1** (chute rectangulaire → tôle) | Matière économisée, argument fort | M | Registre de l'audit |
| Sortie CAM-ready : calques par nature, identifiants de pièce, un seul écrivain DXF | DXF qui se coupe tel quel ; prérequis de l'amorce pour tous | L | — |
| Colonne navigateur sur `/benchmarks` | Preuve publique de la promesse centrale | S | — |
| Tôle portrait affichée debout | Bords attendus par l'opérateur | S | — |
| Interface U4-U5 (états, accessibilité, thème sombre, `DESIGN-SYSTEM.md`) | Finition | M | — |
| Contraintes de tôle (marges par bord, zones interdites, miroir, grain) | Brides, zones abîmées, matières à face | L | Jalon utilisateurs |
| Pièces de remplissage | Combler les vides avec des pièces vendables | L | Jalon utilisateurs |
| Coupe commune en grappes | Moins de coupe et de perçages | XL | Jalon utilisateurs |
| API et traitement par lot | Canal B2B | XL | Décision du propriétaire |
| Rapport imprimable / PDF, coût matière | Fiche atelier, devis | M | Décision de tarif |
| Réglage d'effort du moteur | Compromis temps/qualité | M | Mesure préalable |
| Chutes v2 au contour réel | Tôles entamées | XL | Retours sur la v1 |
| DWG R2013+ | Fichiers AutoCAD récents | M | Corpus DWG ; cause d'échec d'abord (A-15) |

### Gelé (recette du propriétaire non consignée)
Meilleur point de départ automatique (J4-quater), `.job` en mode serveur (J5),
enveloppe concave du bloc rigide (E4-e), turbo hybride Pro (squelette caché).

### Ordre recommandé, une fois la stabilisation faite
1. Constat « N traits hors pièce ne seront pas coupés » (S), puis la couture
   (M).
2. Portail de facturation Stripe (S-M), avant le premier abonné.
3. Rotations par fiche (S), la tuyauterie existe.
4. Bibliothèque de chutes v1 (M).
5. Calques CAM (L), puis amorce et départ pour tout DXF (M).
6. Colonne navigateur des benchmarks (S).

Le reste attend le jalon utilisateurs (entretiens jamais tenus) ou une
décision du propriétaire.

---

## 6. L'admin, et le suivi sans données personnelles

### 6.1 Constat

- **L'admin est resté sur l'ancien modèle « tout serveur »** : compteurs du
  tableau de bord toujours à 0 (A-7) ; page Jobs limitée aux calculs serveur
  en cours ; durée des jobs navigateur « — » alors que le serveur connaît
  `takenAt` et `finishedAt` ; libellés `standard` / `privacy` au lieu
  d'Unlimited / Pro ; deux « Jobs échoués » différents sur la même fiche ;
  « souscriptions » = checkouts ouverts, abandons compris ; heures en UTC ;
  aucun index sur `nesting_jobs` alors que le tableau de bord lance
  6 comptages toutes les 10 s par onglet ; journal des actions admin écrit
  mais jamais lisible ; aucun état d'erreur ; aucun test.
- **Le suivi actuel est un journal individuel, pas une mesure** (A-4) : la fiche
  d'un utilisateur montre ses 20 derniers clics avec leur pays et son IP
  d'inscription ; l'onglet Journaux permet de rejouer sa navigation. Et il est
  **aveugle là où ça compte** (A-8) : l'export `.job`, le paywall, l'import dans
  le navigateur n'y sont pas. La « rétention » compte comme actif quiconque a
  émis un événement, une simple page vue suffit.
- **Le serveur sait déjà l'essentiel, sans nouvelle collecte** : pour chaque
  job, création, prise en charge, fin, statut, pièces demandées et posées,
  tôles, densité, code d'échec, remboursement, lieu de calcul, niveau, format
  (extension du slug opaque) ; pour chaque compte, inscription, méthode de
  connexion, e-mail vérifié, unité, newsletter, coffre, abonnement, promo.
- **Angles morts** : ce qui se passe dans le navigateur — imports (succès,
  échecs, causes), exports, réserve d'amorce, départ d'un `.job`, langue.

### 6.2 Principes (arbitrage du vérificateur)

1. **Compter, pas suivre.** Aucune donnée d'usage ne porte d'identifiant : ni
   compte, ni cookie, ni IP, ni pays de la requête, ni user-agent, ni slug, ni
   nom de fichier, ni géométrie, ni texte libre, ni heure plus fine que le jour.
2. **Ce que le service sait déjà, d'abord.** Un nouvel événement n'existe que
   pour ce que le serveur ne voit pas (navigateur).
3. **Le serveur compte, sauf impossibilité** : fiable, indépendant des
   bloqueurs, impossible à gonfler.
4. **Un seul catalogue**, `shared/constants/usageEvents.js`, importé par
   l'application, le serveur et l'admin ; tout le reste est refusé ; **un test
   de parité** échoue dès qu'un nom émis n'y figure pas.
5. **Des tranches, pas des valeurs** (pièces, durée, tôles, densité).
6. **Seuil d'anonymat de 5** : une case sous 5 s'affiche « <5 », avec masquage
   complémentaire ; les dimensions fines se lisent sur 7 jours au moins.
7. **Aucun cookie de mesure.** Seul reste le cookie de session.
8. **Tout a une durée** : compteurs 25 mois, journal technique 14 jours.
9. **La promesse avant l'envoi** (D-PRV-9) : la politique de confidentialité
   décrit une fonction déjà vérifiée en production.
10. **Chaque lot prouve l'absence** : un test injecte un e-mail, une IP, un
    cookie, un nom de fichier et un slug, et vérifie qu'aucun ne se retrouve
    dans les compteurs — ce test échoue sur le code actuel.

### 6.3 Ce que l'admin saura répondre

- **Entonnoir par semaine d'inscription** : e-mail vérifié → premier projet →
  premier calcul → premier résultat → premier téléchargement (DXF, ZIP, `.job`).
- **Retour** : qui **recalcule** entre J7 et J13, et entre J28 et J34.
- **Conversion** : paywalls vus par déclencheur (quota, export, bannière),
  checkouts ouverts puis aboutis, essais, résiliations ; refus par raison
  (quota, tôles, directions, capacité).
- **Adoption** : formats importés (DXF, SVG, DWG, `.job`), projets appareil ou
  cloud, calcul navigateur ou serveur, exports, réserve d'amorce, échelle et
  éclatement, coffre, langues, mm ou pouces.
- **Qualité** : taux d'échec par catégorie (capacité, géométrie d'une pièce,
  mémoire, alternatives invalides, pièce trop grande, espacement trop grand…),
  navigateur contre serveur ; remboursements par semaine ; **imports échoués
  par cause**.
- **Performance** : durée médiane et p95 par tranche de pièces, navigateur et
  serveur, par plan — la mesure qui manque à A-11.
- **Codes promo** : bénéficiaires actifs, calculs lancés, conversions.
- **Comptes** : vérification d'e-mail, opt-in newsletter, coffre, pays
  d'inscription, en agrégats.

### 6.4 Mécanisme

- `usage_daily` : un document par jour et par événement,
  `{ _id: 'AAAA-MM-JJ|événement', d, e, n, by: { dimension: { valeur: n } },
  x: { croisement déclaré }, expireAt }`, écrit par un seul module
  (`server/features/usage/count.js`, upsert `$inc`) après validation contre le
  catalogue ; jour en heure de Paris ; TTL 25 mois.
- `usage_cohort` : un document par semaine ISO d'inscription,
  `{ size, steps: { verified, project, nest, result, download, r7, r30, paid } }`,
  incrémenté **une seule fois par personne** grâce à des booléens sans date sur
  le compte (`users.milestones`), effacés avec lui — **à décider** (§8).
- Un rollup toutes les 15 min des jobs terminés (issue, catégorie d'échec,
  tranches) sur le modèle du plugin de purge.
- Les vues admin agrègent aussi à la demande `users`, `nesting_jobs` (30 jours,
  percentiles exacts) et `subscription_checkouts`, toujours sous le seuil de 5.
- `tracking` n'est plus écrit : l'historique est converti une fois en
  compteurs (jour × action, rien d'autre), puis la collection est supprimée
  (écriture en production, propriétaire).

Événements (dimensions énumérées uniquement) : `signup` (méthode),
`email_verified`, `project_created` (appareil / cloud), `import_cloud`
(format), `import_local` (format, issue, cause), `fiche_action` (échelle,
éclatement), `nest_requested` (lieu, niveau, tôles, directions, formats,
langue), `nest_refused` (raison), `nest_finished` par rollup (issue, catégorie
d'échec, tranches), `local_features` (réserve d'amorce, départ `.job`),
`export_local` et `download_server` (type), `result_opened`, `paywall_shown`
(déclencheur), `checkout_opened` / `checkout_completed` (plan, source),
`vault_action`.

### 6.5 Ce qu'on retire

Le cookie `nest2d_session_id` (expiré s'il est présent) ; le rattachement des
événements au compte à la connexion Google ; identifiant, cookie, pays et
champ libre dans `tracking` ; l'historique de clics sur la fiche utilisateur ;
les noms de fichiers dans le suivi ; la géographie par événement (reste le
pays d'inscription agrégé) ; la rétention calculée sur `tracking` ; l'IP
d'inscription (et dans l'e-mail envoyé à l'admin) ; Microsoft Clarity (inactif,
mais il enverrait le nom de l'utilisateur) et ses domaines dans la CSP ; la
recherche par personne dans les journaux.

### 6.6 L'admin, hors suivi

- **A1** — statuts réels dans une constante partagée
  (`shared/constants/jobStatus.js` : pending, processing, awaiting_local, done,
  error, cancelled) ; terminés comptés par `finishedAt` ; page Jobs avec tous
  les statuts, l'erreur métier (`information`), tri par `update_ts`, pagination
  réparée, compteur filtré ; vue « jobs navigateur bloqués » (pris depuis plus
  d'1 h, jamais expirés) ; libellés en français ; index sur `nesting_jobs`.
- **A2** — Free / Unlimited / Pro partout ; fiche utilisateur avec quota du
  mois, code promo, e-mail vérifié, coffre, durée des jobs navigateur, sans le
  lien mort `/project/_`, avec une projection explicite (plus le document
  entier) ; page Activité juste (checkouts **aboutis**, jour calendaire de
  Paris) ; copie d'e-mails et CSV filtrés sur le consentement newsletter ;
  support avec retour d'échec, sans la faute « d'NestorCut », e-mail dans la
  langue de l'utilisateur ; page « Journal admin » en lecture ; état d'erreur
  sur chaque page ; limite de tentatives à la connexion.

### 6.7 Cadre légal (à faire valider)

- **Traceurs** (ePrivacy art. 5.3, loi Informatique et Libertés art. 82) : tout
  cookie non strictement nécessaire exige un consentement, sauf l'exemption
  CNIL « mesure d'audience » (statistiques anonymes, aucun recoupement avec un
  compte, traceur de 13 mois au plus, données 25 mois au plus, information et
  opposition). Le cookie actuel, rattaché au compte, **ne remplit pas** la
  condition « aucun recoupement ». La conception proposée ne pose **aucun**
  traceur de mesure.
- **RGPD** : des compteurs sans identifiant sont anonymes une fois produits ;
  leur production reste un traitement à inscrire au registre (intérêt
  légitime proposé). Les jalons de cohorte sur le compte sont pseudonymes :
  base légale, information, opposition.
- **Avis juridique recommandé** sur trois points : compteurs émis depuis une
  session authentifiée, base légale des jalons, rédaction de la politique.

---

## 7. Lots proposés, dans l'ordre

| Lot | Contenu | Taille | Qui tranche |
|---|---|---|---|
| **S0** | Correctif de sécurité (consigne : `specs/AUDIT-SECURITE-2026-09-27.md` §2) | S | Vérificateur (défaut) ; production et communication : propriétaire |
| **V0.9.8** | S0 + trois corrections du CHANGELOG + panneau ☰ opaque ; `promote-latest` avec `images=nest2d-app` ; `sync-changelog.mjs` (V0.9.7 et V0.9.8) | S | Propriétaire (déploiement) |
| **M4** | Défauts d'atelier et de données : purge (A-2) avec rattrapage, constat des traits hors pièce (A-3), 429 (A-9), CI `shared/` et `admin/` (A-10), liste des résultats bornée et indexée (A-13), cause d'échec DWG (A-15), ZIP en erreur, vue `.job` plein écran, test tautologique ; et le lot M4-sécu du document privé | M | Vérificateur |
| **P** | Promesses du §4 sur le site (six langues) et dans les textes légaux de l'application | S-M | **Propriétaire** (texte) |
| **A1** | Admin : statuts réels, jobs, pagination, tableau de bord, index | M | Vérificateur |
| **U1** | Catalogue partagé, `/api/track` en compteurs, test de parité, test d'absence | M | Vérificateur (après décision §8) |
| **U2** | Compteurs serveur aux transitions (inscription, projet, import cloud, nest, refus, téléchargement, checkout, coffre) | M | Vérificateur |
| **U3** | Rollup des jobs terminés | M | Vérificateur |
| **U6** | Retraits (cookie, rattachement, IP, Clarity, `tracking`) + script de conversion lancé par le propriétaire | M | Propriétaire (écriture en production) |
| **U7a / U7b** | Vues admin : entonnoir, rétention ; adoption, qualité, imports, performance, conversion, codes promo, comptes | M + M | Vérificateur |
| **A2** | Admin : tiers, fiche, activité, utilisateurs, support, journal admin | M | Vérificateur |
| **U5** | Cohortes et jalons | M | Après décision |
| **U4 + P1** | Événements du navigateur ; politique de confidentialité (six langues) publiée **après** la production | M + S | Après décision et avis juridique |
| **AUD-1 → 3** | Le reste de la vague d'audit : échecs réels agrégés (accord du propriétaire), corpus, parcours de bout en bout, **mesure « même qualité pour tous »** | — | Plan d'audit |

Ce point couvre déjà l'essentiel de l'étape « promesses contre le code »
d'AUD-1 et la reprise des défauts connus.

---

## 8. Décisions du propriétaire

1. **Production, après le déploiement de S0** : vider le journal technique
   (détail dans le document privé), compter les comptes au coffre activé
   (nombre seul), dire où sont les sauvegardes et combien de temps elles
   vivent.
2. **Suivi** : remplacer **entièrement** le suivi individuel par des compteurs
   anonymes (recommandé), avec ou sans jalons de parcours sur le compte (ils
   donnent l'entonnoir et le retour par cohorte).
3. **Navigateur** : compter aussi les imports et exports faits dans le
   navigateur (catégories seulement), ce qui oblige à retoucher la phrase
   « le serveur ne reçoit que des métadonnées administratives » — ou s'en
   tenir à ce que le serveur voit déjà.
4. **Google Analytics sur le site** : bandeau de consentement, mesure sans
   cookie, ou retrait.
5. **Lieu de calcul des payants** : corriger le texte ou changer le produit.
6. **Textes légaux** (§4) : hébergeur et sous-traitants, licence, garantie,
   crédits.
7. Plus tard : identifiant `local:<e-mail>` à remplacer par un identifiant
   opaque (migration) ; admin ouvert sans mot de passe sur le réseau maison.

---

## 9. Non-faits

- Aucune lecture de la base de production : volumes réels, contenu effectif
  des journaux, nombre de comptes au coffre et résultat réel de la purge non
  mesurés (conclusions tirées du code déployé).
- Localisation du centre de données Hetzner non vérifiée.
- Textes du site en pt, it, de, es non relus phrase par phrase contre le code
  (couverture : anglais, et le français pour la licence et la confidentialité).
- Admin non lancé (aucune capture) : ergonomie et mobile jugés sur le code.
- Suites cargo et pytest non lancées ; corpus non rejoué ; clavier testé en
  Chromium seulement ; largeurs sous 1280 px non rejouées dans ce contrôle.
- Configuration réelle des serveurs (Caddy, pare-feu, homelab) non contrôlée.
