# Rapport §8 bascule de dépôt (implémenteur) — 2026-09-08

Procédure `specs/infra/nouveau-depot/PROCEDURE-BASCULE.md` §8, instruction
fermée. Base : `3051dc6` (commit unique de la re-création du dépôt, arbre
issu de `1bde3bc` de l'archive). Les changements ci-dessous sont portés par
le commit qui contient ce rapport (unique descendant de `3051dc6` —
`git log --oneline` le donne).

## 1. Workflow de build — entrées strip retirées

`.github/workflows/build-images.yml` :
- matrice réduite aux quatre images réelles (`nest2d-app`, `nest2d-admin`,
  `nest2d-user-file-processing-worker`, `nest2d-nesting-worker`) — les deux
  entrées `nest2d-strip-*` pointaient vers des Dockerfiles supprimés par la
  re-création et faisaient échouer le job ;
- note d'en-tête et commentaire `platforms` mis en accord (le motif
  « spyrrow amd64 » ne s'applique plus ; amd64 conservé : hôte + homelab).

Vérifié : plus aucune occurrence de `strip` dans la matrice ; les images
ghcr `strip-*` existantes restent tirées par les stacks en place (le
`docker-compose.yml` les référence par image publiée, build commenté).

## 2. Tests

- `npx vitest run` : **43 fichiers, 485/485 tests verts** — clé
  `licences.own` présente FR+EN, aucun doublon (test d'unicité i18nDict
  inclus dans la suite).
- `npx nuxt build` : **build complet, sortie 9,55 Mo** — la page
  `/licences` et sa clé compilent.
- Image locale du banc reconstruite sur l'arbre neuf, `/licences` répond
  200.

## 3. Captures

`docs/qa/licence/` :
- `licences-fr.png` — page `/licences` 1440×900, français : le paragraphe
  « licence de NestorCut » (PolyForm Noncommercial 1.0.0, héritage MIT
  nest2d, jagua-rs MPL-2.0, marque) rendu avant le sous-titre.
- `licences-en.png` — même page en anglais.

Le paragraphe a été vérifié par son sélecteur (`.licences__text`) dans les
deux langues avant chaque capture (texte FR/EN lu dans le DOM).

## Non-faits

Aucun autre changement (instruction fermée respectée) : pas de code applicatif,
pas de déploiement (la page `/licences` publique sera visible au prochain
déploiement app, procédure habituelle).
