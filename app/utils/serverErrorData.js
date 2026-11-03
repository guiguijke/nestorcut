// Corps d'erreur Nitro : { error, statusCode, statusMessage, message, data }
// où `data` porte le code stable de createError ({ code, field, … }). $fetch
// (ofetch) range ce CORPS dans err.data : le code est donc en err.data.data.
// Lire err.data.code tombait toujours à vide — la page de connexion affichait
// « Something went wrong » pour un mauvais mot de passe (constat 2026-11-03).
// La forme plate reste lue en repli.
export function serverErrorData(err) {
    return err?.data?.data ?? err?.data ?? {}
}
