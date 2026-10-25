import { createHash } from "node:crypto";

// Noyau des sessions SANS alias `~~` : il est aussi chargé par le plugin de
// démarrage (AGENTS.md #36b). Réexporté par server/utils/auth.js.

// S-4 (audit 2026-09-27) : la base ne contient plus que sha256(jeton) ; le
// jeton brut ne vit que dans le cookie. Durée unique, cookie aligné dessus.
export const SESSION_TTL_DAYS = 90;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
// Renouvellement glissant : sous ce reste, l'échéance repart à now + 90 j
// (au plus une écriture tous les ~45 jours par session).
export const SESSION_RENEW_BELOW_MS = SESSION_TTL_MS / 2;

export function hashSessionId(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex");
}

/**
 * Migre UNE entrée héritée (jeton brut) en hash, de façon atomique : échéance
 * = min(ancienne, now + 90 j) ; sans date, now + 90 j. Une entrée déjà
 * expirée est retirée. Renvoie l'échéance posée, ou null si retirée / déjà
 * migrée par une autre requête. Utilisée par la migration paresseuse ET par
 * la migration en masse du démarrage.
 */
export async function migrateLegacySession(users, userId, legacy, now = new Date()) {
  const cap = new Date(now.getTime() + SESSION_TTL_MS);
  const current = legacy.expiresAt ? new Date(legacy.expiresAt) : cap;
  const expiresAt = current > cap ? cap : current;
  const filter = { _id: userId, sessions: { $elemMatch: { sessionId: legacy.sessionId } } };
  if (expiresAt <= now) {
    await users.updateOne(filter, { $pull: { sessions: { sessionId: legacy.sessionId } } });
    return null;
  }
  await users.updateOne(filter, {
    $set: {
      "sessions.$.sessionHash": hashSessionId(legacy.sessionId),
      "sessions.$.expiresAt": expiresAt,
    },
    $unset: { "sessions.$.sessionId": "" },
  });
  return expiresAt;
}
