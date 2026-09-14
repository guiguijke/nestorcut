import { defineEventHandler, createError } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Lot E4-b (`docs/PLAN-ECLATEMENT-2026-09-12.md` §8.2) : mise à l'échelle
 * d'une FICHE déjà importée — l'action « Échelle » de la carte fichier.
 *
 * Cette route est MINCE À DESSEIN : elle ne touche qu'au document Mongo et
 * remet le fichier dans la file (`processingStatus: 'pending'`). Tout le
 * travail géométrique vit dans le worker (`resolve_import_scale` du lot E2,
 * qui met la copie canonique à l'échelle puis relit) — le même code que la
 * dépose d'avant E4, une seule chaîne.
 *
 * Sémantique du facteur : il s'applique à la copie canonique ACTUELLE (un
 * facteur 0,5 sur un dessin déjà à 0,5 le met à 0,25) ; en mode cible
 * (largeur/hauteur en mm), le worker résout la cible sur l'étendue MESURÉE
 * du dessin courant. Le client affiche et envoie exactement ce qu'il a
 * réglé dans l'aperçu.
 *
 * `reset: true` : retour aux octets d'origine. La copie `<slug>.orig` est
 * gardée par le worker à la PREMIÈRE application (`_rewrite_scaled_copy`) ;
 * la restauration se fait aussi côté worker (`importScaleReset`) — aucune
 * I/O GridFS (chiffrée côté vault) hors du Python.
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
    if (file.processingStatus !== 'completed') {
        throw createError({ statusCode: 409, statusMessage: 'File is processing' })
    }
    if (file.explodedInto) {
        // Un dessin éclaté n'est plus une fiche (la liste du projet l'écarte).
        throw createError({ statusCode: 409, statusMessage: 'File was split' })
    }
    if (file.purgedAt) {
        throw createError({ statusCode: 409, statusMessage: 'File expired' })
    }

    const body = await readBody(event)
    const update = { processingStatus: 'pending' }

    if (body?.reset === true) {
        if (!file.importScaleApplied) {
            // Rien à réinitialiser : la fiche est déjà à l'échelle d'origine.
            return { ok: true, reset: true, changed: false }
        }
        Object.assign(update, {
            importScaleReset: true,
            $unsetFields: ['importScale', 'importScaleTarget', 'importScaleApplied'],
        })
    } else if (body?.mode === 'factor') {
        const value = Number(body.value)
        if (!Number.isFinite(value) || value <= 0 || value === 1) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid factor' })
        }
        Object.assign(update, {
            importScale: value,
            $unsetFields: ['importScaleTarget', 'importScaleApplied'],
        })
    } else if (body?.mode === 'width' || body?.mode === 'height') {
        const mm = Number(body.mm)
        if (!Number.isFinite(mm) || mm <= 0) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid target' })
        }
        Object.assign(update, {
            importScaleTarget: { mode: body.mode, mm },
            $unsetFields: ['importScale', 'importScaleApplied'],
        })
    } else {
        throw createError({ statusCode: 400, statusMessage: 'Invalid body' })
    }

    // Les champs à retirer vivent dans un `$unset` séparé — Mongo n'accepte
    // pas `$unset` comme valeur de `$set`.
    const { $unsetFields, ...sets } = update
    const op = { $set: sets }
    if ($unsetFields?.length) op.$unset = Object.fromEntries($unsetFields.map((k) => [k, '']))

    await db.collection('user_dxf_files').updateOne({ _id: file._id }, op)
    return { ok: true, changed: true }
})
