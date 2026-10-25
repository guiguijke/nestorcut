import { beforeAll, describe, expect, it, vi } from 'vitest'

// Les middlewares appellent defineEventHandler (auto-import Nitro) à l'import.
vi.stubGlobal('defineEventHandler', (fn) => fn)

let buildCsp, ADMIN_CSP, applySecurityHeaders
beforeAll(async () => {
    ;({ buildCsp } = await import('../middleware/0_security_headers'))
    ;({ ADMIN_CSP, applySecurityHeaders } = await import('../../admin/server/middleware/0_security_headers'))
})

describe('CSP app : hôtes Clarity conditionnels', () => {
    it('sans clarityId : aucun hôte clarity', () => {
        expect(buildCsp('')).not.toMatch(/clarity/)
        expect(buildCsp(undefined)).not.toMatch(/clarity/)
    })
    it('avec clarityId : hôtes autorisés en script-src et connect-src', () => {
        const csp = buildCsp('abc123')
        expect(csp).toMatch(/script-src[^;]*https:\/\/www\.clarity\.ms/)
        expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.clarity\.ms/)
    })
    it('garde les directives de base', () => {
        const csp = buildCsp('')
        expect(csp).toContain("frame-ancestors 'self'")
        expect(csp).toContain("object-src 'none'")
        expect(csp).toContain('https://js.stripe.com')
    })
})

describe('middleware en-têtes admin', () => {
    it('pose les 4 en-têtes, sans HSTS ni restriction script/style', () => {
        const h = {}
        applySecurityHeaders((n, v) => { h[n] = v })
        expect(h['X-Frame-Options']).toBe('DENY')
        expect(h['X-Content-Type-Options']).toBe('nosniff')
        expect(h['Referrer-Policy']).toBe('no-referrer')
        expect(h['Content-Security-Policy']).toBe(ADMIN_CSP)
        expect(h['Strict-Transport-Security']).toBeUndefined()
        expect(ADMIN_CSP).toContain("frame-ancestors 'none'")
        expect(ADMIN_CSP).not.toMatch(/script-src|style-src|default-src/)
    })
})
