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
    resolve: {
        alias: {
            '~~': root,
            '~': root,
        },
    },
    test: {
        include: ['server/tests/**/*.test.js', 'app/tests/**/*.test.js'],
        environment: 'node',
    },
})
