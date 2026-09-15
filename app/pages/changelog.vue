<template>
    <div class="changelog">
        <header class="changelog__header">
            <h1 class="changelog__title">Changelog</h1>
            <p class="changelog__subtitle">
                What changed in NestorCut, newest first.
            </p>
        </header>

        <!-- Lot J11-b : le journal UNIQUE (CHANGELOG.md, la seule source) —
             la version courante en tête, la langue de l'utilisateur. -->
        <p class="changelog__current" data-testid="changelog-current">
            {{ t('changelog.current') }} <strong>V{{ fullVersion }}</strong>
        </p>
        <article
            v-for="(post, postIndex) in versions"
            :key="post.title"
            class="changelog__entry entry"
        >
            <h2 class="entry__title">{{ post.title }}</h2>
            <ul class="entry__list">
                <li
                    v-for="(item, itemIndex) in bulletsOf(post)"
                    :key="itemIndex"
                    class="entry__item"
                >
                    {{ item }}
                </li>
            </ul>
        </article>
    </div>
</template>

<script setup>
import { useAppChangelog } from '~/utils/changelogParser';

definePageMeta({
    layout: "doc",
    // 3.1.6 : publique, mais reconnaît la session (nav cohérente).
    middleware: "auth-optional",
});

const versions = useAppChangelog();
const { t } = useLocale();
const fullVersion = String(useRuntimeConfig().public.appVersion || '');
const bulletsOf = (post) => {
    const { locale } = useLocale();
    const lang = unref(locale) === 'fr' ? 'fr' : 'en';
    return post[lang]?.length ? post[lang] : post.en;
};


onMounted(() => {
    trackEvent('page_view', { page: 'changelog' })
});
</script>

<style lang="scss" scoped>
.changelog {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px;

    &__header {
        text-align: center;
        margin-bottom: 40px;
    }

    &__title {
        color: var(--accent-primary);
        font-size: var(--fs-32);
        font-weight: 700;

        @media (min-width: 567px) {
            font-size: var(--fs-32);
        }
    }

    &__subtitle {
        margin-top: 12px;
        color: var(--label-secondary);
    }
}

.entry {
    border: 1px solid var(--separator-secondary);
    border-radius: var(--radius-l);
    padding: 24px;
    background-color: var(--fill-tertiary);

    &:not(:last-child) {
        margin-bottom: 24px;
    }

    &__header {
        margin-bottom: 16px;
    }

    &__date {
        display: inline-block;
        padding: 4px 12px;
        border-radius: var(--radius-s);
        background-color: var(--fill-secondary);
        color: var(--accent-primary);
        font-size: var(--fs-12);
        font-weight: 700;
        letter-spacing: 0.03em;
    }

    &__title {
        margin-top: 12px;
        color: var(--label-primary);
        font-size: var(--fs-18);
        font-weight: 700;
    }

    &__section {
        &:not(:last-child) {
            margin-bottom: 16px;
        }
    }

    &__section-title {
        color: var(--label-primary);
        font-size: var(--fs-14);
        font-weight: 700;
        margin-bottom: 8px;
    }

    &__list {
        padding-left: 4px;
    }

    &__item {
        position: relative;
        padding-left: 18px;
        color: var(--label-secondary);
        font-size: var(--fs-14);
        line-height: 1.6;

        &:not(:last-child) {
            margin-bottom: 6px;
        }

        &::before {
            content: '';
            position: absolute;
            left: 0;
            top: 9px;
            width: 6px;
            height: 6px;
            border-radius: var(--radius-s);
            background-color: var(--accent-primary);
        }
    }

    &__text {
        color: var(--label-secondary);
        font-size: var(--fs-14);
        line-height: 1.6;
    }
}
</style>
