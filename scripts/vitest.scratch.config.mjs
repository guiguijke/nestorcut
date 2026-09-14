import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Config de SCRATCH (scripts/scratch-*) : mesures de parité E4-a sur des
// données LOCALES privées (.qa-pw, dessin du collègue) — jamais dans la
// suite CI (le vitest.config.js racine n'inclut pas scripts/).
const root = fileURLToPath(new URL('..', import.meta.url))
export default defineConfig({
    esbuild: { tsconfigRaw: '{}' },
    resolve: { alias: { '~~': root, '~': root } },
    test: {
        include: ['scripts/scratch-*.test.mjs'],
        environment: 'node',
    },
})
