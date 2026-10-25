import { connectDB, getDxfResultBucket } from "~~/server/db/mongo";
import { createError } from "h3";
import archiver from "archiver";
import { getRouterParam } from "#imports"; // fallback, adjust if needed
import { trackEvent } from "~~/server/tracking/add"
import { createDecryptStream } from "~~/server/utils/crypto";
import { requireFileAccess } from "~~/server/utils/vault";
import logger from "~~/server/utils/logger";

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId;
    if (!userId) {
        throw createError({
            statusCode: 401,
            statusMessage: "Unauthorized",
        });
    }
    const nestSlug = getRouterParam(event, "nestslug");
    const db = await connectDB();
    const nestResult = await db.collection('nesting_jobs').findOne({ slug: nestSlug, ownerId: userId })
    if (!nestResult) {
        throw createError({
            statusCode: 404,
            statusMessage: "Nesting result not found",
        });
    }

    await trackEvent(event, "download_nested_result_zip_file", {
        nestSlug: nestSlug,
    })

    const nestDxfBucket = await getDxfResultBucket();

    const dxfFiles = await nestDxfBucket.find({ filename: { $in: nestResult.dxf_files } }).toArray();

    // Sources validées AVANT les en-têtes : un fichier manquant donne une
    // erreur HTTP propre, jamais un ZIP « valide » auquel il manque une tôle.
    const expectedNames = new Set(nestResult.dxf_files || []);
    if (dxfFiles.length < expectedNames.size) {
        throw createError({
            statusCode: 404,
            statusMessage: "Result files not found",
        });
    }

    // Results may be encrypted — the vault must be unlocked to read them.
    const hasEncrypted = dxfFiles.some((file) => file.metadata?.enc);
    let dek = null;
    if (hasEncrypted) {
        ({ dek } = await requireFileAccess(userId));
    }

    setResponseHeaders(event, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=nesting-${nestSlug}.zip`,
        "Cache-Control": "private, no-store",
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    const res = event.res;
    // Une erreur de flux (archiver OU lecture GridFS / déchiffrement) ne doit
    // jamais finir en ZIP tronqué servi en 200. Avant le premier octet : 500
    // propre ; après : on détruit la connexion pour que le client voie un
    // échec réseau. Un throw dans un listener serait une exception non
    // rattrapée — on journalise.
    let failed = false;
    const abort = (err) => {
        if (failed) return;
        failed = true;
        logger.error(`Result zip ${nestSlug} failed: ${err?.message}`);
        archive.destroy();
        if (!res.headersSent) {
            res.removeHeader("Content-Disposition");
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ statusCode: 500, statusMessage: "Error creating zip archive" }));
        } else {
            res.destroy();
        }
    };
    archive.on("error", abort);
    res.on("close", () => archive.destroy());
    archive.pipe(res);

    for (const file of dxfFiles) {
        let stream = nestDxfBucket.openDownloadStreamByName(file.filename);
        stream.on("error", abort);
        if (file.metadata?.enc) {
            stream = stream.pipe(createDecryptStream(dek, file.filename, userId));
            stream.on("error", abort);
        }
        archive.append(stream, { name: file.filename });
    }
    try {
        await archive.finalize();
    } catch (err) {
        abort(err);
    }
    return res;
})
