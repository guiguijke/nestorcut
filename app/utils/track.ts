import type { TrackRequest } from '~~/shared/types/track_body'

/**
 * d8 (02/11) : /api/track n'accepte que des valeurs `data` en chaîne (400
 * sinon, en silence). Toute valeur passe donc ici avant l'envoi : null et
 * undefined sont écartés, un objet est sérialisé, le reste est converti, et
 * chaque chaîne est tronquée à 500 caractères.
 */
export function toTrackData(data: Record<string, unknown> = {}): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(data || {})) {
        if (v == null) continue
        const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v))
        out[k] = s.slice(0, 500)
    }
    return out
}

export async function trackEvent(
    action: string,
    data: Record<string, unknown> = {},
): Promise<void> {
    try {
        const trackRequest: TrackRequest = {
            action,
            data: toTrackData(data),
        }

        await $fetch('/api/track', {
            method: 'POST',
            body: trackRequest
        })
    } catch (error) {
        console.warn('Failed to track event:', error)
    }
}
