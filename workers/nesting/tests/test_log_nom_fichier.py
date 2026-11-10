"""Le journal du worker ne contient pas le nom du fichier de l'utilisateur
quand un refus le cite (gestionnaire d'erreur générique)."""
import pathlib


def _loggable():
    src = pathlib.Path(__file__).resolve().parents[2].joinpath(
        "common", "worker_common", "worker_loop.py").read_text(encoding="utf-8")
    start = src.index("def loggable_error(")
    end = src.index("@dataclass", start)
    ns = {"traceback": __import__("traceback")}
    exec(src[start:end], ns)  # noqa: S102 - extrait pur, sans import réseau
    return ns["loggable_error"]


def test_refus_utilisateur_journal_sans_nom_de_fichier():
    class UserFacingError(Exception):
        # même contrat que core.main.UserFacingError (vérifié plus bas)
        log_message = "Job refused (message withheld from logs)"

    loggable_error = _loggable()
    nom = "piece-secrete.dxf"
    try:
        try:
            raise ValueError("cause: " + nom)
        except ValueError as cause:
            raise UserFacingError("Part(s) too large: " + nom) from cause
    except UserFacingError as e:
        msg, tb = loggable_error(e)
    assert "piece-secrete" not in msg + tb
    assert "cause:" not in msg + tb
    assert "UserFacingError" in tb


def test_autre_erreur_journalisee_telle_quelle():
    loggable_error = _loggable()
    try:
        raise KeyError("x")
    except KeyError as e:
        msg, tb = loggable_error(e)
    assert msg == "'x'" and "KeyError" in tb


def test_les_refus_qui_citent_un_fichier_sont_des_erreurs_utilisateur():
    src = pathlib.Path(__file__).resolve().parents[1].joinpath(
        "core", "main.py").read_text(encoding="utf-8")
    assert "raise UserFacingError(message)" in src
    assert "raise UserFacingError(information) from e" in src


def test_classe_du_worker_porte_un_message_de_journal_neutre():
    src = pathlib.Path(__file__).resolve().parents[1].joinpath(
        "core", "main.py").read_text(encoding="utf-8")
    i = src.index("class UserFacingError(Exception):")
    assert "log_message = " in src[i:i + 600]
