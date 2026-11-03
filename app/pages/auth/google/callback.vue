<template>
    <AuthProgress />
</template>

<script setup>
import { serverErrorData } from '~/utils/serverErrorData'

definePageMeta({
    layout: "doc",
});
const router = useRouter()
const route = useRoute();

onMounted(async () => {
    // The PKCE flow returns the authorization code as a query parameter.
    const code = route.query.code;

    if (!code) {
        // No code present — likely an error redirect from Google.
        const err = route.query.error || "no_code";
        router.push({ path: "/", query: { auth_error: err } });
        return;
    }

    try {
        await $fetch(API_ROUTES.LOGIN('google'), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ code, state: route.query.state || '' }),
        });
        router.push({ path: '/home' });
    } catch (err) {
        // Adresse d'un compte e-mail + mot de passe : réessayer ne changerait
        // rien, la page d'accueil le dit et propose « mot de passe oublié ».
        const taken = serverErrorData(err).code === "email_taken_local";
        router.push({ path: "/", query: { auth_error: taken ? "email_taken_local" : "exchange_failed" } });
    }
});
</script>
