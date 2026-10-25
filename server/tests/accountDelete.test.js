import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matches } from './helpers/fakeMongo'

// Suppression de compte (server/features/account/delete.js) : on insère une
// trace de l'utilisateur dans CHAQUE collection qui peut en contenir, on
// supprime, et on exige ZÉRO reste — hors exemptions listées ci-dessous.
const state = vi.hoisted(() => ({ db: null, buckets: {} }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
    getBucket: async (name) => (state.buckets[name] ??= fakeBucket()),
    getAvatarBucket: async () => (state.buckets.avatars ??= fakeBucket()),
}))
vi.mock('~~/server/utils/vault', () => ({
    clearVaultSessions: vi.fn(async () => {}),
}))
vi.mock('~~/server/features/payment/stripe', () => ({
    cancelSubscriptionImmediately: vi.fn(async () => {}),
    deleteCustomer: vi.fn(async () => {}),
}))
vi.mock('~~/server/features/listmonk/unsubscribe', () => ({
    unsubscribeFromNewsletter: vi.fn(async () => true),
}))
vi.mock('~~/server/features/notification/sendEmail', () => ({
    sendAccountDeletedEmail: vi.fn(async () => {}),
}))
vi.mock('~~/server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { deleteUserAccount } from '~~/server/features/account/delete'
import { unsubscribeFromNewsletter } from '~~/server/features/listmonk/unsubscribe'
import logger from '~~/server/utils/logger'

const EMAIL = 'victime@example.com'
const UID = `local:${EMAIL}`
const CUS = 'cus_victime'

function fakeBucket() {
    return {
        find: () => ({ toArray: async () => [] }),
        delete: async () => {},
    }
}

// Base mémoire minimale : les opérateurs de filtre viennent de fakeMongo,
// seuls updateMany/deleteMany/find nécessaires à la suppression sont ajoutés.
function memoryDb(collections) {
    const cols = new Map(Object.entries(collections))
    const docs = (name) => cols.get(name) ?? cols.set(name, []).get(name)
    return {
        names: () => [...cols.keys()],
        docs,
        collection(name) {
            const list = docs(name)
            return {
                find: (f) => ({ toArray: async () => list.filter((d) => matches(d, f)) }),
                async deleteMany(f) {
                    for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], f)) list.splice(i, 1)
                },
                async deleteOne(f) {
                    const i = list.findIndex((d) => matches(d, f))
                    if (i !== -1) list.splice(i, 1)
                },
                async updateMany(f, u) {
                    for (const d of list) if (matches(d, f)) Object.assign(d, u.$set)
                },
            }
        },
    }
}

const user = {
    id: UID,
    email: EMAIL,
    provider: 'local',
    newsletterOptIn: false,
    stripeCustomerId: CUS,
    subscription: { stripeSubscriptionId: 'sub_1' },
}

// Une trace de l'utilisateur dans chaque collection qui peut en contenir.
const traces = [
    ['users', { id: UID, email: EMAIL, name: 'Victime' }],
    ['user_dxf_files', { ownerId: UID, filename: 'a.dxf' }],
    ['strip_user_dxf_files', { ownerId: UID }],
    ['projects', { ownerId: UID, slug: 'p' }],
    ['strip_projects', { ownerId: UID }],
    ['nesting_jobs', { ownerId: UID, status: 'done' }],
    ['strip_nesting_job_queue', { ownerId: UID, status: 'done' }],
    ['passwordResets', { userId: UID, tokenHash: 'x' }],
    ['emailVerifications', { userId: UID, tokenHash: 'y' }],
    ['subscription_checkouts', { userId: UID }],
    ['payment_failures', { userId: UID, email: EMAIL }],
    // Échec reçu avant résolution du compte : userId null, e-mail seul.
    ['payment_failures', { userId: null, email: EMAIL, stripeCustomerId: null }],
    // Idem, retrouvé uniquement par le client Stripe.
    ['payment_failures', { userId: null, email: null, stripeCustomerId: CUS }],
    ['supportMessages', { userId: UID, text: 'bonjour' }],
    ['tracking', { userId: UID, action: 'x' }],
    [
        'adminActions',
        {
            targetUserId: UID,
            adminId: 'adm',
            action: 'ban',
            summary: `Banni ${EMAIL}`,
            raw: { reason: 'spam', email: EMAIL },
        },
    ],
]

// Exemption JUSTIFIÉE : écritures comptables légales (conservation 10 ans,
// Code de commerce L123-22). Elles ne portent que l'id de facture Stripe et
// les montants — aucune référence à l'utilisateur.
const EXEMPT = new Set(['accounting_entries'])

beforeEach(() => {
    vi.clearAllMocks()
    state.buckets = {}
    const cols = {}
    for (const [name, doc] of traces) (cols[name] ??= []).push(structuredClone(doc))
    cols.accounting_entries = [{ stripeInvoiceId: 'in_1', status: 'sent', amountCents: 1000 }]
    // Un autre utilisateur, à ne JAMAIS toucher.
    cols.users.push({ id: 'google:42', email: 'autre@example.com' })
    cols.projects.push({ ownerId: 'google:42' })
    cols.payment_failures.push({ userId: 'google:42', email: 'autre@example.com', stripeCustomerId: 'cus_autre' })
    cols.adminActions.push({ targetUserId: 'google:42', adminId: 'adm', action: 'x', summary: 'autre', raw: { a: 1 } })
    state.db = memoryDb(cols)
})

describe('deleteUserAccount', () => {
    it("ne laisse aucune trace de l'utilisateur (hors exemptions)", async () => {
        await deleteUserAccount({}, user)

        const seen = new Set(traces.map(([n]) => n))
        for (const name of seen) {
            if (EXEMPT.has(name)) continue
            for (const d of state.db.docs(name)) {
                const json = JSON.stringify(d)
                expect(json, `${name} garde une trace`).not.toContain(EMAIL)
                expect(json, `${name} garde une trace`).not.toContain(UID)
                expect(json, `${name} garde une trace`).not.toContain(CUS)
            }
        }
        expect(seen.size).toBe(14)
    })

    it('garde la trace admin sans donnée personnelle, et les comptes tiers', async () => {
        await deleteUserAccount({}, user)

        const actions = state.db.docs('adminActions')
        expect(actions).toHaveLength(2)
        const mine = actions.find((a) => a.targetUserDeleted)
        expect(mine).toMatchObject({ action: 'ban', adminId: 'adm', targetUserId: null, summary: null, raw: null })
        expect(actions.find((a) => !a.targetUserDeleted).summary).toBe('autre')
        expect(state.db.docs('users')).toEqual([{ id: 'google:42', email: 'autre@example.com' }])
        expect(state.db.docs('projects')).toEqual([{ ownerId: 'google:42' }])
        expect(state.db.docs('payment_failures')).toHaveLength(1)
    })

    it('conserve les écritures comptables (obligation légale)', async () => {
        await deleteUserAccount({}, user)
        expect(state.db.docs('accounting_entries')).toHaveLength(1)
    })

    it('supprime la fiche listmonk même sans opt-in newsletter', async () => {
        await deleteUserAccount({}, { ...user, newsletterOptIn: false })
        expect(unsubscribeFromNewsletter).toHaveBeenCalledWith({}, { email: EMAIL })
    })

    it("n'écrit ni l'e-mail ni l'identifiant de compte dans les journaux", async () => {
        await deleteUserAccount({}, user)
        const lines = JSON.stringify(['info', 'warn', 'error'].flatMap((l) => logger[l].mock.calls))
        expect(lines).not.toContain(EMAIL)
        expect(lines).not.toContain(UID)
        expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it('chaque collection référencée par le code serveur est traitée ou exemptée explicitement', () => {
        const root = join(dirname(fileURLToPath(import.meta.url)), '..')
        const found = new Set()
        const walk = (dir) => {
            for (const name of readdirSync(dir)) {
                if (name === 'tests' || name === 'node_modules') continue
                const full = join(dir, name)
                if (statSync(full).isDirectory()) walk(full)
                else if (/\.(js|ts)$/.test(name)) {
                    for (const m of readFileSync(full, 'utf8').matchAll(/collection\('([^']+)'\)/g)) found.add(m[1])
                }
            }
        }
        walk(root)

        // Collections effacées / anonymisées par deleteUserAccount.
        const handled = new Set(traces.map(([n]) => n))
        // Exemptions : AUCUNE donnée de l'utilisateur, raison par collection.
        const exempt = {
            accounting_entries: 'écritures comptables légales, id de facture Stripe + montants seulement',
            admins: 'comptes administrateurs, pas des utilisateurs',
            app_meta: "métadonnées techniques de l'application",
            promoCodes: 'campagnes (compteur de rédemptions), sans référence utilisateur',
            stripe_status: 'état global du service Stripe, sans utilisateur',
            subscription_plan: 'catalogue de plans',
            http: 'journal HTTP sans identifiant depuis S0, purgé à 14 jours',
        }
        const unknown = [...found].filter((c) => !handled.has(c) && !(c in exempt))
        expect(unknown, 'collection non traitée par la suppression de compte').toEqual([])
    })
})
