import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isRegisterMode } from '../utils/authMode'

describe('mode initial de /auth/local', () => {
    it('ouvre la connexion sans paramètre et pour une valeur inconnue', () => {
        expect(isRegisterMode(undefined)).toBe(false)
        expect(isRegisterMode('')).toBe(false)
        expect(isRegisterMode('login')).toBe(false)
        expect(isRegisterMode('REGISTER')).toBe(false)
        expect(isRegisterMode('anything')).toBe(false)
    })

    it('ouvre l\'inscription avec ?mode=register', () => {
        expect(isRegisterMode('register')).toBe(true)
    })

    it('lit la première valeur si le paramètre est répété', () => {
        expect(isRegisterMode(['register', 'login'])).toBe(true)
        expect(isRegisterMode(['login', 'register'])).toBe(false)
    })

    // Verrou de câblage : la page lit le mode avant le premier rendu (serveur
    // et client voient la même route, donc pas de flash à l'hydratation), et
    // tout lien de l'application vers /auth/local nomme son mode.
    it('la page initialise isRegister depuis la route, sans valeur en dur', () => {
        const src = readFileSync(new URL('../pages/auth/local.vue', import.meta.url), 'utf8')
        expect(src).toMatch(/const isRegister = ref\(isRegisterMode\(route\.query\.mode\)\)/)
        expect(src).not.toMatch(/isRegister = ref\(true\)/)
    })

    it.each([
        '../components/LoginView.vue',
        '../pages/index.vue',
        '../pages/auth/forgot-password.vue',
        '../pages/auth/reset-password.vue',
    ])('%s pointe vers /auth/local avec son mode', (file) => {
        const src = readFileSync(new URL(file, import.meta.url), 'utf8')
        const links = [...src.matchAll(/(?:href|to)="(\/auth\/local[^"]*)"/g)].map((m) => m[1])
        expect(links.length).toBeGreaterThan(0)
        for (const l of links) expect(l).toBe('/auth/local?mode=login')
    })
})
