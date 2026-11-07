<template>
    <div class="main">
        <MainHeader
            :theme="themeType.secondary"
            class="main__header"
        />
        <main class="main__content content">
            <slot />
        </main>
        <Footer />
        <!-- /plans (public, connecté ou non) : le clic d'une carte payante ouvre
             la fenêtre d'abonnement sans quitter la page. Le contenu n'est
             rendu qu'à l'ouverture. -->
        <BuyCreditsDialog v-model:isModalOpen="buyCreditsDialog" />
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants';
const buyCreditsDialog = useBuyCreditsDialog();
</script>
<style lang="scss" scoped>
.main {
    background-color: var(--background-primary);
    flex-direction: column;
    display: flex;
    min-height: 100vh;

    /* M3-ter : l'en-tête déconnecté prend TOUTE la largeur, comme
       l'en-tête connecté (le menu complet demande jusqu'à 1500 px selon
       la langue) ; le contenu des pages garde sa largeur de lecture. */
    &__content {
        flex-grow: 1;
        margin: 20px auto;
        max-width: 1300px;
        width: 100%;

        @media (min-width: 567px) {
            margin-top: 40px;
            margin-bottom: 40px;
        }
    }
    &__line {
        position: relative;
        z-index: 2;
    }
}
.content {
    padding-left: 10px;
    padding-right: 10px;
}
</style>
