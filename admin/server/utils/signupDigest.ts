// C1-b — helpers purs du digest d'inscriptions (testés hors Nitro).
//
// D4 : la notification IMMÉDIATE de l'app pose `adminNotifiedAt` après un
// envoi réussi ; le digest ne doit envoyer que les inscrits NON marqués.
//
// Curseur : il avance sur le createdAt du dernier EXAMINÉ, pas du dernier
// ENVOYÉ. Le lot examiné ignore donc le marqueur (simple `createdAt >
// curseur`) et le filtre `adminNotifiedAt: { $exists: false }` s'applique
// au lot pour décider de l'envoi — ainsi, quand TOUT est filtré (tout était
// déjà signalé), le curseur avance quand même et le cycle suivant ne relit
// pas les mêmes documents.
//
// C1-b-bis : borne haute de grâce 2 min. Un inscrit créé quelques secondes
// avant le tick, dont l'envoi Resend immédiat est encore en vol, ne doit
// PAS entrer dans le lot (sinon double e-mail). Le curseur n'avance jamais
// au-delà de `now − 2 min`.

export interface DigestUser {
  id: string
  email: string
  name?: string
  provider?: string
  signupCountry?: string | null
  createdAt: Date | string
  adminNotifiedAt?: Date | string
}

/** Grâce : l'envoi immédiat Resend prend ~1 s ; 2 min couvrent largement. */
export const DIGEST_GRACE_MS = 2 * 60 * 1000

export function digestGraceCutoff(now: Date | number = Date.now()): Date {
  const t = now instanceof Date ? now.getTime() : now
  return new Date(t - DIGEST_GRACE_MS)
}

/** Lot examiné : inscrits après le curseur ET assez vieux pour que l'envoi
 *  immédiat ait eu le temps de poser `adminNotifiedAt`. */
export function digestScanQuery(cursor: Date, now: Date | number = Date.now()) {
  return { createdAt: { $gt: cursor, $lte: digestGraceCutoff(now) } }
}

/** Projection du lot : inclut le marqueur pour le filtre local. */
export const digestProjection = {
  _id: 0,
  id: 1,
  email: 1,
  name: 1,
  provider: 1,
  signupCountry: 1,
  createdAt: 1,
  adminNotifiedAt: 1,
}

/** Parmi les examinés, ceux qui partent dans l'e-mail (non signalés). */
export function filterUnreported(users: DigestUser[]): DigestUser[] {
  return users.filter((u) => !u.adminNotifiedAt)
}

/** Nouvelle valeur du curseur : createdAt du dernier examiné (envoyé ou non),
 *  jamais au-delà de la borne de grâce si `now` est fourni. */
export function advanceCursor(
  users: DigestUser[],
  cursor: Date,
  now?: Date | number,
): Date {
  const newest = users.reduce(
    (m, u) => (new Date(u.createdAt) > m ? new Date(u.createdAt) : m),
    cursor,
  )
  if (now == null) return newest
  const cap = digestGraceCutoff(now)
  return newest > cap ? cap : newest
}
