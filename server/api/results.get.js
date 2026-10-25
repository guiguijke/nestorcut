import { getResults } from '~~/server/features/results/resultcontroller'
import logger from '~~/server/utils/logger'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        setResponseStatus(401)
        return
    }

    const eventStream = createEventStream(event)

    // N-11 : drapeau fermé — aucun push ni lecture après la fermeture du flux,
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
            logger.warn('[sse results] push failed', { err })
        }
    }
    eventStream.onClosed(async () => {
        cleanup()
    })

    let result
    try {
        result = await getResults(userId)
    } catch (err) {
        // Lecture initiale en échec : on ne laisse pas un flux orphelin.
        cleanup()
        await eventStream.close().catch(() => {})
        throw err
    }

    await safePush({
        type: 'initial',
        data: {
            items: result.items,
            needNotification: false,
        }
    })

    let previousResult = result
    let polling = false
    interval = setInterval(async () => {
        if (closed || polling) return
        polling = true
        try {
            const newResult = await getResults(userId)
            if (closed) return
            if (JSON.stringify(previousResult) !== JSON.stringify(newResult)) {
                await safePush({
                    type: 'update',
                    data: {
                        items: newResult.items,
                        needNotification: newResult.items.some(item => {
                            const previousItem = previousResult.items.find(prev => prev.slug === item.slug)
                            return previousItem && previousItem.isInProgress !== item.isInProgress
                        }),
                    }
                })
                previousResult = newResult
            }
        } catch (err) {
            logger.warn('[sse results] poll failed', { err })
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
});
