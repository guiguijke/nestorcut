import { connectDB } from "../db/mongo";
import logger from "../utils/logger";
import { migrateLegacySession } from "../utils/sessionCore";

// Imports RELATIFS (AGENTS.md #36b) et aucun timer.
const BATCH_SIZE = 200;
const MAX_BATCHES = 50;

/**
 * S-4 : migration EN MASSE, au démarrage, des jetons de session hérités
 * (stockés bruts) vers sha256 — sinon une fuite de la base livre des cookies
 * valides jusqu'à la première requête de chaque utilisateur. Idempotente
 * (ne cible que `sessions.sessionId`), bornée (MAX_BATCHES × BATCH_SIZE
 * comptes par démarrage) et JAMAIS bloquante : toute erreur est journalisée
 * et le serveur démarre. Ne journalise que des COMPTES.
 */
export async function migrateLegacySessions(db) {
  const users = db.collection("users");
  let accounts = 0;
  let sessions = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const docs = await users
      .find({ "sessions.sessionId": { $exists: true } }, { projection: { sessions: 1 } })
      .limit(BATCH_SIZE)
      .toArray();
    if (!docs.length) break;
    let progressed = 0;
    for (const doc of docs) {
      for (const legacy of (doc.sessions || []).filter((s) => s && typeof s.sessionId === "string")) {
        await migrateLegacySession(users, doc._id, legacy);
        sessions++;
        progressed++;
      }
    }
    accounts += docs.length;
    if (!progressed) break;
  }
  return { accounts, sessions };
}

export default defineNitroPlugin(async () => {
  try {
    const db = await connectDB();
    const { accounts, sessions } = await migrateLegacySessions(db);
    if (accounts) {
      logger.info(`[sessions] migration en masse : ${accounts} compte(s), ${sessions} session(s) héritée(s) hachée(s)`);
    }
  } catch (err) {
    logger.warn("[sessions] migration en masse interrompue", { message: err?.message });
  }
});
