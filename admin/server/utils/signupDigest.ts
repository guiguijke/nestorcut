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

export interface DigestUser {
  id: string
  email: string
  name?: string
  provider?: string
  signupCountry?: string | null
  createdAt: Date | string
  adminNotifiedAt?: Date | string
}

/** Lot examiné : tous les inscrits après le curseur (marqueur ignoré). */
export function digestScanQuery(cursor: Date) {
  return { createdAt: { $gt: cursor } }
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

/** Nouvelle valeur du curseur : createdAt du dernier examiné (envoyé ou non). */
export function advanceCursor(users: DigestUser[], cursor: Date): Date {
  return users.reduce(
    (m, u) => (new Date(u.createdAt) > m ? new Date(u.createdAt) : m),
    cursor,
  )
}
