"""Bornes d'import du worker fileprocessing — miroir Python de
`nest-import::budget` (lot 2a, `docs/PLAN-IMPORT-2026-09-09.md` §9.2).

Deux gardes. Le plafond d'entités est la MÊME règle des deux côtés (c'est
une propriété du fichier) ; le budget de temps, non :

* **plafond d'entités** : 999 avant ce lot — il refusait côté navigateur
  11 fichiers réels que le serveur lisait (§8 du plan). Relevé à **10 000**,
  posé **avant** la polygonisation, sur `len(modelspace)` de la copie
  canonique — le même nombre que `validEntityCount`, jamais un second
  comptage ;
* **budget de temps** : contrôlé PENDANT le travail (boucle d'entités,
  attachement des handles, fusion) — au-delà, on arrête au lieu de payer
  l'import en entier puis de le jeter. **60 s ici, 20 s dans le
  navigateur** : un budget de temps est une propriété de l'IMPLÉMENTATION
  qui lit, pas du fichier (le même fichier bascule à 20,3 s sur un poste et
  20,6 s sur un autre — un seuil qui suit la charge de la machine n'est pas
  un seuil de produit). Un onglet attend devant l'utilisateur ; un worker
  est asynchrone, personne ne regarde son horloge. Arbitrage du
  vérificateur, 12/09, §9.5 du plan d'import.

Les deux sont réglables par variables d'environnement
(`MAX_ENTITY_LIMIT`, `IMPORT_TIME_BUDGET_S`) : une borne de temps est une
décision de produit, elle doit pouvoir bouger sans livrer du code.
"""
import os
import time

MAX_ENTITY_LIMIT_DEFAULT = 10000
TIME_BUDGET_S_DEFAULT = 60.0

# Cause d'un refus « trop lourd » (mêmes noms que TooHeavyReason en Rust).
REASON_ENTITIES = "entities"
REASON_TIME = "time"


class ImportTooHeavy(Exception):
    """Le fichier dépasse une borne d'import. Porte ses NOMBRES : ils vont
    dans le document Mongo et dans les logs — un refus sans chiffre n'est
    pas diagnosticable."""

    def __init__(self, reason, entity_count=0, max_entities=None,
                 elapsed_s=None, budget_s=None):
        self.reason = reason
        self.entity_count = entity_count
        self.max_entities = max_entities
        self.elapsed_s = elapsed_s
        self.budget_s = budget_s
        if reason == REASON_ENTITIES:
            msg = (f"too heavy for import: {entity_count} entities "
                   f"(limit {max_entities})")
        else:
            msg = (f"too heavy for import: {entity_count} entities, "
                   f"{budget_s} s time budget exceeded ({elapsed_s:.1f} s)")
        super().__init__(msg)

    def as_dict(self):
        """Champ ADDITIF pour `user_dxf_files` (piège #19b : on n'écrase
        aucun champ existant)."""
        out = {"reason": self.reason, "entityCount": self.entity_count}
        if self.max_entities is not None:
            out["maxEntities"] = self.max_entities
        if self.elapsed_s is not None:
            out["elapsedMs"] = int(self.elapsed_s * 1000)
        if self.budget_s is not None:
            out["timeBudgetMs"] = int(self.budget_s * 1000)
        return out


class Deadline:
    """Échéance de travail. `budget_s` à 0 ou None = pas de budget (chemin
    des tests et des outils, comportement d'avant le lot 2a).

    `check(i)` est ÉCHANTILLONNÉ comme en Rust : une lecture d'horloge
    toutes `STRIDE` itérations d'une boucle chaude.
    """

    STRIDE = 16

    def __init__(self, budget_s=None, entity_count=0):
        self.budget_s = float(budget_s) if budget_s else 0.0
        self.entity_count = entity_count
        self.start = time.monotonic()

    @property
    def elapsed_s(self):
        return time.monotonic() - self.start

    def expired(self):
        return self.budget_s > 0 and self.elapsed_s >= self.budget_s

    def check(self, i=None):
        if self.budget_s <= 0:
            return
        if i is not None and i % self.STRIDE != 0:
            return
        if self.expired():
            raise ImportTooHeavy(
                REASON_TIME,
                entity_count=self.entity_count,
                elapsed_s=self.elapsed_s,
                budget_s=self.budget_s,
            )


def max_entity_limit_from_env():
    return int(os.environ.get("MAX_ENTITY_LIMIT", str(MAX_ENTITY_LIMIT_DEFAULT)))


def time_budget_s_from_env():
    return float(os.environ.get("IMPORT_TIME_BUDGET_S", str(TIME_BUDGET_S_DEFAULT)))
