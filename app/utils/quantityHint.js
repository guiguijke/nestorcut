// Aide « Quantité » : vraie quand au moins une pièce est prête et que
// TOUTES les pièces prêtes sont à 1 — le cas où l'artisan a probablement
// oublié de régler ses quantités et obtiendrait une tôle presque vide.
// Une fiche en cours de traitement ou en erreur ne compte pas.
export function allQuantitiesAtOne(files, doneStatus) {
    const ready = (files || []).filter((f) => f && f.processingStatus === doneStatus)
    if (!ready.length) return false
    return ready.every((f) => Number(f.count) === 1)
}
