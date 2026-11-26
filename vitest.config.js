import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for the Nuxt server code (server/**) and the pure app logic
// behind the local (browser) compute path (app/tests/**). The app has no
// browser test harness — this config only resolves the `~~`/`~` Nuxt aliases
// so modules import cleanly outside of Nitro.
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
    // `app-ci` était rouge depuis le 2026-09-08 : `server/tests/signupDigest.test.js`
    // importe `admin/server/utils/signupDigest`, esbuild remonte alors jusqu'à
    // `admin/tsconfig.json` qui fait `extends ./.nuxt/tsconfig.json` — un
    // fichier GÉNÉRÉ par `nuxt prepare`, donc absent du runner CI (présent en
    // local, ce qui rendait l'échec invisible au poste). On coupe la recherche
    // de tsconfig pour les tests : ils n'en ont aucun besoin, le code testé est
    // du JavaScript.
    esbuild: { tsconfigRaw: '{}' },
    // `~` = srcDir de Nuxt 4, c'est-à-dire `app/` : tout import `~/utils/…`
    // ou `~/composables/…` du code de l'app y pointe (lot V1 téléchargement,
    // tests de composables). `~~` reste la racine du dépôt.
    resolve: {
        alias: {
            '~~': root,
            '~': `${root}app`,
        },
    },
    test: {
        environment: 'node',
        // Deux projets : les tests `*.client.test.js` voient le code comme dans le
        // navigateur (`import.meta.client` vrai : instantanés de projets, unité),
        // tous les autres comme sur le serveur (indéfini), inchangés.
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    include: ['server/tests/**/*.test.js', 'app/tests/**/*.test.js'],
                    exclude: ['**/node_modules/**', 'app/tests/**/*.client.test.js'],
                },
            },
            {
                extends: true,
                define: { 'import.meta.client': 'true', 'import.meta.server': 'false' },
                test: {
                    name: 'client',
                    include: ['app/tests/**/*.client.test.js'],
                },
            },
        ],
    },
})
