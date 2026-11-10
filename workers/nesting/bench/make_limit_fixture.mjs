// Fabrique la fixture `j7a_limite` du verrou de déterminisme : le job À LA LIMITE
// de la bascule J7-a. Réglages d'usine (tôle 1000×2000, espacement 2, direction
// left), un seul rectangle de 40×100 mm dessiné en (77,77 ; 88,88) : son aire
// flottante dépasse 4000 d'un epsilon, le job reste donc en bande, et sa largeur
// initiale tombe quelques ulp au-dessus de l'espacement, là où le conteneur
// déflaté n'existe pas. Le moteur y doit élargir la bande à l'identique, natif et
// wasm.
//
// Le DXF est écrit ici (aucune donnée de client), lu par le vrai `import_file`
// (wasm géométrie), et le payload sort du VRAI `buildLocalPayload`. La config est
// bornée en TRAVAIL pour que natif et wasm fassent le même travail.
//
//   node workers/nesting/bench/make_limit_fixture.mjs
//
// À relancer seulement si le payload par défaut change. Les fichiers produits sont
// versionnés ; le verrou (`determinism_lock.py`) ne régénère rien.
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

const geo = await import(pathToFileURL(path.join(ROOT, 'public/geometry/nest_geometry.js')).href)
await geo.default({ module_or_path: readFileSync(path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')) })
const { buildLocalPayload } = await import(
  pathToFileURL(path.join(ROOT, 'app/composables/localPayloadBuilder.js')).href)

const [x, y, w, h] = [77.77, 88.88, 40, 100]
const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1',
  '10', String(x), '20', String(y), '10', String(x + w), '20', String(y),
  '10', String(x + w), '20', String(y + h), '10', String(x), '20', String(y + h),
  '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
const imported = geo.import_file(new TextEncoder().encode(dxf))
const { parts } = typeof imported === 'string' ? JSON.parse(imported) : imported
const files = [{
  slug: 'limite', name: 'limite.dxf', count: 1,
  parts: parts.map((p) => ({ ...p, coords: p.coords || p.outer, holes: p.holes || [] })),
}]
// Réglages d'usine : app/utils/units.js (tôle), files.js (espacement), left.
const params = { sheets: [{ width: 1000, height: 2000, count: 1 }], space: 2, directions: ['left'], alternativesCount: 1 }
const deps = { openHoles: async (holes) => holes, pinwheelCapacity: async () => null }
const { payload } = await buildLocalPayload({ files, params, profile: { timeBudgetSec: 2 } }, deps)
if (payload.problem !== 'spp') throw new Error(`la bascule J7-a s'est déclenchée : ${payload.problem}`)

const config = {
  ...payload.engineConfig,
  prng_seed: 7, n_workers: 1, separator_workers: 1, live_events: false,
  time_budget_sec: 3600, explore_max_conseq_failed_attempts: 2, compress_failure_decay: 0.5,
}
delete config.plateau_patience_sec
const dir = path.join(HERE, 'fixtures', 'j7a_limite')
mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, 'instance.json'), JSON.stringify(payload.instance, null, 1) + '\n')
writeFileSync(path.join(dir, 'config_det.json'), JSON.stringify(config, null, 1) + '\n')
console.log('problem', payload.problem, 'strip_h', payload.instance.strip_height,
  'ring', JSON.stringify(payload.instance.items[0].shape.data))
