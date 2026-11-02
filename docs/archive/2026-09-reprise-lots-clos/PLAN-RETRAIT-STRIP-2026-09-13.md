# Retrait du pipeline « strip » (2026-09-13)

Décision propriétaire du 13/09 : **« Je retire le strip. »** Contexte : au
déploiement du lot E1, l'image `strip-file-processing-worker` n'a pas suivi
le nettoyage géométrique — et pour cause, le pipeline « strip »
(`strip-file-processing` + `strip-nesting`, variante « bande » historique
sur spyrrow) **n'a aucune source dans ce dépôt** : images préconstruites,
pipeline distinct, collections `stripUserDxf` / `stripNestDxf`. Il ne peut
suivre aucune règle des lots récents. Le propriétaire choisit de le retirer.

## 1. Inventaire (vérificateur, 13/09 — le grep couvre `server/`, `app/`, `admin/`, `shared/`, `scripts/`, `workers/`, `docs/`, compose, `nuxt.config.js`)

| Zone | Fichiers |
|---|---|
| serveur | `server/api/strip/[slug]/nest.post.js`, `server/api/files/strip/dxf/[file].get.js`, `server/api/files/strip/nest/dxf/[file].get.js`, `server/core/domains.js` (domaine `strip`, `workerTag: "strip"`), `server/core/project/service.js`, `server/db/mongo.js`, `server/features/purge/sweep.js`, `server/features/project/delete.js`, `server/features/account/delete.js`, `server/api/security/vault/{job-dek,destroy,disable,rotate}.post.js`, `server/api/track/index.post.ts`, tests `purge`, `projectDelete`, `vault-jobdek` |
| app | `app/pages/strip/index.vue`, `app/pages/strip/[slug].vue`, `app/components/Strip{File,FileModal,ProjectItem}.vue`, `app/composables/strip.js`, `app/middleware/strip.js`, `app/composables/apiRoutes.js`, `app/composables/useModalState.js`, liens dans `MainHeader.vue`, `profile.vue`, `Subscription.vue` |
| admin | `admin/app/components/JobTable.vue`, `admin/server/db/mongo.ts`, `admin/server/api/users/[id]/free-month.post.ts`, `admin/app/pages/payments.vue` (à vérifier : « strip » ou « stripe »), `admin/app/pages/activity.vue` |
| workers | `workers/common/worker_common/worker_loop.py`, `worker_common/mongo.py`, `workers/common/README.md`, `pyproject.toml`, `workers/nesting/core/main.py` |
| infra & docs | `docker-compose.yml` (services `strip-file-processing-worker`, `strip-nesting-worker`), `nuxt.config.js`, `scripts/mongo-indexes.mjs`, `scripts/create-live-products.mjs` (**un produit Stripe « strip » ?** à confirmer), `docs/ARCHITECTURE.md`, `docs/README.md`, `DEVELOPMENT.md`, `AUDIT-LICENCE-DEPOT-2026-09-07.md` |

## 2. Consigne (fermée) — lot S, un commit, un rapport en §3

Objectif : plus aucun chemin « strip » servi, ni conteneur, ni route, ni
page, ni lien ; les données existantes ne sont **pas** détruites.

1. **Sweep d'abord** (convention AGENTS §7 : grep sur `scripts/`, tests et
   `workers/` compris), liste exacte au rapport ; toute occurrence de
   « strip » qui est en fait « stripe » ou `String.strip` est laissée.
2. **Retirer** : les deux services du compose (dev ET prod, sauvegarde du
   compose de prod gardée) ; les routes API et les pages/composants/
   middleware/composables strip ; les liens d'en-tête, de profil et
   d'abonnement ; le domaine `strip` de `domains.js` et son `workerTag` ;
   la colonne ou le filtre strip du `JobTable` admin ; les références dans
   `worker_loop.py` / `mongo.py` ; les index `strip*` de
   `mongo-indexes.mjs` (le script ne crée plus, il ne supprime rien) ;
   la variante dans `main.py` si elle existe.
3. **Données** : les collections et buckets `stripUserDxf` / `stripNestDxf`
   restent en place, intacts ; le sweeper de purge (D-PRV-10) **continue de
   les couvrir** tant qu'ils existent (une purge qui s'arrête = des fichiers
   qui restent à vie), avec un test qui le prouve ; leur suppression est
   une décision séparée du propriétaire, écrite en prod, jamais dans ce lot.
4. **Stripe** : si `create-live-products.mjs` décrit un produit « strip »,
   ne rien toucher côté Stripe (compte du propriétaire) ; signaler au
   rapport ce qu'il faudrait archiver là-bas.
5. **Docs** : `ARCHITECTURE.md` (schéma et tableau des services),
   `docs/README.md`, `workers/common/README.md`, une ligne au registre du
   masterplan ; `STRATEGY.md` si le produit y est cité.
6. **Verrous** : `npx vitest run` et pytest common verts après retrait ;
   `nuxt build` vert ; `GET /strip` et `/api/strip/...` répondent 404 ;
   aucune occurrence résiduelle au grep hors « stripe » et `.strip(` ;
   après déploiement, `docker compose ps` de prod sans service strip,
   `assert_overflow_head.py` inchangé (homelab non concerné), 0 ERROR.
7. **Ordre** : après le déploiement d'E1-bis, avant E2 (½ journée).

## 3. Rapport (implémenteur, 13/09)

**Livré** : 72 fichiers touchés — **23 supprimés**, 49 modifiés,
163 insertions / 2 378 suppressions. Un commit.

### 3.1 Sweep (avant de toucher quoi que ce soit)

`git grep -i strip` sur tout le dépôt (hors `docs/archive/`, lockfiles et
`public/engine/`) rend 240 fichiers. Le tri a été fait sur les marqueurs du
DOMAINE (`stripSlug`, `strip_user_dxf`, `stripUserDxf`, `stripNestDxf`,
`strip_nesting`, `strip-file-processing`, `strip-nesting`, `isStrip*`,
`stripProject*`, `DOMAINS.strip`, `"strip"`, `/strip`) : **69 fichiers**
réellement concernés. Tout le reste est l'un des trois cas laissés
intentionnellement :

| Cas laissé | Exemples | Pourquoi |
|---|---|---|
| « stripe » (paiement) | `server/features/payment/stripe.js`, `admin/server/utils/stripe.ts`, `scripts/create-live-products.mjs` | autre mot |
| `String.strip()` / `.rstrip()` | `scripts/qa-import-ezdxf.py`, `worker_common/crypto.py` | méthode Python |
| **strip packing** = le mode SPP du moteur | `strip_width`, `strip_height`, `max_strip_width`, piège AGENTS #2b, `sparrow`, `jagua-rs/probs/spp` | c'est le cœur du moteur, aucun rapport avec le pipeline retiré |

Deux non-faits de l'inventaire du §1, mesurés : **`scripts/mongo-indexes.mjs`
ne contient aucun index `strip*`** (rien à retirer) et
**`scripts/create-live-products.mjs` ne décrit AUCUN produit « strip »** —
ses occurrences sont toutes « Stripe ». Rien à archiver côté Stripe
(point §2.4 : sans objet). `.github/workflows/build-images.yml` ne construit
déjà aucune image strip (un commentaire l'explique depuis la re-création du
dépôt).

### 3.2 Retiré

**Supprimés (23 fichiers)**

- serveur (10) : `server/api/strip/` en entier (`index.post.js`, `me.get.js`,
  `[slug]/{index.get,index.delete,addfiles.post,nest.post,results.get}.js`),
  `server/api/files/strip/{dxf,nest/dxf}/[file].get.js`,
  `server/utils/featureFlags.js` (n'existait que pour le drapeau strip) ;
- app (13) : `app/pages/strip/{index,[slug]}.vue`, `app/layouts/strip.vue`,
  `app/middleware/strip.js`, `app/composables/strip.js`,
  `app/components/Strip{File,FileModal,ProjectItem,Projects,ResultItem,ResultModal,Results,Settings}.vue`.

**Modifiés — les points de la consigne, un par un**

1. **Compose** : les services `strip-file-processing-worker` et
   `strip-nesting-worker` sont retirés de `docker-compose.yml`, ainsi que la
   variable `NUXT_PUBLIC_STRIP_ENABLED` passée à l'app.
   `docker compose config --services` rend exactement : `admin`, `app`,
   `mongo`, `mongo-init`, `nesting-worker`, `user-file-processing-worker`.
2. **Domaine** : l'entrée `strip` de `server/core/domains.js` (collections,
   bucket, `workerTag: "strip"`, préfixe de slug) est supprimée ; il ne reste
   que `bin`. `FILE_MAPPERS` perd `strip`, `mapStripFileToUi` et
   `minRequiredHeight` (la hauteur minimale de bande n'avait qu'un appelant)
   disparaissent de `server/core/project/service.js` ;
   `RESULT_DXF_BUCKET` de `features/project/delete.js` perd sa clé `strip`.
3. **Liens & UI** : l'onglet `/strip` de `MainHeader.vue` et son calcul
   `isStripFeatureEnabled` (plus `isStripPage`, mort), les routes `STRIP_*`
   d'`apiRoutes.js`, `useStripFileDialog` / `useStripResultDialog`, la clé
   i18n `nav.strip` (EN + FR).
4. **Drapeau** : `isStripFeatureEnable` n'est plus posé à l'inscription
   (`register.post.js`, `utils/user.js`) ni servi par `/api/user`. Le CHAMP
   reste sur les documents `users` existants (donnée, non touchée).
5. **Suivi** : les six évènements `click_strip_*` sortent de la liste blanche
   de `/api/track` (plus aucun émetteur).
6. **Admin** : la file strip sort de `/api/jobs` (fusion des deux systèmes →
   une seule requête), des stats d'aperçu (`queued/processing/failed` ne
   somment plus deux files), de l'activité du jour (tuile « Strip »), de la
   fiche utilisateur (compteur « Strip projets », fusion des 30 derniers jobs
   et des totaux), et les deux noms de collections quittent `COL`.
7. **Workers** : les mentions `strip_user_dxf_files` /
   `strip_nesting_job_queue` des en-têtes de `worker_loop.py` et `mongo.py`,
   « les 4 workers » du `README.md` de `worker_common`, la note
   `stripnesting` de `pyproject.toml`. **Aucune variante strip dans
   `workers/nesting/core/main.py`** (point §2.2 : sans objet — les
   occurrences y sont toutes du strip packing).
8. **Docs** : `docs/ARCHITECTURE.md` (schéma + tableau des workers, avec
   l'encart de retrait), `DEVELOPMENT.md` (« all four workers » et la ligne
   `docker compose up`), `admin/README.md`, `.env.example`
   (`NUXT_PUBLIC_STRIP_ENABLED` retiré), `nuxt.config.js` (`stripEnabled`).

**Un défaut réel trouvé au passage** : `app/components/UnitSwitcher.vue`
appelait `stripStore.actions.syncParamsToUnit(to)` — un store importé nulle
part dans ce fichier. Le watch d'unités serait tombé en
`stripStore is not defined` **dès que le switch mm/pouces est activé**
(`NUXT_PUBLIC_UNIT_SWITCH_ENABLED`, éteint en prod) : la conversion des
valeurs du formulaire ne se faisait jamais. La ligne est retirée ; le seul
appel qui reste est celui du store des fichiers.

### 3.3 Données : rien détruit, purge maintenue

Les collections `strip_projects`, `strip_user_dxf_files`,
`strip_nesting_job_queue` et les buckets `stripUserDxf` / `stripNestDxf`
restent en base, intacts. La ligne de partage que j'ai tenue :

- les chemins de **REQUÊTE** disparaissent — routes, pages, domaine, et la
  liste blanche de `POST /api/security/vault/job-dek` (plus aucun worker
  strip ne peut demander une DEK) ;
- les chemins de **CYCLE DE VIE** restent — `features/purge/sweep.js`
  (buckets + documents), `features/account/delete.js` (RGPD : les données
  d'un compte supprimé partent en entier), et le coffre
  (`vault/{destroy,disable,rotate}.post.js`, qui doit pouvoir détruire,
  déchiffrer et faire tourner la clé des blobs conservés).

Verrou ajouté : `server/tests/purge.test.js` → « le strip retiré reste
purgé », deux cas — `stripUserDxf`/`stripNestDxf` balayés par ancienneté
comme les buckets bin (2 blobs supprimés, le frais gardé), et les documents
`strip_user_dxf_files` marqués `purgedAt` + géométrie vidée (1 sur 2, le
récent épargné). Sans ce verrou, un retrait futur de ces noms du sweeper
laisserait les fichiers **à vie** (D-PRV-10).

### 3.4 Arbitrage consigné : le panneau du coffre

`app/pages/profile.vue` affichait `<VaultSettings>` derrière
`v-if="isStripFeatureEnable"` — **le drapeau strip était le seul garde du
panneau du coffre**. Retirer le drapeau le rendait invisible pour tout le
monde (régression) ou visible pour tout le monde (changement de surface).
J'ai choisi **visible pour tout le monde**, parce que c'est ce que disent les
décisions déjà écrites : `server/api/security/vault/enable.post.js` porte
« paid feature; the legacy `hasPrivacyTier` gate is gone » — le serveur
l'ouvre déjà à tous les plans — et AGENTS §35 / `docs/STRATEGY.md` posent que
la privacy n'est jamais une feature payante. **Conséquence visible en prod :
la carte « coffre » apparaît sur la page profil de tous les comptes.** Si le
propriétaire veut la garder derrière un drapeau, il faut un drapeau qui ne
s'appelle pas « strip » (le renommage du champ Mongo est une migration de
données, hors de ce lot).

### 3.5 Verrous rejoués

| Verrou | Résultat |
|---|---|
| `npx vitest run` | **54 fichiers, 581 tests verts** (0 échec) — dont les 2 nouveaux de purge ; retirés : le `describe` « deleteProjectCascade — domaine strip » (le domaine n'existe plus) et l'assertion `DOMAINS.strip.rejectForeignProject` de `filesAccess.test.js` ; `vault-jobdek.test.js` « finds jobs across every vault-capable collection » bascule sur `user_dxf_files` |
| pytest `worker_common` (image docker) | **83 passés** |
| pytest `fileprocessing` (image docker) | **42 passés** |
| `npx nuxt build` (app) | vert — 9,43 Mo, 2,52 Mo gzip |
| `npx nuxt build` (admin) | vert — 4,21 Mo, 1,06 Mo gzip |
| `docker compose config --services` | 6 services, **aucun strip** |
| grep résiduel du domaine | **0**, aux deux exceptions documentées près : le commentaire de `profile.vue` qui explique quel drapeau gardait le coffre, et celui de `build-images.yml` qui rappelle que les images strip ne sont plus construites |

### 3.6 Reste à faire (déploiement, après GO)

- copier le `docker-compose.yml` du dépôt vers `/opt/nestorcut` **avec
  sauvegarde horodatée du fichier remplacé**, `docker compose pull`,
  `docker compose up -d --remove-orphans` (les deux conteneurs strip sont
  arrêtés et retirés), puis `docker compose ps` sans service strip et les
  logs app/workers à 0 ERROR ;
- `GET /strip` et `GET /api/strip/me` en 404 sur la prod servie ;
- **homelab non concerné** (aucun changement dans `workers/nesting` ni le
  moteur) : `assert_overflow_head.py` reste au HEAD précédent, et les
  benchmarks publics ne sont pas invalidés (`git diff` ne touche ni
  `workers/nesting/engine` ni `public/engine`).


## 4. Vérification (vérificateur, 13/09, `3824d84c`) — GO déploiement

Rejoué sur le poste, pile locale reconstruite à HEAD (`app` et
`user-file-processing-worker`, `up -d --remove-orphans`) :

| Verrou | Résultat |
|---|---|
| vitest | 591 (avec E2), dont les deux cas « le strip retiré reste purgé » |
| `docker compose config --services` | `mongo admin app mongo-init nesting-worker user-file-processing-worker` — aucun strip ; `compose ps` sans conteneur strip |
| routes | `GET /strip`, `/api/strip`, `/api/strip/me` → **404** ; accueil 200 |
| grep résiduel du domaine (`server`, `app`, `admin`, `shared`, `scripts`, `workers`, `docs`) | ne restent que les chemins de cycle de vie (`purge/sweep.js` et son test, `account/delete.js`, `vault/*`), la doc d'architecture et le registre — plus « stripe » et le strip packing du moteur, qui n'ont rien à voir |

**Arbitrages** : (a) le panneau du coffre visible pour tous les comptes est
**accepté** — c'est la lettre d'AGENTS §35 et de `STRATEGY.md` (la privacy
n'est jamais payante ; le serveur l'ouvrait déjà) ; le drapeau `strip` ne
gardait ce panneau que par accident. (b) La correction d'`UnitSwitcher.vue`
(appel d'un store inexistant) est un vrai défaut latent, bien pris.
Les deux points « sans objet » de l'inventaire (index Mongo, produit Stripe)
sont acceptés tels que mesurés.

**GO déploiement** selon §3.6 : compose de prod remplacé avec sauvegarde
horodatée, `up -d --remove-orphans`, `ps` sans strip, 404 sur la prod servie,
0 ERROR ; homelab non concerné.


## 5. Déploiement (implémenteur, 13/09)

Déployé à `d890c923` (le commit du lot est `3824d84c` ; la prod tire
`:latest`, construit sur `d890c923` — même code, plus les captures du lot E2,
déployé dans la même fenêtre).

**Manœuvre**, dans cet ordre :

1. les DEUX conteneurs strip arrêtés proprement puis retirés **pendant que
   l'ancien compose les définissait encore** (`docker compose stop` puis
   `rm`, jamais `rm -f` — piège AGENTS #19 : un SIGKILL laisse un job
   orphelin et une lease de jetons bloquée) ;
2. `docker-compose.yml` sauvegardé en
   `docker-compose.yml.bak-20260913T105312Z` (la sauvegarde du lot 2a est
   conservée à côté), puis remplacé par celui du dépôt —
   `sha256 c1f1b728…` des deux côtés. **L'ancien fichier de prod était
   octet pour octet celui du dépôt d'avant le lot** (`e1dc5a69…`) : aucune
   retouche locale n'a été écrasée. Le `docker-compose.override.yml` de
   production (ports, `mongo-wg`, profil admin) n'a pas été touché ;
3. `docker compose --profile admin pull` puis
   `up -d --remove-orphans` — **le profil admin est activé exprès** : sans
   lui, `--remove-orphans` traite le conteneur admin comme un orphelin.

| Contrôle | Résultat |
|---|---|
| services du compose de prod | **6**, `app mongo mongo-init mongo-wg nesting-worker user-file-processing-worker` — **aucun strip** |
| conteneurs | tous `Up` (admin compris), aucun conteneur strip |
| commit servi | `NUXT_PUBLIC_GIT_COMMIT_SHA=d890c923…` |
| routes strip sur la prod servie | `/strip` **404**, `/strip/abc` **404**, `/api/strip/me` **404**, `/api/strip/abc/results` **404**, `/api/files/strip/dxf/x.dxf` **404** ; `/` **200** |
| journaux | **0 ERROR / Traceback** sur 200 lignes — app, nesting-worker, user-file-processing-worker, admin |
| homelab | non concerné par CE lot (mais recréé pour E2, voir le rapport E2) |

**Un fait à consigner, mesuré après le déploiement** : en production, **aucune
collection ni bucket « strip » n'existe** — `db.getCollectionNames()` ne rend
que `stripe_status` (Stripe, autre mot), et les cinq noms attendus
(`strip_projects`, `strip_user_dxf_files`, `strip_nesting_job_queue`,
`stripUserDxf`, `stripNestDxf`) sont absents. La garantie « les données
existantes ne sont pas détruites » est donc **vide de contenu en prod** : il
n'y avait rien à conserver. Le code de purge et de suppression de compte qui
les couvre reste en place (il ne coûte rien et reste correct si une base de
développement en contient), mais la question « quand supprimer ces
collections » **ne se pose pas** sur ce serveur.
