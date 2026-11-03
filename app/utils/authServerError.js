import { serverErrorData } from './serverErrorData'

// 3.1.3 : codes d'erreur STABLES du serveur → clés i18n.
const SERVER_ERROR_KEYS = {
    invalid_email: { key: 'auth.error.invalid_email', field: 'email' },
    name_required: { key: 'auth.error.name_required', field: 'name' },
    password_too_short: { key: 'auth.error.password_too_short', field: 'password' },
    email_taken: { key: 'auth.error.email_taken', field: 'email' },
    email_taken_google: { key: 'auth.error.email_taken_google', field: 'email' },
    invalid_credentials: { key: 'auth.error.invalid_credentials' },
    account_suspended: { key: 'auth.error.account_suspended' },
    fields_required: { key: 'auth.error.fields_required' },
    auth_disabled: { key: 'auth.error.auth_disabled' },
}

/**
 * Erreur $fetch d'une route d'auth locale → { text, field?, code? } pour
 * app/pages/auth/local.vue. Sans Google configuré, « connectez-vous avec
 * Google » serait une impasse : le message « compte existant » le remplace.
 */
export function mapAuthServerError(err, t, { googleEnabled = true } = {}) {
    let { code, retryAfterSec } = serverErrorData(err)
    // A2 (audit compte 2026-09-05) : le 429 rate-limit porte un code
    // stable + le délai réel — message traduit avec les minutes.
    if (code === 'rate_limited') {
        const min = Math.max(1, Math.ceil((retryAfterSec || 900) / 60))
        return { text: t('auth.rateLimited', { n: min }), code }
    }
    if (code === 'email_taken_google' && !googleEnabled) code = 'email_taken'
    const mapped = code ? SERVER_ERROR_KEYS[code] : null
    if (mapped) return { text: t(mapped.key), field: mapped.field, code }
    return { text: t('auth.errorGeneric') }
}
