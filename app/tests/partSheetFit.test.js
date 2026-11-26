import { describe, expect, it } from 'vitest'
import { firstPartFittingNoSheet, rotationAngles } from '../utils/partSheetFit'

const id = (v) => v
const file = (name, w, h, extra = {}) => ({ name, count: 1, rotation: '[0,90,180,270]', parts: [{ width: w, height: h }], ...extra })
const sheet = (width, height, count = '1') => ({ width: String(width), height: String(height), count })
const run = (files, sheets, extra = {}) => firstPartFittingNoSheet({ files, sheets, toMm: id, rotationCount: 4, ...extra })

describe('partSheetFit — chaque pièce dans une tôle', () => {
    it('barre 900x40 et carré 300, deux tôles importées 1000x100 et 350x350 : tout tient', () => {
        const files = [file('barre', 900, 40), file('carre', 300, 300)]
        expect(run(files, [sheet(1000, 100), sheet(350, 350)])).toBeNull()
    })

    it('une seule tôle 1000x100 : le carré de 300 est nommé', () => {
        const files = [file('barre', 900, 40), file('carre', 300, 300)]
        expect(run(files, [sheet(1000, 100)])).toEqual({ name: 'carre', width: 300, height: 300 })
    })

    it('barre 200x10 sur 150x150 à 45 degrés : non testé', () => {
        const f = file('barre', 200, 10, { rotation: JSON.stringify(rotationAngles(8)) })
        expect(run([f], [sheet(150, 150)])).toBeNull()
        // à quart de tour seulement : refus
        expect(run([file('barre', 200, 10)], [sheet(150, 150)])).toEqual({ name: 'barre', width: 200, height: 10 })
    })

    it('rotation globale : 8 rotations sans valeur par fichier ne testent pas', () => {
        const f = { name: 'b', count: 1, parts: [{ width: 200, height: 10 }] }
        expect(run([f], [sheet(150, 150)], { rotationCount: 8 })).toBeNull()
        expect(run([f], [sheet(150, 150)], { rotationCount: 4 })).not.toBeNull()
    })

    it('149,96 sur 149,97 passe, et 0,1 mm de tolérance', () => {
        expect(run([file('p', 149.96, 20)], [sheet(149.97, 150)])).toBeNull()
        expect(run([file('p', 150.09, 20)], [sheet(150, 150)])).toBeNull()
        expect(run([file('p', 150.11, 20)], [sheet(150, 150)])).not.toBeNull()
    })

    it('un sens ou l\'autre', () => {
        expect(run([file('p', 40, 900)], [sheet(1000, 100)])).toBeNull()
    })

    it('un bloc est une pièce, sa boîte', () => {
        const f = file('bloc', 10, 10, { block: { width: 2834, height: 689 } })
        expect(run([f], [sheet(2000, 1000)])).toEqual({ name: 'bloc', width: 2834, height: 689 })
        expect(run([f], [sheet(3000, 1000)])).toBeNull()
    })

    it('les tôles sans quantité ne comptent pas, fichiers à zéro ignorés', () => {
        const files = [file('grande', 500, 500)]
        expect(run(files, [sheet(100, 100), sheet(600, 600, '0')])).not.toBeNull()
        expect(run([file('grande', 500, 500, { count: 0 })], [sheet(100, 100)])).toBeNull()
        // aucune tôle avec quantité : une autre garde parle
        expect(run(files, [sheet(600, 600, '0')])).toBeNull()
    })

    it('tôle sans champ quantité (anciens réglages) : une tôle', () => {
        expect(run([file('p', 500, 500)], [{ width: 100, height: 100 }])).not.toBeNull()
        expect(run([file('p', 50, 50)], [{ width: 100, height: 100 }])).toBeNull()
    })

    it('conversion : les tôles sont en unité d\'affichage', () => {
        const toMm = (v) => v * 25.4
        // 48 x 96 pouces = 1219 x 2438 mm
        expect(firstPartFittingNoSheet({ files: [file('p', 1200, 2400)], sheets: [sheet(48, 96)], toMm, rotationCount: 4 })).toBeNull()
        expect(firstPartFittingNoSheet({ files: [file('p', 1300, 2400)], sheets: [sheet(48, 96)], toMm, rotationCount: 4 })).not.toBeNull()
    })

    it('virgule décimale dans la tôle', () => {
        expect(run([file('p', 149, 20)], [sheet('149,5', '150')])).toBeNull()
    })
})
