<template>
    <NuxtLayout>
        <!-- Announces page title changes to screen readers on SPA navigation -->
        <NuxtRouteAnnouncer />
        <NuxtPage />
        <!-- U3 passe 2 : useToast() n'avait aucun rendu monte — la copie de
             l'identifiant de resultat ne montrait rien. Monte une fois,
             au-dessus de tout. -->
        <UiToast />
    </NuxtLayout>
</template>

<script setup>
// L0-bis (plan des langues) : la LANGUE DU DOCUMENT suit la locale,
// réactivement — l'attribut figé « fr » de nuxt.config déclarait du
// français même sur une page entièrement anglaise, et Google lit cet
// attribut sur les pages publiques. Le ref calculé traverse useHead :
// le rendu serveur porte la locale de la requête, le commutateur
// rebascule l'attribut sans rechargement.
// Lot M1 : le TITRE suit la langue aussi (meta.title du dictionnaire),
// et pt devient pt-BR comme le site — les autres gardent leur code
// court (PAS intlTag(), qui rendrait les formes régionales écartées).
const { locale, t } = useLocale()
const langTag = computed(() => (locale.value === 'pt' ? 'pt-BR' : locale.value))
useHead({
    htmlAttrs: { lang: langTag },
    title: computed(() => t('meta.title')),
})
</script>
