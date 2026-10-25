import { connectDB, getAvatarBucket } from "../db/mongo";
import logger from "../utils/logger";
import { logRef } from "../utils/logRef";
import { fetchAvatarBuffer } from "../utils/avatar";

const IDLE_PAUSE_MS = 5000;
// Apres MAX_ATTEMPTS echecs, etat final `avatarSource: "failed"` : plus jamais repris,
// l'UI retombe sur /api/user/avatar (initiales / placeholder) car avatarUrl est retire.
export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000;

export const backoffMs = (attempts) => BACKOFF_BASE_MS * 5 ** (attempts - 1);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default defineNitroPlugin(async (_) => {
  logger.info("Avatar sync plugin start");
  const db = await connectDB();
  const avatarBucket = await getAvatarBucket();

  while (true) {
    let processed = false;
    try {
      processed = await runAvatarSyncOnce(db, avatarBucket);
    } catch (error) {
      logger.error("Avatar sync iteration failed", error);
    }
    if (!processed) await sleep(IDLE_PAUSE_MS);
  }
});

/**
 * Traite au plus un utilisateur eligible (ni en attente de backoff, ni abandonne).
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').GridFSBucket} avatarBucket
 * @param {Date} [now]
 * @returns {Promise<boolean>} true si un utilisateur a ete traite
 */
export async function runAvatarSyncOnce(db, avatarBucket, now = new Date()) {
  const userToSync = await db.collection("users").findOne({
    avatarSource: "origin",
    $or: [
      { nextAvatarSyncAt: { $exists: false } },
      { nextAvatarSyncAt: null },
      { nextAvatarSyncAt: { $lte: now } },
    ],
  });
  if (!userToSync) return false;
  await syncAvatars(db, avatarBucket, userToSync, now);
  return true;
}

/**
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').GridFSBucket} avatarBucket
 * @param {import('mongodb').Document} user
 * @param {Date} now
 */
async function syncAvatars(db, avatarBucket, user, now) {
  logger.info("Syncing avatar for user", logRef(user.id));
  try {
    const buffer = await fetchAvatarBuffer(user.avatarUrl);

    const avatarKey = `avatar-${user.id}.jpg`;

    const oldAvatarFiles = await avatarBucket
      .find({ filename: avatarKey })
      .toArray();

    for (const oldAvatarFile of oldAvatarFiles) {
      await avatarBucket.delete(oldAvatarFile._id);
    }

    await new Promise((resolve, reject) => {
      const uploadStream = avatarBucket.openUploadStream(avatarKey);
      uploadStream.on("finish", resolve);
      uploadStream.on("error", (err) => {
        logger.error("Error uploading avatar:", err);
        reject(err);
      });
      uploadStream.write(buffer);
      uploadStream.end();
    });

    logger.info(`Avatar saved for user ${logRef(user.id)}`);

    await db.collection("users").updateOne(
      { id: user.id },
      {
        $set: {
          avatarSource: "mongo",
          avatarFileName: avatarKey,
        },
        $unset: {
          avatarSyncError: "",
          avatarSyncAttempts: "",
          nextAvatarSyncAt: "",
          avatarUrl: "",
        },
      }
    );
  } catch (error) {
    logger.error("Failed to sync avatar for user", logRef(user.id), error);

    const attempts = (user.avatarSyncAttempts || 0) + 1;
    const update = { $set: { avatarSyncError: error.message, avatarSyncAttempts: attempts } };
    if (attempts >= MAX_ATTEMPTS) {
      update.$set.avatarSource = "failed";
      update.$unset = { avatarUrl: "", nextAvatarSyncAt: "" };
      logger.warn("Avatar sync abandoned for user", logRef(user.id));
    } else {
      update.$set.nextAvatarSyncAt = new Date(now.getTime() + backoffMs(attempts));
    }
    await db.collection("users").updateOne({ id: user.id }, update);
  }
}
