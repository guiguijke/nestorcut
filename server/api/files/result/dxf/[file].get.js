import { getDxfResultBucket } from "~~/server/db/mongo";
import { sendOwnedBucketFile } from "~~/server/utils/files";
import { trackEvent } from "~~/server/tracking/add"
import { assertResultDxfDownloadable } from "~~/server/utils/sheetDownloadGate";

export default defineEventHandler(async (event) => {
    const fileName = getRouterParam(event, "file");

    // O2 (02/11) : verrou serveur des tôles N > plafond d'un Free (403
    // sheet_download_locked). Les tôles 1..cap ne coûtent aucune requête.
    try {
        await assertResultDxfDownloadable(event, fileName);
    } catch (err) {
        if (err?.statusMessage === "sheet_download_locked") {
            await trackEvent(event, "download_nested_result_dxf_locked", {
                sheet: String(err.data?.sheet ?? ""),
            })
        }
        throw err;
    }

    const resultDxfBucket = await getDxfResultBucket();

    // Opens (and authorizes) the file first — failed downloads are not tracked.
    const stream = await sendOwnedBucketFile(event, resultDxfBucket, fileName, {
        attachment: true,
    });

    await trackEvent(event, "download_nested_result_dxf_file", {
        fileName: fileName,
    })

    return stream;
});
