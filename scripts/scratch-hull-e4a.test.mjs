// Parité E4-a §8.1.5 côté JS : hull sur les coordonnées RÉELLES du dessin
// du collègue (extraites de l'import navigateur). Scratch : .qa-pw/ (le
// dessin est privé, rien ne sort du poste) — exécuté via
// scripts/vitest.scratch.config.mjs, hors suite CI.
import { expect, it } from 'vitest'
import { convexHullRing } from '../app/composables/localPayloadBuilder'
import fs from 'node:fs'
import path from 'node:path'

it('hull JS sur le dessin réel (scratch)', () => {
    const parts = JSON.parse(fs.readFileSync(path.resolve('.qa-pw/e4a/parts-real.json'), 'utf-8'))
    const hull = convexHullRing(parts.flat())
    fs.writeFileSync(path.resolve('.qa-pw/e4a/hull-js.json'), JSON.stringify(hull))
    console.log(`JS hull : ${hull.length} sommets sur ${parts.flat().length} points`)
    expect(hull.length).toBeGreaterThan(3)
})
