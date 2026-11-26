import { removeSessionFromUser } from "~~/server/utils/auth";
import { clearVaultSessions } from "~~/server/utils/vault";

export default defineEventHandler(async (event) => {
  const cookie = parseCookies(event);
  const sessionId = cookie.sessionId;
  // La clé du coffre vit en mémoire, par utilisateur : on l'efface AVANT de
  // retirer la session (qui seule dit qui se déconnecte). Un calcul qui la
  // demande ensuite reçoit vault_locked, comme à l'expiration des deux heures.
  const userId = event.context?.auth?.userId;
  if (userId) await clearVaultSessions(userId);
  await removeSessionFromUser(sessionId);

  setCookie(event, "sessionId", "", {
    expires: new Date(0),
  });

  setHeader(
    event,
    "Clear-Site-Data",
    '"cache", "storage"'
  );
  return {};
});
