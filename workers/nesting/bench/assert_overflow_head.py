"""Contrôle des workers « overflow » du homelab contre HEAD git — lecture seule.

Les trois workers de débordement (homelab, tunnel WireGuard) consomment la
MÊME file `nesting_jobs` que la prod Hetzner. S'ils tournent une image plus
ancienne, une partie des jobs de production est calculée avec un moteur et
un post-pass différents de ceux qui viennent d'être vérifiés et déployés
(constaté le 2026-09-06 : image du 31/08, sans `residual.py` ni
`capacity.py`, moteur pré-P3, alors que 6 lots avaient été déployés sur
Hetzner). Ce script compare les md5 des fichiers clés de chaque conteneur
overflow au contenu de HEAD, et la date du binaire moteur au dernier
commit `engine/`.

Usage (depuis le poste de dev, sur le LAN du homelab) :
    OVERFLOW_HOST=<adresse du runbook privé> OVERFLOW_USER=root \
    OVERFLOW_PASS=... python workers/nesting/bench/assert_overflow_head.py
  (ou OVERFLOW_KEY=~/.ssh/id_ed25519 à la place du mot de passe)

Sortie : OK si tous les conteneurs = HEAD, sinon STALE + détail, code 1.
À rejouer APRÈS chaque déploiement worker (AGENTS.md §6bis), comme
`assert_images_head.sh` pour les images locales.
"""
import hashlib
import os
import subprocess
import sys

FILES = ["core/residual.py", "core/main.py", "core/metrics.py",
         "core/holefill.py", "core/capacity.py"]
WORKERS = ["nestorcut-overflow-worker-1", "nestorcut-overflow-worker-2",
           "nestorcut-overflow-worker-3"]


def head_md5(path):
    out = subprocess.run(["git", "show", f"HEAD:workers/nesting/{path}"],
                         capture_output=True, check=True).stdout
    return hashlib.md5(out).hexdigest()


def main():
    try:
        import paramiko
    except ImportError:
        print("paramiko requis : pip install paramiko")
        return 2
    host = os.environ.get("OVERFLOW_HOST")
    if not host:
        print("OVERFLOW_HOST manquant (adresse du homelab : runbook privé specs/infra/)")
        return 2
    user = os.environ.get("OVERFLOW_USER", "root")
    pw = os.environ.get("OVERFLOW_PASS")
    key = os.environ.get("OVERFLOW_KEY")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, username=user, password=pw,
              key_filename=os.path.expanduser(key) if key else None, timeout=15)

    def run(cmd):
        _, o, _e = c.exec_command(cmd, timeout=60)
        return o.read().decode("utf-8", "replace")

    expected = {f: head_md5(f) for f in FILES}
    engine_commit = subprocess.run(
        ["git", "log", "-1", "--format=%cI", "--", "workers/nesting/engine"],
        capture_output=True, text=True).stdout.strip()
    stale = False
    for w in WORKERS:
        out = run(f"docker exec {w} sh -c 'cd /app && md5sum {' '.join(FILES)} 2>&1; "
                  f"stat -c %y /usr/local/bin/nest-engine'")
        got = {}
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 2 and len(parts[0]) == 32:
                got[parts[1]] = parts[0]
        for f, md in expected.items():
            if got.get(f) != md:
                stale = True
                print(f"STALE {w}: {f} = {got.get(f, 'ABSENT')} (HEAD {md})")
        print(f"{w}: binaire moteur {out.strip().splitlines()[-1] if out.strip() else '?'}"
              f" | dernier commit engine/ {engine_commit}")
    img = run("docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' "
              "| grep nest2d-nesting-worker")
    print("image overflow :", img.strip() or "?")
    c.close()
    if stale:
        print("ASSERT OVERFLOW=HEAD: STALE — sur le homelab : "
              "cd /containers/nestorcut-overflow && docker compose pull && "
              "docker compose up -d --force-recreate")
        return 1
    print("ASSERT OVERFLOW=HEAD: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
