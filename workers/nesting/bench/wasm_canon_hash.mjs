// Runs the browser-target wasm artifact on a fixture and prints the canonical
// SHA-256 of the alternatives (cross-target determinism lock).
//   node workers/nesting/bench/wasm_canon_hash.mjs [fixture]
// Fixture par défaut : b_demo. L'autre est e0_volute (SPP, repli du
// gonflement robuste du lot E0).
import { readFileSync } from 'node:fs';
import init, { run_nesting } from '../../../public/engine/nest_wasm.js';

const root = new URL('.', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const wasmBytes = readFileSync(new URL('../../../public/engine/nest_wasm_bg.wasm', root));
await init(wasmBytes);

const fixture = process.argv[2] || 'b_demo';
const instance = read(`fixtures/${fixture}/instance.json`);
const config = read(`fixtures/${fixture}/config_det.json`);
const seed = BigInt(config.match(/"prng_seed":\s*(\d+)/)[1]);

const out = JSON.parse(run_nesting(instance, config, seed));

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
