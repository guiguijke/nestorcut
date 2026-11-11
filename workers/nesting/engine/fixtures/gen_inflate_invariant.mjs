// Génère fixtures/inflate_invariant_volutes.json : les 63 volutes synthétiques
// (brutes et simplifiées par le VRAI simplifyRing du builder JS, tolérance 0,05).
// Usage : node fixtures/gen_inflate_invariant.mjs   (depuis workers/nesting/engine)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '../../../../app/composables/localPayloadBuilder.js'), 'utf8')
// Extraction du texte du builder (l'import `~~` ne se résout pas hors Nuxt).
const grab = (from, to) => src.slice(src.indexOf(from), src.indexOf(to))
const code = [
  'const SIMPLIFY_MM = 0.05',
  src.slice(src.indexOf('const isClosedRing'), src.indexOf('/** Aire absolue')),
  src.slice(src.indexOf('export function ringAreaAbs'), src.indexOf('export function ', src.indexOf('export function ringAreaAbs') + 10)),
  src.slice(src.indexOf('/** Distance point'), src.indexOf('/** Miroir de core/main.py')),
].join('\n').replace(/export function/g, 'function')
const simplifyRing = new Function(code + '\nreturn simplifyRing')()

function voluteRing(gap, half, turns, steps) {
  const pitch = 2 * half + gap
  const r0 = 6
  const at = (s, side) => {
    const t = (s / steps) * turns * 2 * Math.PI
    const r = r0 + (pitch * t) / (2 * Math.PI) + side * half
    return [Math.fround(r * Math.cos(t)), Math.fround(r * Math.sin(t))]
  }
  const ring = []
  for (let s = 0; s <= steps; s++) ring.push(at(s, -1))
  for (let s = steps; s >= 0; s--) ring.push(at(s, 1))
  return ring
}

const out = []
for (const gap of [0.05, 0.3, 1.0, 1.9, 2.0, 2.1, 3.0])
  for (const half of [0.6, 1.2, 3.0])
    for (const turns of [1.5, 2.5, 4.0]) {
      const steps = 240
      const raw = voluteRing(gap, half, turns, steps)
      let simp = simplifyRing(raw)
      // simplifyRing rend un anneau fermé quand il simplifie : on le rouvre.
      const f = simp[0], l = simp[simp.length - 1]
      if (simp.length > 1 && f[0] === l[0] && f[1] === l[1]) simp = simp.slice(0, -1)
      out.push({ gap, half, turns, steps, n_raw: raw.length, ring: simp })
    }
fs.writeFileSync(path.join(here, 'inflate_invariant_volutes.json'), JSON.stringify(out))
console.log(out.length, 'volutes;', out.map(o => `${o.n_raw}->${o.ring.length}`).join(' '))
