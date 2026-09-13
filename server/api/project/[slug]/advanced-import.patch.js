import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Lot E3 (`docs/PLAN-ECLATEMENT-2026-09-12.md` §6) : l'état de l'« Import
 * avancé » du projet.
 *
 * C'EST UNE PROPRIÉTÉ DU PROJET, et c'est le propriétaire qui l'a demandé
 * ainsi : un projet créé avec l'interrupteur allumé pose la question à chacun
 * de ses dépôts suivants, et l'interrupteur reste modifiable depuis la page
 * projet. Le lot E1 en avait fait un état de SESSION (`sessionStorage`) : il
 * mourait avec l'onglet et ne suivait pas le projet.
 *
 * Champ ADDITIF : un projet d'avant ce lot ne le porte pas, et son absence
 * vaut ÉTEINT — la chaîne d'import est alors celle d'avant, sans lecture
 * supplémentaire.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const project = await db.collection('projects').findOne({ slug })
    // Un projet de démo est partagé et en lecture seule : on n'y écrit rien.
    if (!project || project.ownerId !== userId || project.isDemo) {
        throw createError({ statusCode: 404, statusMessage: 'Project not found' })
    }

    const body = await readBody(event)
    const advancedImport = body?.advancedImport === true
    await db.collection('projects').updateOne({ slug }, { $set: { advancedImport } })
    return { ok: true, advancedImport }
})
