<template>
    <div class="main">
        <MainHeader class="main__header" />
        <main class="main__content content">
            <slot />
        </main>
        <Footer />
    </div>
</template>

<style lang="scss" scoped>
.main {
    background-color: var(--background-primary);
    flex-direction: column;
    display: flex;
    min-height: 100vh;

    /* M3-ter : en-tête pleine largeur, aligne sur l en-tête déconnecté
       (les deux logos à 16 px du bord) ; le contenu garde sa largeur. */
    &__content {
        flex-grow: 1;
        margin: 40px auto;
        max-width: 1300px;
        width: 100%;
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