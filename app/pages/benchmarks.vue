<template>
    <div class="bench">
        <h1 class="bench__title">{{ t('bench.title') }}</h1>
        <p class="bench__lead">{{ t('bench.lead') }}</p>

        <!-- Conditions datées : machine + version exacte des chiffres. -->
        <p class="bench__meta">
            {{ t('bench.conditions') }} :
            {{ field(BENCHMARKS.meta.machine) }} —
            {{ t('bench.dockerImages') }}
            <code>{{ BENCHMARKS.meta.version }}</code>,
            {{ BENCHMARKS.meta.runDate }}.
            <template v-if="deployedSha">
                {{ t('bench.deployedImage') }}
                <code>{{ deployedSha.slice(0, 7) }}</code>
            </template>
        </p>

        <section class="bench__section">
            <h2>{{ t('bench.method') }}</h2>
            <p class="bench__text">{{ field(BENCHMARKS.meta.method) }}</p>
        </section>

        <section class="bench__section">
            <h2>{{ t('bench.results') }}</h2>
            <div class="bench__tablewrap">
                <table class="bench__table">
                    <thead>
                        <tr>
                            <th>{{ t('bench.col.case') }}</th>
                            <th>{{ t('bench.col.geometry') }}</th>
                            <th>{{ t('bench.col.sheets') }}</th>
                            <th>{{ t('bench.col.spacing') }}</th>
                            <th>{{ t('bench.col.parts') }}</th>
                            <th>{{ t('bench.col.density') }}</th>
                            <th>{{ t('bench.col.physics') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="c in BENCHMARKS.cases" :key="c.id">
                            <td class="bench__case">T-{{ c.id }}</td>
                            <td class="bench__geom">{{ field(c.geometry) }}</td>
                            <td>{{ c.sheets }}</td>
                            <td>{{ fmtSp(c.spaceMm) }}</td>
                            <td>
                                <template v-if="c.verdict === 'refused'">{{ t('bench.refusedBeforeCompute') }}</template>
                                <template v-else>{{ c.placed }}/{{ c.requested }}</template>
                            </td>
                            <td class="bench__density">
                                <template v-if="c.densityPct != null">{{ fmtPct(c.densityPct) }}</template>
                                <template v-else>—</template>
                            </td>
                            <td>
                                <span v-if="c.verdict === 'ok'" class="bench__badge bench__badge--ok">
                                    {{ t('bench.verified') }}
                                </span>
                                <span v-else-if="c.verdict === 'partial'" class="bench__badge bench__badge--partial">
                                    {{ tp('bench.partial', c.requested - c.placed) }}
                                </span>
                                <span v-else-if="c.verdict === 'refused'" class="bench__badge bench__badge--refused">
                                    {{ t('bench.honestRefusal') }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="bench__note">{{ t('bench.note') }}</p>
        </section>

        <section class="bench__section">
            <h2>{{ t('bench.robustness') }}</h2>
            <p class="bench__text">{{ field(BENCHMARKS.robustness) }}</p>
            <p class="bench__text">{{ field(BENCHMARKS.honesty) }}</p>
        </section>
    </div>
</template>

<script setup>
import { BENCHMARKS } from '~~/data/benchmarks'

// 3.9 : page publique — reconnaît la session (nav cohérente) sans forcer
// la connexion.
definePageMeta({
    layout: 'doc',
    middleware: 'auth-optional',
})

const { locale, t, tp, fmtPercent } = useLocale()
// AI5 : hash du commit qui a build l'image (injecté au build par le
// workflow). En dev local sans build-arg : repli silencieux.
const deployedSha = useRuntimeConfig().public.gitCommitSha || ''
// Champ descriptif {en, fr, pt, it, de, es} : langue courante, repli anglais.
const field = (obj) => obj[locale.value] ?? obj.en
// Virgule décimale partout sauf en anglais.
const fmtSp = (mm) => (locale.value === 'en' ? `${mm} mm` : `${String(mm).replace('.', ',')} mm`)
const fmtPct = (v) => fmtPercent(v)

useHead(() => ({
    title: t('bench.metaTitle'),
    meta: [{ name: 'description', content: t('bench.metaDescription') }],
}))
</script>

<style lang="scss" scoped>
.bench {
    max-width: 980px;

    &__title {
        font-size: var(--fs-22);
        margin-bottom: 6px;
    }

    &__lead {
        font-size: var(--fs-14);
        color: var(--label-secondary);
        margin-bottom: 8px;
    }

    &__meta {
        font-size: var(--fs-13);
        color: var(--label-tertiary);
        margin-bottom: 18px;

        code {
            background-color: var(--fill-tertiary);
            border-radius: var(--radius);
            padding: 1px 5px;
            font-size: var(--fs-12);
        }
    }

    &__section {
        margin-bottom: 26px;

        h2 {
            font-size: var(--fs-18);
            margin-bottom: 8px;
        }
    }

    &__text {
        font-size: var(--fs-14);
        line-height: 1.6;
        color: var(--label-secondary);
    }

    &__tablewrap {
        overflow-x: auto;
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-13);
        min-width: 760px;

        th,
        td {
            text-align: left;
            padding: 9px 12px;
            border-bottom: 1px solid var(--separator-secondary);
            vertical-align: top;
        }

        th {
            font-size: var(--fs-12);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--label-tertiary);
            background-color: var(--fill-tertiary);
        }

        tbody tr:last-child td {
            border-bottom: none;
        }
    }

    &__case {
        font-weight: 700;
        white-space: nowrap;
    }

    &__geom {
        color: var(--label-secondary);
        max-width: 320px;
    }

    &__density {
        font-weight: 700;
        white-space: nowrap;
    }

    &__badge {
        display: inline-block;
        padding: 2px 9px;
        border-radius: var(--radius-s);
        font-size: var(--fs-12);
        font-weight: 700;
        white-space: nowrap;

        &--ok {
            color: var(--accent-primary);
            background-color: color-mix(in srgb, var(--accent-primary) 10%, transparent);
        }

        &--partial {
            color: var(--warn);
            background-color: color-mix(in srgb, var(--warn) 12%, transparent);
        }

        &--refused {
            color: var(--label-secondary);
            background-color: var(--fill-tertiary);
        }
    }

    &__note {
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        margin-top: 8px;
    }
}
</style>
