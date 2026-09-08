<template>
    <!-- U0 : carte à UN niveau — jamais imbriquée (l'audit comptait des
         cartes dans des cartes). Slots header/body/footer. -->
    <section class="ui-card">
        <header v-if="$slots.header" class="ui-card__header">
            <slot name="header" />
        </header>
        <div class="ui-card__body">
            <slot />
        </div>
        <footer v-if="$slots.footer" class="ui-card__footer">
            <slot name="footer" />
        </footer>
    </section>
</template>

<style lang="scss" scoped>
.ui-card {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-s);
    overflow: hidden;

    &__header {
        padding: var(--sp-3) var(--sp-4);
        border-bottom: 1px solid var(--border);
        font-size: var(--fs-13);
        font-weight: 700;
        color: var(--text-2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    &__body {
        padding: var(--sp-4);
        flex: 1;
    }
    &__footer {
        padding: var(--sp-3) var(--sp-4);
        border-top: 1px solid var(--border);
        display: flex;
        gap: var(--sp-2);
    }
}
</style>
