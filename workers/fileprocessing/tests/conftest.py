"""Les tests du lecteur importent `core.main`, qui importe
`worker_common.mongo` ; ce module exige `MONGO_URI` des l'import.

Le client pymongo est paresseux : aucune connexion n'est ouverte tant qu'aucune
requete n'est faite, et les tests simulent la base. Une adresse locale et un
nom de base reserve aux tests suffisent. Une variable deja definie n'est pas
remplacee.
"""
import os

os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017/nestorcut_tests_no_db")
