# Tags d'images : `:latest` ne désigne que ce qui a reçu un GO (2026-09-13)

## 1. Le constat

Le 13/09, après le déploiement des lots S et E2 (épinglé par SHA) et la
livraison de J1 puis du lot 2d, l'état du registre était celui-ci :

| | commit |
|---|---|
| app en **production** | `53f93d2c` (les benchmarks régénérés — le contenu qui avait le GO) |
| `:latest` de **ghcr** | `7622f46c` — J1, une note de pilotage et le lot 2d, **sans GO** |

`build-images.yml` publiait `:latest` **à chaque poussée sur `main`**. Or la
procédure de déploiement des deux machines est `docker compose pull &&
docker compose up -d` : un `pull` nu sur la prod ou sur le homelab
**déployait donc n'importe quel lot poussé**, sans passer par un GO. Le
mécanisme est resté invisible tant que chaque GO suivait la poussée de près ;
il devient dangereux dès qu'un lot attend (J1 attend son GO, le lot 2d
attendait le sien).

C'est un défaut de **procédure**, pas de code produit : rien n'a été déployé
à tort, l'écart a été vu avant. Décision du propriétaire le 13/09 :
« la CI ne déplacera plus `:latest` à chaque poussée ».

## 2. Consigne (fermée) — lot D1, un commit

1. `build-images.yml` publie **`:<sha>`** (immuable) et **`:main`** (le
   dernier build, jamais tiré par un serveur) ; **plus jamais `:latest`**.
2. Un workflow **manuel** `promote-latest` (`workflow_dispatch`, entrée SHA)
   déplace `:latest` sur le SHA du GO, pour les quatre images (`nest2d-app`,
   `nest2d-admin`, `nest2d-user-file-processing-worker`,
   `nest2d-nesting-worker`).
3. Le runbook privé (`specs/infra/DEPLOY-HETZNER.md`) et AGENTS §6 disent la
   nouvelle règle ; prod et homelab restent sur `:latest`, donc leur
   procédure redevient sûre **sans changer leurs `docker-compose.yml`**.
4. Verrou : après une poussée sur `main`, le `:latest` de ghcr **ne bouge
   pas** ; « promote » sur un SHA le fait bouger, vers **le digest exact** de
   ce SHA.

## 3. Rapport (implémenteur, 13/09)

### 3.1 Livré

- **`.github/workflows/build-images.yml`** : le tag `:latest` est retiré de
  la liste poussée, remplacé par `:main`. `:<sha>` est inchangé.
- **`.github/workflows/promote-latest.yml`** (nouveau) : `workflow_dispatch`
  avec deux entrées — `sha` (obligatoire) et `images` (défaut `all`, sinon
  une liste séparée par des espaces). Il **refuse** un SHA qui n'est pas 40
  caractères hexadécimaux (un SHA court ou un nom de branche donnerait un
  `:latest` qui ne désigne rien de vérifiable), puis retague avec
  `docker buildx imagetools create` : **aucune reconstruction**, le `:latest`
  promu porte le **même digest** que le `:<sha>` vérifié. Le récapitulatif du
  run rappelle la commande de déploiement.
- **AGENTS §6** et le **runbook privé** : la règle, les corollaires
  (`:main` n'a rien à faire dans un compose de serveur ; attendre que le
  build du commit soit `completed` avant de promouvoir ; un déploiement
  partiel d'urgence par SHA reste possible mais se dit au rapport).

Le choix de `images` par lot n'est pas un confort : le 13/09, la production
tournait **trois SHA différents** selon le service (app `53f93d2c`, workers
nesting et admin `d890c923`, worker fileprocessing `7622f46c`). Sans cette
entrée, promouvoir aurait forcé un alignement que personne n'a vérifié.

### 3.2 Mesures

**État du registre avant le lot** (digests lus par
`docker buildx imagetools inspect`, sans rien tirer) :

| image | `:latest` avant | ce que la prod exécutait |
|---|---|---|
| `nest2d-app` | `c858c205…` (build de `7622f46c`) | `5a6b371a…` = **`53f93d2c`** |
| `nest2d-admin` | `b03382a3…` | `ea48d5e3…` = `d890c923` |
| `nest2d-nesting-worker` | `c4dbb6c7…` | `6ee233c7…` = `d890c923` |
| `nest2d-user-file-processing-worker` | `62906ba7…` | `62906ba7…` = `7622f46c` |

Trois des quatre `:latest` désignaient donc autre chose que la production —
et pour l'app, un contenu **sans GO**. C'est le défaut, chiffré.

**Le verrou, en deux temps** : VERROU_D1

### 3.3 Après le lot

`:latest` est promu sur ce que la production exécute, service par service :
l'app sur `53f93d2c`, admin et le worker nesting sur `d890c923`, le worker
fileprocessing sur `7622f46c`. À partir de là, `:latest` du registre ≡
production, et un `docker compose pull && up -d` sur l'une des deux machines
ne peut plus livrer un lot sans GO.

### 3.4 Non-faits

1. **Le homelab n'a pas été retiré de `:latest`** et n'avait pas à l'être :
   c'est justement le point du lot — sa procédure
   (`docker compose pull && up -d --force-recreate`) redevient sûre sans
   changement de son `docker-compose.yml`.
2. **Les images déjà publiées gardent leur tag `:latest` historique** : rien
   n'est retiré du registre, seule la règle de déplacement change.
3. Le workflow `promote-latest` **n'ouvre pas de garde-fou de GO** : il fait
   confiance à celui qui le lance (le propriétaire ou l'implémenteur après un
   GO écrit). Brancher une vérification automatique (« ce SHA a-t-il un
   rapport de vérification ? ») serait un autre chantier, et probablement
   plus de cérémonie que de sûreté sur un dépôt à un seul décideur.
