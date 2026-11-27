import { describe, expect, it } from 'vitest'
import { isRpcFlakeOnly } from '../../scripts/ci-vitest.mjs'

// La CI ne pardonne qu'une panne d'outil : le délai « onTaskUpdate » de vitest,
// avec tous les tests verts. Tout le reste reste rouge.
const green = { numFailedTests: 0, numFailedTestSuites: 0, numPassedTests: 2590, testResults: [{ status: 'passed' }, { status: 'passed' }] }
const ansi = (s) => `\x1b[31m\x1b[1m${s}\x1b[22m\x1b[39m`
const flakeOut = [
    ' Test Files  204 passed (204)',
    ansi('Error') + ': [vitest-worker]: Timeout calling "onTaskUpdate"',
    'Vitest caught 1 unhandled error during the test run.',
    'Error fetching project: Error: 500', // ligne normale imprimée par un test
].join('\n')

describe('ci-vitest : seule la panne connue est pardonnée', () => {
    it('délai onTaskUpdate seul, tous les tests verts : pardonné', () => {
        expect(isRpcFlakeOnly(1, flakeOut, green)).toBe(true)
    })
    it('vitest réussi : rien à pardonner', () => {
        expect(isRpcFlakeOnly(0, flakeOut, green)).toBe(false)
    })
    it('un test en échec : rouge', () => {
        expect(isRpcFlakeOnly(1, flakeOut, { ...green, numFailedTests: 1 })).toBe(false)
        expect(isRpcFlakeOnly(1, flakeOut, { ...green, numFailedTestSuites: 1 })).toBe(false)
        expect(isRpcFlakeOnly(1, flakeOut, { ...green, testResults: [{ status: 'passed' }, { status: 'failed' }] })).toBe(false)
    })
    it('une autre erreur non gérée en plus : rouge', () => {
        const out = flakeOut.replace('caught 1 unhandled error', 'caught 2 unhandled errors') + '\nTypeError: boom'
        expect(isRpcFlakeOnly(1, out, green)).toBe(false)
    })
    it('autre panne sans le délai, ou rapport absent, ou aucun test : rouge', () => {
        expect(isRpcFlakeOnly(1, 'Vitest caught 1 unhandled error\nError: autre', green)).toBe(false)
        expect(isRpcFlakeOnly(1, flakeOut, null)).toBe(false)
        expect(isRpcFlakeOnly(1, flakeOut, { ...green, numPassedTests: 0 })).toBe(false)
        expect(isRpcFlakeOnly(1, flakeOut.replace(/Vitest caught.*\n/, ''), green)).toBe(false)
    })
})
