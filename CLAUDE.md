# NestorCut — point d'entrée des agents

@AGENTS.md

## Démarrage rapide

- **Boussole produit** : `AGENTS.md` (en-tête) — la référence du nesting
  dans le navigateur ; chemin navigateur d'abord, un seul code, pas de CAM.
- **Carte des documents** : plans, décisions, specs et audits sont dans le
  coffre Obsidian privé du propriétaire (il fait foi pour le QUOI et le
  POURQUOI) ; le dépôt ne garde que `docs/dwg-license.md` et
  `docs/encryption-premium.spec.md`. Ne recrée jamais de plan ou rapport
  sous `docs/` ou `specs/`.
- **Pièges techniques** : `AGENTS.md` §2, à lire avant de toucher au moteur,
  au worker Python, au miroir JS du post-pass ou au visualizer.
- **Discipline de mesure** : `assert_images_head.sh` OK avant tout banc ;
  workers locaux recréés sur l'image reconstruite (`docker compose up -d
  --force-recreate nesting-worker`) ; temps navigateur mesurés **au repos**
  (aucun build, agent à l'arrêt), `QA_OUT` hors OneDrive, valeur = durée de
  calcul du harnais et non `solveDoneAt` ; répartitions BPP du corpus =
  bruit run-to-run, deux passages avant de conclure ;
  harnais navigateur `scripts/qa-e2e-local-2sheets.mjs` dans ses deux
  configurations ; rapport constat par constat, non-faits énoncés.
- **Déploiement** : `AGENTS.md` §6 — un déploiement worker ou moteur se
  termine sur le homelab (`assert_overflow_head.py` OK) et régénère les
  benchmarks publics si le moteur a changé.
- **Rôles** : le propriétaire décide ; l'implémenteur (GLM 5.3 Max) livre
  un rapport par lot (dans le coffre privé) ; le vérificateur rejoue,
  donne GO / NO-GO ; on déploie après le GO seulement.
