<template>
    <div class="avatar__wrapper">
        <component
            :is="avatarTag"
            v-bind="avatarHref"
            class="avatar"
        >
            <img
                :class="avatarClasses"
                :src="user.avatar"
                :alt="user.name"
                class="avatar__img"
            />
        </component>
    </div>
</template>
<script setup>
import { NuxtLink } from '#components';
import { defaultSizeType, sizeType } from "~~/constants/size.constants";

const { size } = defineProps({
    size: {
        type: String,
        default: defaultSizeType,
    },
}) 

const route = useRoute()

const avatarClasses = computed(() => ({
    [`avatar__img--size-${unref(size)}`]: Boolean(unref(size))
}))
const isProfilePage = computed(() => {
    return route.path === '/profile'
})
const avatarTag = computed(() => {
    return unref(isProfilePage) ? 'div' : NuxtLink
})
const avatarHref = computed(() => {
    return !unref(isProfilePage) ? { to: '/profile' } : {}
})

const { getters } = authStore;
const user = computed(() => getters.user);

onBeforeMount(() => {
    if (typeof window !== 'undefined' && typeof window.clarity === 'function') {
        window.clarity("identify", unref(user).id, "", "", unref(user).name);
    }
});

</script>
<style lang="scss" scoped>
.avatar {
    &__img {
        border-radius: var(--radius-full);

        &--size-s {
            width: 40px;
            height: 40px;
        }
        /* U2-ter : 64 px sur le profil (l'avatar géant de 140 px n'a plus
           sa place dans la grille pleine largeur). */
        &--size-m {
            width: 64px;
            height: 64px;
        }
    }

    &__wrapper {
        display: flex;
        align-items: center;
        gap: 16px;
    }
}
</style>