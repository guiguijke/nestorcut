import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
    CHECKOUT_INTENT_KEY,
    CHECKOUT_INTENT_TTL_MS,
    checkoutReturnMarker,
    normalizeCheckoutSource,
    pollCheckoutStatus,
    queryWithoutCheckoutMarkers,
    returnPageKind,
    takeCheckoutIntent,
    writeCheckoutIntent,
} from '../utils/checkoutReturn'

// Faux sessionStorage : une Map suffit.
function fakeStorage() {
    const map = new Map()
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => void map.set(k, String(v)),
        removeItem: (k) => void map.delete(k),
    }
}

describe('intention de checkout (sessionStorage)', () => {
    const NOW = 1_730_000_000_000

    it('aller-retour écriture / lecture, consommée une seule fois', () => {
        const s = fakeStorage()
        const ok = writeCheckoutIntent(
            s,
            { source: 'locked_sheets', resultSlug: 'res-abc_1', projectSlug: 'brave-otter-0123456789ab' },
            NOW,
        )
        expect(ok).toBe(true)
        expect(JSON.parse(s.map.get(CHECKOUT_INTENT_KEY))).toEqual({
            v: 1,
            source: 'locked_sheets',
            resultSlug: 'res-abc_1',
            projectSlug: 'brave-otter-0123456789ab',
            at: NOW,
        })
        expect(takeCheckoutIntent(s, NOW + 1000)).toEqual({
            source: 'locked_sheets',
            resultSlug: 'res-abc_1',
            projectSlug: 'brave-otter-0123456789ab',
        })
        expect(s.map.has(CHECKOUT_INTENT_KEY)).toBe(false)
        expect(takeCheckoutIntent(s, NOW + 1000)).toBeNull()
    })

    it('la clé est supprimée même si la lecture rend null', () => {
        const s = fakeStorage()
        writeCheckoutIntent(s, { source: 'quota' }, NOW)
        expect(takeCheckoutIntent(s, NOW + CHECKOUT_INTENT_TTL_MS + 1)).toBeNull()
        expect(s.map.has(CHECKOUT_INTENT_KEY)).toBe(false)
    })

    it('exactement à la TTL : encore valide ; TTL + 1 ms : périmée', () => {
        const a = fakeStorage()
        writeCheckoutIntent(a, { source: 'quota' }, NOW)
        expect(takeCheckoutIntent(a, NOW + CHECKOUT_INTENT_TTL_MS)).not.toBeNull()
        const b = fakeStorage()
        writeCheckoutIntent(b, { source: 'quota' }, NOW)
        expect(takeCheckoutIntent(b, NOW + CHECKOUT_INTENT_TTL_MS + 1)).toBeNull()
    })

    it("datée de plus d'une minute dans le futur : refusée", () => {
        const a = fakeStorage()
        writeCheckoutIntent(a, { source: 'quota' }, NOW + 61_000)
        expect(takeCheckoutIntent(a, NOW)).toBeNull()
        const b = fakeStorage()
        writeCheckoutIntent(b, { source: 'quota' }, NOW + 30_000)
        expect(takeCheckoutIntent(b, NOW)).not.toBeNull()
    })

    it('absente, JSON corrompu, version inconnue, date illisible : null', () => {
        const s = fakeStorage()
        expect(takeCheckoutIntent(s, NOW)).toBeNull()
        s.map.set(CHECKOUT_INTENT_KEY, '{pas du json')
        expect(takeCheckoutIntent(s, NOW)).toBeNull()
        s.map.set(CHECKOUT_INTENT_KEY, JSON.stringify({ v: 2, source: 'quota', at: NOW }))
        expect(takeCheckoutIntent(s, NOW)).toBeNull()
        s.map.set(CHECKOUT_INTENT_KEY, JSON.stringify({ v: 1, source: 'quota', at: 'hier' }))
        expect(takeCheckoutIntent(s, NOW)).toBeNull()
        s.map.set(CHECKOUT_INTENT_KEY, 'null')
        expect(takeCheckoutIntent(s, NOW)).toBeNull()
    })

    it("un storage qui lève : jamais d'exception", () => {
        const boom = {
            getItem() {
                throw new Error('SecurityError')
            },
            setItem() {
                throw new Error('QuotaExceededError')
            },
            removeItem() {
                throw new Error('SecurityError')
            },
        }
        expect(writeCheckoutIntent(boom, { source: 'quota' }, NOW)).toBe(false)
        expect(takeCheckoutIntent(boom, NOW)).toBeNull()
        expect(writeCheckoutIntent(null, { source: 'quota' }, NOW)).toBe(false)
        expect(takeCheckoutIntent(undefined, NOW)).toBeNull()
    })

    it("une suppression qui échoue ne masque pas l'intention lue", () => {
        const s = fakeStorage()
        writeCheckoutIntent(s, { source: 'export' }, NOW)
        s.removeItem = () => {
            throw new Error('SecurityError')
        }
        expect(takeCheckoutIntent(s, NOW)).toEqual({ source: 'export', resultSlug: null, projectSlug: null })
    })

    it('source inconnue = other ; slug invalide = null', () => {
        const s = fakeStorage()
        writeCheckoutIntent(s, { source: 'n_importe_quoi', resultSlug: '../etc', projectSlug: 'a b' }, NOW)
        expect(takeCheckoutIntent(s, NOW)).toEqual({ source: 'other', resultSlug: null, projectSlug: null })
    })

    it('slug de résultat de plus de 200 caractères (job aux longs noms de fichier) : conservé', () => {
        // buildJobSlug : trois noms de fichier jusqu'à 200 car. chacun + compteurs.
        const long = 'nested-' + 'a'.repeat(200) + '_2-abc123'
        expect(long.length).toBeGreaterThan(200)
        const s = fakeStorage()
        writeCheckoutIntent(
            s,
            { source: 'locked_sheets', resultSlug: long, projectSlug: 'brave-otter-0123456789ab' },
            NOW,
        )
        expect(JSON.parse(s.map.get(CHECKOUT_INTENT_KEY)).resultSlug).toBe(long)
        expect(takeCheckoutIntent(s, NOW)).toEqual({
            source: 'locked_sheets',
            resultSlug: long,
            projectSlug: 'brave-otter-0123456789ab',
        })
    })

    it('slug de résultat de plus de 1024 caractères (щ → shch, ß → ss : slugify allonge) : conservé', () => {
        // Trois noms de 196 car. en щ : chacun donne 784 car. une fois slugifié,
        // soit ~2350 car. de slug de job — au-delà de l'ancienne borne de 1024.
        const long = 'nested-' + 'shch'.repeat(196 * 3) + '_2-abc123'
        expect(long.length).toBeGreaterThan(1024)
        const s = fakeStorage()
        writeCheckoutIntent(s, { source: 'locked_sheets', resultSlug: long }, NOW)
        expect(takeCheckoutIntent(s, NOW)).toEqual({ source: 'locked_sheets', resultSlug: long, projectSlug: null })
    })

    it('slug de résultat : borné à 4096 caractères ; slug de projet : borné à 200', () => {
        const s = fakeStorage()
        writeCheckoutIntent(s, { source: 'quota', resultSlug: 'a'.repeat(4096), projectSlug: 'b'.repeat(200) }, NOW)
        expect(takeCheckoutIntent(s, NOW)).toEqual({
            source: 'quota',
            resultSlug: 'a'.repeat(4096),
            projectSlug: 'b'.repeat(200),
        })
        // Au-delà : null, à l'écriture comme à la lecture d'une valeur trafiquée.
        writeCheckoutIntent(s, { source: 'quota', resultSlug: 'a'.repeat(4097), projectSlug: 'b'.repeat(201) }, NOW)
        expect(takeCheckoutIntent(s, NOW)).toEqual({ source: 'quota', resultSlug: null, projectSlug: null })
        s.map.set(
            CHECKOUT_INTENT_KEY,
            JSON.stringify({
                v: 1,
                source: 'quota',
                resultSlug: 'a'.repeat(4097),
                projectSlug: 'b'.repeat(201),
                at: NOW,
            }),
        )
        expect(takeCheckoutIntent(s, NOW)).toEqual({ source: 'quota', resultSlug: null, projectSlug: null })
    })

    it('une valeur de stockage trafiquée est re-validée à la lecture', () => {
        const s = fakeStorage()
        s.map.set(
            CHECKOUT_INTENT_KEY,
            JSON.stringify({ v: 1, source: 'evil', resultSlug: '<script>', projectSlug: 42, at: NOW }),
        )
        expect(takeCheckoutIntent(s, NOW)).toEqual({ source: 'other', resultSlug: null, projectSlug: null })
    })

    it('normalizeCheckoutSource', () => {
        expect(normalizeCheckoutSource('account')).toBe('account')
        expect(normalizeCheckoutSource('locked_sheets')).toBe('locked_sheets')
        expect(normalizeCheckoutSource('inconnue')).toBe('other')
        expect(normalizeCheckoutSource(undefined)).toBe('other')
    })
})

describe('checkoutReturnMarker', () => {
    const ID = '0123456789abcdef01234567'

    it('24 hex minuscules = succès', () => {
        expect(checkoutReturnMarker({ subscriptionInternalId: ID })).toEqual({ kind: 'success', id: ID })
    })

    it('23 caractères, majuscules, vide, tableau = invalide', () => {
        expect(checkoutReturnMarker({ subscriptionInternalId: ID.slice(1) })).toEqual({ kind: 'invalid' })
        expect(checkoutReturnMarker({ subscriptionInternalId: ID.toUpperCase() })).toEqual({ kind: 'invalid' })
        expect(checkoutReturnMarker({ subscriptionInternalId: '' })).toEqual({ kind: 'invalid' })
        expect(checkoutReturnMarker({ subscriptionInternalId: [ID] })).toEqual({ kind: 'invalid' })
        expect(checkoutReturnMarker({ subscriptionInternalId: [ID, ID] })).toEqual({ kind: 'invalid' })
    })

    it('checkout=cancelled = annulation ; autre valeur = rien', () => {
        expect(checkoutReturnMarker({ checkout: 'cancelled' })).toEqual({ kind: 'cancel' })
        expect(checkoutReturnMarker({ checkout: 'ok' })).toBeNull()
    })

    it('aucun marqueur = null', () => {
        expect(checkoutReturnMarker({})).toBeNull()
        expect(checkoutReturnMarker({ autre: '1' })).toBeNull()
        expect(checkoutReturnMarker(undefined)).toBeNull()
        expect(checkoutReturnMarker(null)).toBeNull()
    })
})

describe('queryWithoutCheckoutMarkers', () => {
    it('retire les deux marqueurs, conserve le reste', () => {
        expect(
            queryWithoutCheckoutMarkers({ subscriptionInternalId: 'x', checkout: 'cancelled', a: '1', b: ['2', '3'] }),
        ).toEqual({ a: '1', b: ['2', '3'] })
        expect(queryWithoutCheckoutMarkers({})).toEqual({})
        expect(queryWithoutCheckoutMarkers(undefined)).toEqual({})
    })

    it("ne modifie pas la requête d'entrée", () => {
        const q = { checkout: 'cancelled', a: '1' }
        queryWithoutCheckoutMarkers(q)
        expect(q).toEqual({ checkout: 'cancelled', a: '1' })
    })
})

describe('returnPageKind', () => {
    it('les quatre cas', () => {
        expect(returnPageKind('/project/brave-otter-0123456789ab')).toBe('project')
        expect(returnPageKind('/home')).toBe('home')
        expect(returnPageKind('/profile')).toBe('profile')
        expect(returnPageKind('/plans')).toBe('other')
    })

    it('entrée inattendue = other', () => {
        expect(returnPageKind('/project/')).toBe('other')
        expect(returnPageKind('/homework')).toBe('other')
        expect(returnPageKind(undefined)).toBe('other')
        expect(returnPageKind(null)).toBe('other')
    })
})

// D17 : sondage borné de /check, avec une horloge simulée que `sleep` fait avancer.
describe('pollCheckoutStatus', () => {
    function harness(statuses) {
        const queue = [...statuses]
        let t = 0
        const sleeps = []
        const check = vi.fn(async () => {
            const next = queue.length > 1 ? queue.shift() : queue[0]
            if (next instanceof Error) throw next
            return next
        })
        const sleep = vi.fn(async (ms) => {
            sleeps.push(ms)
            t += ms
        })
        const onSlow = vi.fn()
        return { check, sleep, onSlow, sleeps, now: () => t, clock: () => t }
    }
    const run = (h, opts) => pollCheckoutStatus({ check: h.check, sleep: h.sleep, now: h.now, onSlow: h.onSlow }, opts)

    it('actif au premier essai : un seul appel, onSlow jamais', async () => {
        const h = harness(['active'])
        expect(await run(h)).toEqual({ status: 'active', attempts: 1, timedOut: false })
        expect(h.onSlow).not.toHaveBeenCalled()
        expect(h.sleep).not.toHaveBeenCalled()
    })

    it('pending, pending, trialing : trois essais dans la phase rapide, onSlow jamais', async () => {
        const h = harness(['pending', 'pending', 'trialing'])
        expect(await run(h)).toEqual({ status: 'trialing', attempts: 3, timedOut: false })
        expect(h.onSlow).not.toHaveBeenCalled()
    })

    it('Stripe confirme après la phase rapide : onSlow appelé une seule fois', async () => {
        const h = harness(['pending', 'pending', 'pending', 'pending', 'active'])
        expect(await run(h)).toEqual({ status: 'active', attempts: 5, timedOut: false })
        expect(h.onSlow).toHaveBeenCalledTimes(1)
    })

    it('une exception de check compte comme "error" et se réessaie', async () => {
        const h = harness([new Error('réseau'), new Error('réseau'), 'active'])
        expect(await run(h)).toEqual({ status: 'active', attempts: 3, timedOut: false })
        expect(h.onSlow).not.toHaveBeenCalled()
    })

    it('un check qui ne rend pas une chaîne compte comme "error"', async () => {
        const h = harness([undefined, 42, 'active'])
        expect(await run(h)).toEqual({ status: 'active', attempts: 3, timedOut: false })
    })

    it('incomplete est terminal : un seul essai', async () => {
        const h = harness(['incomplete'])
        expect(await run(h)).toEqual({ status: 'incomplete', attempts: 1, timedOut: false })
        expect(h.onSlow).not.toHaveBeenCalled()
    })

    it('not_found est terminal', async () => {
        const h = harness(['not_found'])
        expect(await run(h)).toEqual({ status: 'not_found', attempts: 1, timedOut: false })
    })

    it('toujours pending : timedOut, dernier statut rendu, horloge bornée', async () => {
        const h = harness(['pending'])
        const res = await run(h)
        expect(res.timedOut).toBe(true)
        expect(res.status).toBe('pending')
        expect(h.onSlow).toHaveBeenCalledTimes(1)
        // maxMs + slowDelayMs : au plus un dernier sommeil au-delà du délai.
        expect(h.clock()).toBeLessThanOrEqual(120000 + 5000)
        expect(h.clock()).toBeGreaterThanOrEqual(120000)
    })

    it('toujours en erreur réseau : timedOut avec le statut "error"', async () => {
        const h = harness([new Error('réseau')])
        const res = await run(h)
        expect(res.timedOut).toBe(true)
        expect(res.status).toBe('error')
    })

    it('délais : 2000 ms entre les essais rapides, puis 5000 ms', async () => {
        const h = harness(['pending'])
        await run(h)
        expect(h.sleeps.slice(0, 2)).toEqual([2000, 2000])
        expect(h.sleeps.slice(2).length).toBeGreaterThan(0)
        expect(h.sleeps.slice(2).every((ms) => ms === 5000)).toBe(true)
    })

    it('les paramètres sont réglables', async () => {
        const h = harness(['pending'])
        const res = await run(h, { fastTries: 1, fastDelayMs: 10, slowDelayMs: 100, maxMs: 250 })
        expect(res.timedOut).toBe(true)
        expect(h.sleeps).toEqual([100, 100, 100])
        expect(res.attempts).toBe(4)
    })

    it('un sleep ou un onSlow qui lèvent ne cassent pas la vérification', async () => {
        const check = vi
            .fn()
            .mockResolvedValueOnce('pending')
            .mockResolvedValueOnce('pending')
            .mockResolvedValueOnce('pending')
            .mockResolvedValue('active')
        const res = await pollCheckoutStatus({
            check,
            sleep: async () => {
                throw new Error('sleep')
            },
            now: () => 0,
            onSlow: () => {
                throw new Error('toast')
            },
        })
        expect(res).toEqual({ status: 'active', attempts: 4, timedOut: false })
    })
})

// O3 « sans recharger » : Subscription.vue n'est pas importable sous vitest (pas
// de plugin Vue). On en lit donc la source : `refreshUser` est extrait du
// <script setup> et rejoué avec des doubles, et les deux chemins qui s'en
// servent (409 subscription_exists, watch sur l'abonnement actif) sont vérifiés.
describe('Subscription.vue : rafraîchissement du palier client', () => {
    const source = readFileSync(fileURLToPath(new URL('../components/Subscription.vue', import.meta.url)), 'utf8')

    // Corps `{ … }` (accolades appariées) qui suit `const <name> = async () =>`.
    function arrowFunctionSource(name) {
        const start = source.indexOf(`const ${name} = async () => {`)
        expect(start).toBeGreaterThanOrEqual(0)
        const open = source.indexOf('{', start)
        let depth = 0
        for (let i = open; i < source.length; i += 1) {
            if (source[i] === '{') depth += 1
            if (source[i] === '}') depth -= 1
            if (depth === 0) return source.slice(start, i + 1)
        }
        throw new Error(`${name} : accolade fermante introuvable`)
    }

    function loadRefreshUser({ refreshNuxtData, setUser }) {
        const factory = new Function(
            'refreshNuxtData',
            'authStore',
            `${arrowFunctionSource('refreshUser')}
return refreshUser`,
        )
        return factory(refreshNuxtData, { actions: { setUser } })
    }

    it('refreshUser rafraîchit le cache `user` PUIS le store (bannière Free, Turbo)', async () => {
        const calls = []
        const refreshUser = loadRefreshUser({
            refreshNuxtData: vi.fn(async (key) => void calls.push(`refreshNuxtData:${key}`)),
            setUser: vi.fn(async () => void calls.push('setUser')),
        })
        await refreshUser()
        expect(calls).toEqual(['refreshNuxtData:user', 'setUser'])
    })

    it("un rafraîchissement du cache qui échoue n'empêche pas setUser, et rien ne lève", async () => {
        const setUser = vi.fn(async () => {})
        const refreshUser = loadRefreshUser({
            refreshNuxtData: vi.fn(async () => {
                throw new Error('réseau')
            }),
            setUser,
        })
        await expect(refreshUser()).resolves.toBeUndefined()
        expect(setUser).toHaveBeenCalledTimes(1)
    })

    it('un setUser qui échoue ne lève pas', async () => {
        const refreshUser = loadRefreshUser({
            refreshNuxtData: vi.fn(async () => {}),
            setUser: vi.fn(async () => {
                throw new Error('réseau')
            }),
        })
        await expect(refreshUser()).resolves.toBeUndefined()
    })

    it('le chemin 409 et le watch « abonnement actif » passent par refreshUser', () => {
        expect(arrowFunctionSource('syncAfterExistingSubscription')).toContain('await refreshUser()')
        const watchBlock = /watch\(\s*isStripeActive[\s\S]*?\{ immediate: true \},?\s*\)/.exec(source)?.[0]
        expect(watchBlock).toContain('refreshUser()')
        expect(watchBlock).not.toContain('refreshNuxtData')
    })

    it('la montée en Pro en place (subscribePro) passe aussi par refreshUser, pas par le cache seul', () => {
        // Sans le store d'authentification, maxParallelLocalNests restait à 1
        // (palier « standard ») jusqu'au rechargement de la page.
        const body = arrowFunctionSource('subscribePro')
        expect(body).toContain('await refreshUser()')
        expect(body).not.toContain('refreshNuxtData')
    })
})
