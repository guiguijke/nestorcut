import { connectDB } from '../db/mongo'
import logger from '../utils/logger'

// S-1 (audit 2026-09-27) : journal SANS contenu. On n'enregistre que la forme
// de l'échange — jamais le corps de requête (clé du coffre, fichiers, e-mails),
// jamais la réponse (géométrie déchiffrée), jamais l'URL (query : jetons, slugs),
// ni user-agent ni userId. Ne PAS appeler readBody ici (le webhook Stripe lit
// lui-même le corps brut) ni intercepter res.write. Verrou : logRequests.test.js.
// Durée de vie : 14 jours (purge/sweep.js).
export default defineEventHandler((event) => {
    const { method, headers } = event.node.req
    const start = Date.now()
    const isSSE = headers.accept === 'text/event-stream'

    const originalEnd = event.node.res.end

    event.node.res.end = function (...args) {
        // Le routeur a posé matchedRoute avant la fin de la réponse : motif de
        // route (« /api/files/project/geometry/[slug] »), jamais l'URL réelle.
        const route = event.context.matchedRoute?.path || 'page'
        const statusCode = event.node.res.statusCode
        const duration = Date.now() - start

        connectDB()
            .then((db) =>
                db.collection('http').insertOne({
                    method,
                    route,
                    statusCode,
                    duration,
                    isSSE,
                    timestamp: new Date(),
                })
            )
            .catch((err) => logger.warn(`log-requests: insert skip: ${err?.message}`))

        return originalEnd.apply(this, args)
    }
})
