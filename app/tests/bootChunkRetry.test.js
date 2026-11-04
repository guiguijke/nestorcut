import { describe, it, expect, beforeEach, vi } from 'vitest'
import { bootChunkRetryScript, BOOT_RELOAD_KEY, BOOT_RELOAD_TTL_MS } from '~/utils/bootChunkRetry'

// Rejoue le script en ligne contre un faux navigateur : il ne vit pas dans un
// module, donc seul son texte peut être testé.
function boot({ root = null, storageThrows = false } = {}) {
    const listeners = {}
    const capture = {}
    const stored = new Map()
    const sessionStorage = {
        getItem: (k) => {
            if (storageThrows) throw new Error('SecurityError')
            return stored.get(k) ?? null
        },
        setItem: (k, v) => {
            if (storageThrows) throw new Error('SecurityError')
            stored.set(k, v)
        },
    }
    const window = {
        addEventListener: (type, fn, useCapture) => {
            listeners[type] = fn
            capture[type] = useCapture
        },
    }
    const document = { getElementById: () => root }
    const location = { reload: vi.fn() }
    new Function('window', 'document', 'sessionStorage', 'location', bootChunkRetryScript)(
        window, document, sessionStorage, location,
    )
    const scriptError = (t) => listeners.error({ target: t })
    return { listeners, capture, stored, location, scriptError, window }
}

const ourChunk = { tagName: 'SCRIPT', type: 'module', src: 'https://app.nestorcut.com/_nuxt/BGM6cZNv.js' }

describe('bootChunkRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-11-04T15:00:00Z'))
    })

    it('recharge quand un de nos modules échoue au démarrage', () => {
        const b = boot()
        b.scriptError(ourChunk)
        expect(b.location.reload).toHaveBeenCalledTimes(1)
        expect(b.stored.get(BOOT_RELOAD_KEY)).toBe(String(Date.now()))
    })

    it('recharge sur vite:preloadError tant que l’hydratation n’est pas finie', () => {
        const hydrating = { __vue_app__: { $nuxt: { isHydrating: true } } }
        const b = boot({ root: hydrating })
        b.listeners['vite:preloadError']()
        expect(b.location.reload).toHaveBeenCalledTimes(1)
    })

    it('ne recharge pas une seconde fois avant le délai, recharge après', () => {
        const b = boot()
        b.scriptError(ourChunk)
        vi.advanceTimersByTime(BOOT_RELOAD_TTL_MS - 1)
        b.scriptError(ourChunk)
        expect(b.location.reload).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1)
        b.scriptError(ourChunk)
        expect(b.location.reload).toHaveBeenCalledTimes(2)
    })

    it('ignore la balise Cloudflare refusée par la CSP, elle aussi module', () => {
        const b = boot()
        b.scriptError({ tagName: 'SCRIPT', type: 'module', src: 'https://static.cloudflareinsights.com/beacon.min.js' })
        expect(b.location.reload).not.toHaveBeenCalled()
    })

    it('ignore les scripts classiques, les autres éléments et les erreurs d’exécution', () => {
        const b = boot()
        b.scriptError({ tagName: 'SCRIPT', type: '', src: 'https://app.nestorcut.com/_nuxt/x.js' })
        b.scriptError({ tagName: 'LINK', type: '', href: 'https://app.nestorcut.com/_nuxt/x.css' })
        b.scriptError({ tagName: 'IMG', src: 'https://app.nestorcut.com/_nuxt/x.png' })
        // Une erreur d'exécution a la fenêtre pour cible, pas un élément.
        b.scriptError(b.window)
        expect(b.location.reload).not.toHaveBeenCalled()
    })

    it('écoute en capture : l’erreur d’un script ne remonte pas jusqu’à la fenêtre', () => {
        expect(boot().capture.error).toBe(true)
    })

    it('ne recharge plus une fois l’hydratation finie : un calcul peut tourner', () => {
        const booted = { __vue_app__: { $nuxt: { isHydrating: false } } }
        const b = boot({ root: booted })
        b.listeners['vite:preloadError']()
        b.scriptError(ourChunk)
        expect(b.location.reload).not.toHaveBeenCalled()
    })

    it('ne recharge pas sans sessionStorage : rien ne garderait contre la boucle', () => {
        const b = boot({ storageThrows: true })
        b.scriptError(ourChunk)
        expect(b.location.reload).not.toHaveBeenCalled()
    })

    it('reste inoffensif dans une balise <script>', () => {
        expect(bootChunkRetryScript).not.toMatch(/<\/script/i)
    })
})
