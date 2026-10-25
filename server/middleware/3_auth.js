import { defineEventHandler, parseCookies } from "h3";
import { getUserBySessionId } from "~~/server/utils/auth";
import { setSessionCookie } from "~~/server/utils/user";

export default defineEventHandler(async (event) => {
  const cookie = parseCookies(event);
  const sessionId = cookie.sessionId;
  const user = await getUserBySessionId(sessionId);
  if (user) {
    event.context.auth = {
      userId: user.id,
    };
    // Session prolongée : ré-émettre le cookie avec la nouvelle échéance.
    if (user.sessionRenewedUntil) {
      setSessionCookie(event, { sessionId, expiresAt: user.sessionRenewedUntil });
    }
  }
});
