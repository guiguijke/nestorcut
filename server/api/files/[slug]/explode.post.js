import { defineEventHandler, createError } from 'h3'
import { connectDB } from '~~/server/db/mongo'
import { resolvePolygonParts } from '~~/server/utils/vault'

/**
 * Lot E4-c (`docs/PLAN-ECLATEMENT-2026-09-12.md` §8.3) : « Éclater en
 * pièces » une FICHE déjà importée — le bouton de la carte fichier.
 *
 * Route MINCE : elle marque le document (`explodeRequested`, retour dans la
 * file) et le worker fait le travail (`_explode_into_parts` du lot E2 : un
 * DXF canonique par pièce, écrit depuis ses handles, repassé par l'import
 * ORDINAIRE — des fiches normales). Le dessin d'origine est marqué
 * `explodedInto` et quitte la liste du projet.
 *
 * L'UI a déjà demandé confirmation (une ligne, « c'est irréversible ») : ce
 * n'est pas la responsabilité de cette route.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const file = await db.collection('user_dxf_files').findOne({ slug, ownerId: userId })
    if (!file) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }
    if (file.explodedInto) {
        throw createError({ statusCode: 409, statusMessage: 'File was already split' })
    }
    if (file.processingStatus !== 'completed') {
        throw createError({ statusCode: 409, statusMessage: 'File is processing' })
    }
    if (file.purgedAt) {
        throw createError({ statusCode: 409, statusMessage: 'File expired' })
    }
    // Lot A1 (audit P3-10, réserve) : une fiche à UNE pièce n'a rien à
    // éclater — le bouton est absent de l'UI, l'API refuse proprement au
    // lieu d'un no-op silencieux (le worker aurait marqué explodeRequested
    // pour rien). La géométrie peut être chiffrée (vault) : la lecture
    // passe par le même résolveur que le mapper.
    const parts = await resolvePolygonParts(userId, file)
    if ((parts || []).length < 2) {
        throw createError({ statusCode: 409, statusMessage: 'Single part file' })
    }

    await db.collection('user_dxf_files').updateOne(
        { _id: file._id },
        { $set: { explodeRequested: true, processingStatus: 'pending' } },
    )
    return { ok: true }
})
