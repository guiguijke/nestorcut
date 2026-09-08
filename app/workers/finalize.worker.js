/**
 * P4 : worker de finalisation (post-pass, SVG, DXF, rapport).
 * Protocol : in { id, result, payload, sources, jobSlug }
 *            out { id, ok, alternatives, liveLayout, placed,
 *                  allAlternativesInvalid, localDiscarded, result }
 */
import { assembleBrowserArtifacts } from '../composables/finalizeLocal.js'

self.onmessage = async (event) => {
    const { id, result, payload, sources, jobSlug } = event.data || {}
    try {
        const out = await assembleBrowserArtifacts({ result, payload, sources, jobSlug })
        self.postMessage({ id, ok: true, ...out })
    } catch (err) {
        console.error('[finalize.worker]', err)
        self.postMessage({
            id,
            ok: false,
            error: String(err && err.message ? err.message : err),
        })
    }
}
