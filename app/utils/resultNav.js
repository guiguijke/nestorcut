/**
 * D12 / d10 (02/11) : navigation autour de la fenêtre de résultat. Module pur
 * (testé en node, app/tests/resultNav.test.js).
 */
import { API_ROUTES } from '../composables/apiRoutes' // relatif : en vitest, `~` = racine du dépôt

/** D12 : la page affichée est celle du projet du job. `filesProjectPath` est
 * `filesStore.getters.projectSlug`, qui porte le CHEMIN d'API
 * (`/api/project/<slug>`, files.js:358), jamais le slug nu. */
export function isOnJobProject(routeSlug, filesProjectPath, projectSlug) {
    return Boolean(projectSlug)
        && routeSlug === projectSlug
        && filesProjectPath === API_ROUTES.PROJECT(projectSlug)
}

/** d10 : l'item de la liste SSE à rouvrir, ou null. */
export function findReopenItem(list, target) {
    if (!target?.resultSlug || !Array.isArray(list)) return null
    return list.find((i) => i?.slug === target.resultSlug) ?? null
}
