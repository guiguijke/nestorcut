import { connectDB } from "~~/server/db/mongo";
import { generateRandomString } from "~~/server/utils/strings";
import {
  SESSION_RENEW_BELOW_MS,
  SESSION_TTL_DAYS,
  SESSION_TTL_MS,
  hashSessionId,
  migrateLegacySession,
} from "~~/server/utils/sessionCore";

export { SESSION_TTL_DAYS, SESSION_TTL_MS, hashSessionId };
// Au-delà, les plus anciennes sessions sortent (croissance bornée).
export const MAX_SESSIONS_PER_USER = 20;

/**
 * `sessionId` (brut) est destiné au cookie UNIQUEMENT ; ce qui part en base est
 * `storedSession(session)`.
 */
export function generateSession() {
  const sessionId = generateRandomString(64);
  const createdAt = new Date();

  return {
    sessionId: sessionId,
    expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
    createdAt: createdAt,
  };
}

export function storedSession(session) {
  return {
    sessionHash: hashSessionId(session.sessionId),
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
  };
}

/**
 * Retire les sessions expirées d'un utilisateur (appelé à chaque connexion).
 * Le plafond est appliqué par `pushSessionUpdate` (`$slice`).
 */
export async function purgeExpiredSessions(db, filter) {
  await db
    .collection("users")
    .updateOne(filter, { $pull: { sessions: { expiresAt: { $lte: new Date() } } } });
}

/** Opérateur `$push` : ajoute la session hachée et plafonne la liste. */
export function pushSessionUpdate(session) {
  return {
    sessions: {
      $each: [storedSession(session)],
      $slice: -MAX_SESSIONS_PER_USER,
    },
  };
}

export async function removeSessionFromUser(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return;
  const db = await connectDB();
  // Format haché, puis entrée héritée (jeton brut) non encore migrée.
  await db.collection("users").updateOne(
    { sessions: { $elemMatch: { sessionHash: hashSessionId(sessionId) } } },
    { $pull: { sessions: { sessionHash: hashSessionId(sessionId) } } }
  );
  await db.collection("users").updateOne(
    { sessions: { $elemMatch: { sessionId: sessionId } } },
    { $pull: { sessions: { sessionId: sessionId } } }
  );
}

export async function getUserBySessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return null;
  const db = await connectDB();
  const users = db.collection("users");
  const now = new Date();
  const sessionHash = hashSessionId(sessionId);

  let user = await users.findOne({
    sessions: { $elemMatch: { sessionHash: sessionHash } },
  });
  let entry = user?.sessions?.find((s) => s.sessionHash === sessionHash);

  if (!user) {
    // Entrée héritée (jeton brut) : acceptée UNE fois, réécrite en hash.
    user = await users.findOne({
      sessions: { $elemMatch: { sessionId: sessionId } },
    });
    const legacy = user?.sessions?.find((s) => s.sessionId === sessionId);
    if (!legacy) return null;

    // Même fonction que la migration en masse du démarrage.
    const expiresAt = await migrateLegacySession(users, user._id, legacy, now);
    if (!expiresAt) return null;
    entry = { sessionHash, expiresAt };
  }

  if (!entry.expiresAt || new Date(entry.expiresAt) <= now) {
    await removeSessionFromUser(sessionId);
    return null;
  }

  // Banned accounts cannot authenticate: treat them as no session, which logs
  // them out everywhere (their session no longer resolves). The ban flag is
  // set from the admin panel.
  if (user.banned) {
    return null;
  }

  await users.updateOne(
    { _id: user._id },
    { $set: { lastActiveAt: new Date() } }
  );

  // Renouvellement glissant : écriture conditionnelle (une fois tous les
  // ~45 j) ; le middleware ré-émet le cookie avec la nouvelle échéance.
  if (new Date(entry.expiresAt).getTime() - now.getTime() < SESSION_RENEW_BELOW_MS) {
    const renewedUntil = new Date(now.getTime() + SESSION_TTL_MS);
    await users.updateOne(
      {
        _id: user._id,
        sessions: {
          $elemMatch: { sessionHash: sessionHash, expiresAt: { $lt: new Date(now.getTime() + SESSION_RENEW_BELOW_MS) } },
        },
      },
      { $set: { "sessions.$.expiresAt": renewedUntil } }
    );
    user.sessionRenewedUntil = renewedUntil;
  }

  return user;
}
