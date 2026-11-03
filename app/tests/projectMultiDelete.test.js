import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Sélection multiple de projets (demande du propriétaire, 03/11). Pas de
// harness DOM côté app (vitest 'node') : la logique est testée dans
// projectDelete.test.js, ici le câblage des deux composants.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('liste des projets — sélection multiple', () => {
    const list = read('../components/UserProjects.vue')
    const item = read('../components/UserProjectItem.vue')

    it('la liste supprime par deleteProjects, avec le slug consulté et la progression', () => {
        expect(list).toContain("import { canDeleteProject, deleteProjects } from '~/composables/projects'")
        expect(list).toMatch(/deleteProjects\(selectedProjects\.value, \{\s*currentSlug: route\.params\.slug,\s*onProgress:/)
    })

    it('en sélection, un clic sur une carte ne ferme pas le panneau et ne navigue pas', () => {
        expect(list).toContain(`@click="selecting || $emit('closeAside')"`)
        expect(item).toMatch(/<label\s+v-if="selecting"/)
        expect(item).toMatch(/<NuxtLink\s+v-else/)
    })

    it('pas de poubelle en sélection, pas de case pour la démo', () => {
        expect(item).toContain('v-if="canDelete && !selecting"')
        expect(item).toMatch(/<input\s+v-if="canDelete"\s+type="checkbox"/)
    })

    it('le projet consulté reste cochable malgré pointer-events: none', () => {
        const active = item.indexOf('&--active {')
        const selecting = item.indexOf('&--selecting {')
        expect(active).toBeGreaterThan(-1)
        expect(selecting).toBeGreaterThan(active)
    })
})
