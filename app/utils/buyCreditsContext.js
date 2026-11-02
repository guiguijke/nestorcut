// Contexte de la fenêtre d'abonnement (O3, D13, D14) : pur et testable en node.
// Le contexte (useBuyCreditsContext, §3.9) dit POURQUOI la fenêtre s'ouvre ;
// il ne part jamais au serveur ni au suivi — seules la source (liste fermée)
// et le chemin de retour en sortent.
import { normalizeCheckoutSource } from './checkoutReturn'

/**
 * Phrase de contexte de la carte Free (sub.ctx.lockedSheets) : seulement pour
 * un clic « Débloquer » dont le résultat compte plus de tôles que le plafond.
 * @param {object|null|undefined} context useBuyCreditsContext().value
 * @returns {{ key: string, params: { n: number, cap: number } } | null}
 */
export function contextMessage(context) {
    if (!context || context.source !== 'locked_sheets') return null
    const total = Number(context.lockedSheets?.total)
    const cap = Number(context.lockedSheets?.cap)
    if (!Number.isFinite(total) || !Number.isFinite(cap) || total <= cap) return null
    return { key: 'sub.ctx.lockedSheets', params: { n: total, cap } }
}

/** Source de l'étape du tunnel (suivi + intention de checkout) : liste fermée,
 * 'profile' quand la fenêtre n'a pas de contexte (carte du profil). */
export function checkoutSourceOf(context) {
    return normalizeCheckoutSource(context?.source || 'profile')
}

/**
 * O3 / D14 : le Checkout ramène sur le PROJET du résultat quand le contexte le
 * porte (clic sur une carte de /home compris), sinon sur la page courante. Le
 * serveur revalide (safeReturnPath) : ceci n'est jamais une garde.
 */
export function checkoutReturnPath(context, routePath) {
    const ps = context?.lockedSheets?.projectSlug
    return typeof ps === 'string' && ps ? `/project/${ps}` : routePath
}

/**
 * Code d'erreur de suivi d'un échec de /api/payment/subscribe : le
 * `statusMessage` s'il fait partie des codes stables que l'appelant traduit
 * (`knownCodes`), sinon le statut HTTP (jamais un texte libre du serveur dans
 * les événements).
 * @param {any} err erreur $fetch
 * @param {string[]} [knownCodes]
 * @returns {string}
 */
export function checkoutErrorCode(err, knownCodes = []) {
    const message = err?.data?.statusMessage
    if (knownCodes.includes(message)) return message
    return String(err?.statusCode || err?.data?.statusCode || err?.status || 'error')
}
