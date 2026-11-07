export const useResultDialog = () => {
    return useState("resultDialog", () => false);
};
// Set by the "Nesting report" button on a result card: the result modal
// scrolls straight to the quoting report when it opens.
export const useResultScrollToReport = () => {
    return useState("resultScrollToReport", () => false);
};
export const useFileDialog = () => {
    return useState("fileDialog", () => false);
};
export const useFullScreen = () => {
    return useState("isFullScreen", () => false);
}
export const useSupportDialog = () => {
    return useState("supportDialog", () => false);
};
export const useBuyCreditsDialog = () => {
    return useState("buyCreditsDialog", () => false);
};
export const useLoginDialog = () => {
    return useState("loginDialog", () => false);
};
export const useVaultUnlockDialog = () => {
    return useState("vaultUnlockDialog", () => false);
};
export const useVaultMenuOpen = () => {
    return useState("vaultMenuOpen", () => false);
};
/** D13 : contexte de la fenêtre d'abonnement — null ou
 * { source: 'locked_sheets'|'quota'|'export'|'turbo'|'plans',
 *   lockedSheets?: { total: number, cap: number, resultSlug: string, projectSlug: string|null } }
 * Vidé par BuyCreditsDialog à la fermeture. Ne JAMAIS l'envoyer au serveur ni au suivi. */
export const useBuyCreditsContext = () => {
    return useState("buyCreditsContext", () => null);
};
/** Ouvreur à appeler DANS le setup (capture les deux états), puis
 * `open(context)` dans un gestionnaire de clic. */
export const useBuyCreditsOpener = () => {
    const dialog = useBuyCreditsDialog();
    const context = useBuyCreditsContext();
    return (value = null) => {
        context.value = value;
        dialog.value = true;
    };
};
/** D11 : action de capacité demandée par la fenêtre de résultat, appliquée
 * par [slug].vue (seule à écrire les réglages) si projectSlug === pageSlug —
 * null ou
 *   { projectSlug: string, action: 'add_sheets', nextSheets: object[], at: number }
 *   { projectSlug: string, action: 'reduce_spacing', mm: number, at: number } */
export const useCapacityActionRequest = () => {
    return useState("capacityActionRequest", () => null);
};
/** d10 : résultat à rouvrir après le retour de Checkout —
 * null ou { resultSlug: string, projectSlug: string|null } ; consommé par UserResults. */
export const useCheckoutReopenTarget = () => {
    return useState("checkoutReopenTarget", () => null);
};
/** D17 : 'checking' pendant la vérification d'un retour de Checkout réussi
 * (écrit par useCheckoutReturn), 'idle' sinon. Lu par les boutons
 * « Débloquer » (désactivés, libellé sub.return.activating). */
export const useCheckoutReturnState = () => {
    return useState("checkoutReturnState", () => "idle");
};
