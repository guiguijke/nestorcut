/**
 * Chemin du clic « Télécharger le PDF » : PUR (aucun DOM, aucun état global), testé.
 * La politique d'offre reste la même que pour « Copier le rapport » et « Exporter
 * CSV » ; seules les actions concrètes sont passées en paramètres.
 *
 * - PDF de base : toujours fabriqué, aucun verrou.
 * - Avancé, état relu AU CLIC :
 *   `'disabled'` (abonnements coupés) : rien (ni fenêtre d'abonnement, ni PDF) ;
 *   `'enabled'` : fabriqué ;
 *   `'locked'` : chemin verrouillé (`lockedClick` : offre relue, puis fenêtre
 *   d'abonnement). Si l'offre est devenue ouverte, RIEN n'est fabriqué : la fenêtre
 *   reste ouverte pour que l'utilisateur voie et remplisse les champs avancés ;
 *   sinon la fenêtre du PDF est fermée AVANT l'ouverture de l'abonnement (sinon
 *   celui-ci s'afficherait derrière).
 *
 * @param {object} p
 * @param {boolean} p.wantAdvanced
 * @param {() => 'enabled'|'locked'|'disabled'} p.readState Lit l'état courant
 * @param {(onProceed: () => void, beforePaywall: () => void) => Promise<void>} p.lockedClick
 *   Chemin verrouillé : appelle `onProceed` si l'offre relue est ouverte, sinon
 *   `beforePaywall` puis ouvre l'abonnement ; ne fait rien si le contexte est périmé
 * @param {(advanced: boolean) => Promise<void>} p.make Fabrique le PDF
 * @param {() => void} p.closeDialog Ferme la fenêtre du PDF
 * @returns {Promise<'base'|'advanced'|'disabled'|'paywall'|'unlocked'|'none'>}
 */
export async function reportPdfClick({ wantAdvanced, readState, lockedClick, make, closeDialog }) {
    if (wantAdvanced !== true) {
        await make(false)
        return 'base'
    }
    const state = readState()
    if (state === 'disabled') return 'disabled'
    if (state === 'enabled') {
        await make(true)
        return 'advanced'
    }
    let outcome = 'none'
    await lockedClick(
        () => {
            outcome = 'unlocked'
        },
        () => {
            outcome = 'paywall'
            closeDialog()
        },
    )
    return outcome
}
