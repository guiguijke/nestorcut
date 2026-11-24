import { connectDB } from '~~/server/db/mongo'
import { buildPlanFields } from '~~/server/utils/planFields'

// Relecture du palier seul (onglet resté ouvert). Jamais le coffre, jamais
// l'utilisateur entier : voir AGENTS.md 65b.
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        setResponseStatus(event, 401)
        return {}
    }

    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId })
    if (!user) {
        setResponseStatus(event, 401)
        return {}
    }

    const config = useRuntimeConfig(event)
    const plan = await buildPlanFields(userId, user, config.public.localComputeEnabled)
    setHeader(event, 'Cache-Control', 'no-store')
    return { id: user.id, ...plan }
})
