// C1-c — horloge de la re-demande newsletter (D5/D6 du plan C1).
//
// Pure function shared by the app (NewsletterCard / NewsletterPrompt) so
// the 90-day rule lives in exactly one place. A " demande " is any recorded
// answer: the signup checkbox (newsletterOptInAt when opted in; otherwise
// createdAt is the clock — an unchecked box still counts as a response),
// the modal, or the card (newsletterAskedAt). A user who
// already opted IN is never asked again.

export const NEWSLETTER_ASK_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000

export function shouldAskNewsletter(user, now = Date.now()) {
    if (!user) return false
    if (user.newsletterOptIn === true) return false
    const lastAsk = user.newsletterAskedAt ?? user.newsletterOptInAt ?? user.createdAt
    if (!lastAsk) return false
    return now - new Date(lastAsk).getTime() >= NEWSLETTER_ASK_INTERVAL_MS
}
