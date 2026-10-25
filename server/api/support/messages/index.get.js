import { connectDB } from '~~/server/db/mongo'
import logger from '~~/server/utils/logger'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        setResponseStatus(401)
        return
    }

    const eventStream = createEventStream(event)

    // M-2 : drapeau fermé — aucun push ni lecture après la fermeture du flux,
    // aucun rejet non géré dans les callbacks de timers.
    let closed = false
    let interval = null
    let heartbeatInterval = null
    const cleanup = () => {
        closed = true
        clearInterval(interval)
        clearInterval(heartbeatInterval)
    }
    const safePush = async (payload) => {
        if (closed) return
        try {
            await eventStream.push(JSON.stringify(payload))
        } catch (err) {
            logger.warn('[sse support] push failed', { err })
        }
    }
    eventStream.onClosed(async () => {
        cleanup()
    })

    let db
    let messages
    try {
        db = await connectDB()
        messages = await db
            .collection('supportMessages')
            .find({ userId: userId })
            .sort({ timestamp: 1 })
            .project({ message: 1, sender: 1, timestamp: 1, _id: 1 })
            .toArray()
    } catch (err) {
        // Lecture initiale en échec : on ne laisse pas un flux orphelin.
        cleanup()
        await eventStream.close().catch(() => {})
        throw err
    }

    let lastTimestamp = new Date(0)
    if (messages.length > 0) {
        await safePush({ type: 'initial', data: messages })
        lastTimestamp = messages[messages.length - 1].timestamp
    }

    let polling = false
    interval = setInterval(async () => {
        if (closed || polling) return
        polling = true
        try {
            const newMessages = await db
                .collection('supportMessages')
                .find({
                    userId: userId,
                    timestamp: { $gt: lastTimestamp }
                })
                .sort({ timestamp: 1 })
                .project({ message: 1, sender: 1, timestamp: 1, _id: 1 })
                .toArray()
            if (closed) return
            if (newMessages.length > 0) {
                lastTimestamp = newMessages[newMessages.length - 1].timestamp
                await safePush({ type: 'newMessages', data: newMessages })
            }
        } catch (err) {
            logger.warn('[sse support] poll failed', { err })
        } finally {
            polling = false
        }
    }, 1000)

    heartbeatInterval = setInterval(() => {
        safePush({ type: 'heartbeat', ts: Date.now() })
    }, 30000)

    // Fermé pendant la lecture initiale : les timers viennent d'être créés.
    if (closed) cleanup()

    return eventStream.send()
})
