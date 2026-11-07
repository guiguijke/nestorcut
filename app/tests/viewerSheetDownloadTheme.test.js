import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'

const tpl = (name) => parse(readFileSync(
    fileURLToPath(new URL(`../components/${name}`, import.meta.url)), 'utf8',
)).descriptor.template.content

// Les boutons « Télécharger la tôle n » du visualiseur (serveur et appareil).
function sheetDownloadButtons(t) {
    const blocks = t.split('<MainButton').slice(1).map((b) => b.split('/>')[0])
    return blocks.filter((b) => b.includes('result_part_download'))
}

describe('fenêtre multi-tôles : un seul bouton plein', () => {
    it('« Télécharger la tôle n » est secondaire', () => {
        const buttons = sheetDownloadButtons(tpl('ResultViewer.vue'))
        expect(buttons).toHaveLength(2)
        for (const b of buttons) {
            expect(b).toContain('themeType.secondary')
            expect(b).not.toContain('themeType.primary')
        }
    })

    it('« Tout télécharger » du rapport reste le bouton principal du serveur', () => {
        const report = tpl('ResultReport.vue')
        const all = report.split('<MainButton').slice(1).map((b) => b.split('/>')[0])
            .filter((b) => b.includes('result_download_all') && b.includes('zipDownloadUrl'))
        expect(all).toHaveLength(1)
        expect(all[0]).toContain('themeType.primary')
    })
})
