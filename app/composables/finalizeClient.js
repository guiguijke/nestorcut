/**
 * P4 : lance assembleBrowserArtifacts dans un Web Worker.
 * Repli thread principal si Worker indisponible ou crash (tests, vieux
 * navigateurs) — même fonction, résultat bit-identique.
 */
let worker = null
let seq = 0
const pending = new Map()

function getWorker() {
    if (worker) return worker
    worker = new Worker(new URL('../workers/finalize.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
        const { id, ...rest } = event.data || {}
        const settle = pending.get(id)
        if (settle) {
            pending.delete(id)
            settle(rest)
        }
    }
    worker.onerror = (event) => {
        for (const [, settle] of pending) {
            settle({ ok: false, error: event.message || 'finalize worker error' })
        }
        pending.clear()
        worker?.terminate()
        worker = null
    }
    return worker
}

export async function assembleBrowserArtifactsOffThread(args) {
    const { assembleBrowserArtifacts } = await import('./finalizeLocal')
    const nAlts = args.result?.alternatives?.length || 0
    const usable = (out) => out && (!nAlts || (out.alternatives?.length > 0) || out.allAlternativesInvalid)
    if (typeof Worker === 'undefined') {
        return assembleBrowserArtifacts(args)
    }
    try {
        const rest = await new Promise((resolve, reject) => {
            const id = ++seq
            pending.set(id, resolve)
            try {
                getWorker().postMessage({ id, ...args })
            } catch (e) {
                pending.delete(id)
                reject(e)
            }
        })
        if (rest?.ok && usable(rest)) return rest
        if (rest && !rest.ok) console.warn('[local] finalize worker:', rest.error)
    } catch (e) {
        console.warn('[local] finalize worker unavailable, main thread', e)
    }
    return assembleBrowserArtifacts(args)
}
