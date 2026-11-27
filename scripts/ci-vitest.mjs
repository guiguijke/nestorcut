// Lance la suite vitest de la CI et ne pardonne qu'UNE panne d'outil connue.
//
// Constat (V0.9.21 le 26/11, V0.9.22 le 27/11) : `app-ci` rouge alors que les
// 204 fichiers de tests passaient, sur une seule erreur de fin de suite :
//   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
// C'est le délai FIXE de 60 s du canal entre un processus de test et le
// processus principal (birpc, non réglable dans vitest 3.2) : un fichier qui
// garde la main longtemps (moteur wasm synchrone de bout en bout) laisse
// expirer un compte rendu de tâche déjà parti. Les assertions, elles, ont toutes
// été jugées. Chaque version demandait une relance à la main.
//
// Règle : on rend le code de vitest tel quel, SAUF si (1) vitest a échoué,
// (2) le rapport JSON dit zéro test en échec, zéro fichier en échec, tous les
// fichiers « passed » et au moins un test passé, (3) vitest annonce autant
// d'erreurs non gérées (« caught N unhandled error ») que de délais
// « onTaskUpdate » dans la sortie, et au moins un. Alors avertissement visible
// dans la CI et code 0. Tout autre échec reste rouge.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ANSI = /\x1b\[[0-9;]*m/g
const FLAKE = /\[vitest-worker\]: Timeout calling "onTaskUpdate"/g

/**
 * La panne est-elle SEULEMENT le délai du canal, avec tous les tests verts ?
 * @param {number} code  code de sortie de vitest
 * @param {string} output  sortie standard + erreur, telle quelle (couleurs comprises)
 * @param {object|null} report  rapport JSON de vitest (reporter json)
 */
export function isRpcFlakeOnly(code, output, report) {
    if (code === 0 || !report || typeof output !== 'string') return false
    const text = output.replace(ANSI, '')
    const flakes = (text.match(FLAKE) || []).length
    if (flakes === 0) return false
    if (!(report.numFailedTests === 0 && report.numFailedTestSuites === 0)) return false
    if (!(report.numPassedTests > 0)) return false
    if (!Array.isArray(report.testResults) || report.testResults.some((r) => r.status !== 'passed')) return false
    const caught = /caught (\d+) unhandled errors?/i.exec(text)
    return Boolean(caught) && Number(caught[1]) === flakes
}

async function main() {
    const reportFile = '.vitest-ci-report.json'
    if (existsSync(reportFile)) rmSync(reportFile)
    const args = ['--no-install', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`]
    const child = spawn('npx', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    let output = ''
    child.stdout.on('data', (b) => { output += b; process.stdout.write(b) })
    child.stderr.on('data', (b) => { output += b; process.stderr.write(b) })
    const code = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 1)))
    let report = null
    try {
        report = JSON.parse(readFileSync(reportFile, 'utf8'))
    } catch {
        report = null
    }
    if (isRpcFlakeOnly(code, output, report)) {
        console.log(`::warning title=vitest::Tous les tests passent (${report.numPassedTests}) ; seule erreur : le délai du canal de vitest (« Timeout calling onTaskUpdate »), panne d'outil connue, ignorée.`)
        return 0
    }
    return code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then((c) => { process.exitCode = c }, (e) => { console.error(e); process.exitCode = 1 })
}
