import { connectDB } from '~~/server/db/mongo'
import { MESSAGE_SENDER } from '~~/server/features/support/const'
import { notifyAdminSupportMessage } from '~~/server/features/notification/adminNotify'
import logger from '~~/server/utils/logger'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        setResponseStatus(401)
        return
    }

    const { message } = await readBody(event)

    const db = await connectDB()
    const record = await db.collection('supportMessages').insertOne({
        userId: userId,
        sender: MESSAGE_SENDER.USER,
        message: message,
        timestamp: new Date()
    })

    const { insertedId } = record

    const user = await db.collection('users').findOne({ id: userId })

    if (!user?.email) {
        throw new Error('User not found')
    }

    const email = user.email

    // Notification admin (fire-and-forget) : ne concerne que le message d'un
    // UTILISATEUR — les messages de bienvenue (welcomemessage.js) ne passent pas ici.
    notifyAdminSupportMessage(event, { kind: 'chat', userId, name: user.name, email, message }).catch((err) => {
        logger.warn('Error notifying admin of support message', err)
    })

    

    const dbMessage = await db
        .collection('supportMessages')
        .findOne({ _id: insertedId })

    return dbMessage
})
