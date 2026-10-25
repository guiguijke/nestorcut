// En-têtes de sécurité de base du panneau admin. Servi en http sur le réseau
// privé : volontairement PAS de HSTS. CSP minimale (pas de restriction
// script/style, Nuxt hydrate avec des scripts inline) : seulement les
// directives à fort rendement qui ne cassent rien.
// Préfixe 0_ : s'exécute avant 1_auth.ts (ordre alphabétique des middlewares).
export const ADMIN_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"

export function applySecurityHeaders(setH: (name: string, value: string) => void) {
  setH('X-Frame-Options', 'DENY')
  setH('X-Content-Type-Options', 'nosniff')
  setH('Referrer-Policy', 'no-referrer')
  setH('Content-Security-Policy', ADMIN_CSP)
}

export default defineEventHandler((event) => {
  applySecurityHeaders((name, value) => setHeader(event, name, value))
})
