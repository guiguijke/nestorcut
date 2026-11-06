// Runs the browser-target wasm artifact on a fixture and prints the canonical
// SHA-256 of the alternatives (cross-target determinism lock).
//   node workers/nesting/bench/wasm_canon_hash.mjs [fixture]
// Fixture par défaut : b_demo. Les autres : e0_volute (SPP, repli du
// gonflement robuste du lot E0), j7a_defaut (chemin par défaut d'un petit job,
// par `merge_alternatives` — lot A) et j7a_limite (job à la limite de la bascule
// J7-a, largeur initiale dans la fenêtre sans conteneur).
import { existsSync, readFileSync } from 'node:fs';
import init, { run_nesting, merge_alternatives } from '../../../public/engine/nest_wasm.js';

const root = new URL('.', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const wasmBytes = readFileSync(new URL('../../../public/engine/nest_wasm_bg.wasm', root));
await init(wasmBytes);

const fixture = process.argv[2] || 'b_demo';
// Fixture de FUSION : l'entrée de `merge_alternatives` est figée en JSON.
const mergePath = new URL(`fixtures/${fixture}/merge_input.json`, root);
let out;
if (existsSync(mergePath)) {
  out = JSON.parse(merge_alternatives(readFileSync(mergePath, 'utf8')));
} else {
  const instance = read(`fixtures/${fixture}/instance.json`);
  const config = read(`fixtures/${fixture}/config_det.json`);
  const seed = BigInt(config.match(/"prng_seed":\s*(\d+)/)[1]);
  out = JSON.parse(run_nesting(instance, config, seed));
}

// Canonical form shared with determinism_lock.py (numbers via String()).
const num = (x) => String(x);
const altStr = out.alternatives.map((alt) => {
  const head = [alt.rank, num(alt.cost ?? alt.strip_width), num(alt.density),
    num(alt.iterations ?? alt.evaluations)].join(',');
  const layouts = (alt.solution.layouts || [alt.solution.layout]).map((l) =>
    l.placed_items
      .map((pi) => [pi.item_id, num(pi.transformation.rotation),
        num(pi.transformation.translation[0]), num(pi.transformation.translation[1])].join(','))
      .sort()
      .join(';')
  ).join('|');
  return head + '#' + layouts;
}).join('\n');

const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(altStr));
console.log([...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
