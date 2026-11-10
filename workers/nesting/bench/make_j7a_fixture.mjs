// Fabrique la fixture `j7a_defaut` du verrou de déterminisme : le CHEMIN PAR
// DÉFAUT d'un petit job (réglages d'usine : tôle 1000×2000, espacement 2,
// direction left, 2 pièces de 40×40 mm).
//
// Le payload sort du VRAI `buildLocalPayload` (la bascule J7-a l'envoie en
// BPP), les deux « walks » du pool navigateur sont rejoués par le wasm du
// dépôt avec une config bornée en TRAVAIL (sa_max_iterations), et le résultat
// est figé dans `fixtures/j7a_defaut/merge_input.json` : l'entrée EXACTE de
// `merge_alternatives` (natif et wasm), finition de tôle partielle comprise.
//
//   node workers/nesting/bench/make_j7a_fixture.mjs
//
// À relancer seulement si le payload par défaut change. Le fichier produit est
// versionné ; le verrou (`determinism_lock.py`) ne régénère rien.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')

// Résolution des alias Nuxt `~~/` et `~/` utilisés par le builder.
const hook = `
import { pathToFileURL } from 'node:url'
const ROOT = ${JSON.stringify(ROOT)}
export async function resolve(spec, ctx, next) {
  let s = spec
  if (s.startsWith('~~/')) s = pathToFileURL(ROOT + '/' + s.slice(3)).href
  else if (s.startsWith('~/')) s = pathToFileURL(ROOT + '/app/' + s.slice(2)).href
  try { return await next(s, ctx) } catch (e) {
    if (!s.endsWith('.js')) { try { return await next(s + '.js', ctx) } catch {} }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hook))

const wasm = await import(pathToFileURL(path.join(ROOT, 'public/engine/nest_wasm.js')).href)
await wasm.default({ module_or_path: readFileSync(path.join(ROOT, 'public/engine/nest_wasm_bg.wasm')) })
const { buildLocalPayload } = await import(
  pathToFileURL(path.join(ROOT, 'app/composables/localPayloadBuilder.js')).href)

// Réglages d'usine : app/utils/units.js (tôle), files.js (espacement), left.
const SIDE = 40
const part = { coords: [[0, 0], [SIDE, 0], [SIDE, SIDE], [0, SIDE], [0, 0]], holes: [], width: SIDE, height: SIDE }
const files = [{ slug: 'f', name: 'f', count: 2, parts: [part] }]
const params = { sheets: [{ width: 1000, height: 2000, count: 1 }], space: 2, directions: ['left'], alternativesCount: 1 }
const deps = { openHoles: async () => [], pinwheelCapacity: async () => null }
const { payload } = await buildLocalPayload({ files, params, profile: { timeBudgetSec: 2 } }, deps)

const { deriveSeed } = await import(
  pathToFileURL(path.join(ROOT, 'app/composables/localPool.js')).href)

// Même dérivation que le pool (localPool.js) : le walk w tourne avec
// seed_w, son run interne mono-walk avec derive_seed(seed_w, 0), et le merge
// reçoit cette seed en STRING (piège #16b : 63 bits > 2^53).
const SA_ITERATIONS = 400
const master = String(payload.engineConfig.prng_seed)
const runs = []
for (let w = 0; w < 2; w++) {
  const seed = deriveSeed(master, w).toString()
  const runSeed = deriveSeed(BigInt(seed), 0).toString()
  const cfg = {
    ...payload.engineConfig, n_workers: 1, separator_workers: 1,
    finish_partial_sheet: false, problem: payload.problem, live_events: false,
    time_budget_sec: 3600, sa_max_iterations: SA_ITERATIONS,
  }
  delete cfg.plateau_patience_sec
  const r = JSON.parse(wasm.run_nesting(JSON.stringify(payload.instance), JSON.stringify(cfg), BigInt(seed)))
  for (const alt of r.alternatives) runs.push({ ...alt, seed: runSeed })
}
const input = {
  problem: payload.problem,
  instance: payload.instance,
  engineConfig: {
    ...payload.engineConfig, prng_seed: 0, time_budget_sec: 3600,
    sa_max_iterations: SA_ITERATIONS, live_events: false,
  },
  runs,
  biases: payload.engineConfig.biases ?? ['left', 'bottom', 'balanced'],
  n_alternatives: payload.engineConfig.n_alternatives ?? 1,
}
delete input.engineConfig.plateau_patience_sec
const dir = path.join(HERE, 'fixtures', 'j7a_defaut')
mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, 'merge_input.json'), JSON.stringify(input, null, 1) + '\n')
console.log('problem', payload.problem, 'runs', runs.length, 'strip_h', payload.instance.strip_height ?? null)
