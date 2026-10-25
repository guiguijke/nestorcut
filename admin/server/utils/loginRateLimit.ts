// S-6 : limite des tentatives de connexion admin (en mémoire, mono-process —
// même approche que server/utils/ratelimit.js de l'app, dont l'admin ne
// dépend pas). Deux compteurs indépendants : par IP et par identifiant.
// Fonctions pures (pas d'import h3) pour être testables hors Nitro.
//
// Protocole : la tentative est RÉSERVÉE avant le bcrypt (`reserveLoginAttempt`,
// synchrone : contrôle + enregistrement sans `await` entre les deux, donc une
// rafale parallèle ne dépasse pas la limite), puis libérée si elle réussit.
//
// Limite connue : le compteur par identifiant permet à un tiers de verrouiller
// le compte admin (5 échecs / 15 min) ; le compteur par IP reste le frein
// principal. Contrepartie acceptée pour un back-office à très peu de comptes.

export const LOGIN_FAIL_LIMIT = 5
export const LOGIN_FAIL_WINDOW_MS = 15 * 60_000
export const MAX_TRACKED_EMAILS = 10_000

type Bucket = { windowStart: number; count: number }
const ipBuckets = new Map<string, Bucket>()
const emailBuckets = new Map<string, Bucket>()
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < LOGIN_FAIL_WINDOW_MS) return
  lastSweep = now
  for (const map of [ipBuckets, emailBuckets]) {
    for (const [key, b] of map) {
      if (now - b.windowStart >= LOGIN_FAIL_WINDOW_MS) map.delete(key)
    }
  }
}

function live(map: Map<string, Bucket>, key: string, now: number): Bucket | undefined {
  const b = map.get(key)
  return b && now - b.windowStart < LOGIN_FAIL_WINDOW_MS ? b : undefined
}

function bump(map: Map<string, Bucket>, key: string, now: number) {
  const b = live(map, key, now)
  if (b) {
    b.count += 1
    return
  }
  map.delete(key)
  map.set(key, { windowStart: now, count: 1 })
}

/** Délai restant (ms) avant de pouvoir réessayer, 0 si autorisé. Ne consomme pas. */
export function loginRetryAfterMs(ip: string, email: string, now = Date.now()): number {
  sweep(now)
  let wait = 0
  for (const b of [live(ipBuckets, ip, now), live(emailBuckets, email, now)]) {
    if (b && b.count >= LOGIN_FAIL_LIMIT) wait = Math.max(wait, b.windowStart + LOGIN_FAIL_WINDOW_MS - now)
  }
  return wait
}

/** Enregistre une tentative (réservation, ou échec) sur l'IP et l'identifiant. */
export function recordLoginFailure(ip: string, email: string, now = Date.now()) {
  bump(ipBuckets, ip, now)
  bump(emailBuckets, email, now)
  // Mémoire bornée : les plus anciennes clés sortent (ordre d'insertion).
  while (emailBuckets.size > MAX_TRACKED_EMAILS) {
    const oldest = emailBuckets.keys().next().value
    if (oldest === undefined) break
    emailBuckets.delete(oldest)
  }
}

/**
 * Contrôle + réservation, sans `await` entre les deux. Renvoie le délai
 * restant (ms) si la limite est atteinte (rien n'est réservé), sinon 0.
 */
export function reserveLoginAttempt(ip: string, email: string, now = Date.now()): number {
  const wait = loginRetryAfterMs(ip, email, now)
  if (wait > 0) return wait
  recordLoginFailure(ip, email, now)
  return 0
}

/** Succès : efface le compteur de l'identifiant et libère la réservation de l'IP. */
export function resetLoginFailures(email: string, ip?: string) {
  emailBuckets.delete(email)
  const b = ip === undefined ? undefined : ipBuckets.get(ip)
  if (b) {
    b.count -= 1
    if (b.count <= 0) ipBuckets.delete(ip as string)
  }
}

export function trackedEmailCount() {
  return emailBuckets.size
}

export function _clearLoginBuckets() {
  ipBuckets.clear()
  emailBuckets.clear()
}
