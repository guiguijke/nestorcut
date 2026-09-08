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
