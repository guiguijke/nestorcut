import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

describe('audits automatiques — dependabot', () => {
    const cfg = YAML.parse(read('.github/dependabot.yml'))
    const entries = cfg.updates

    it('version 2 du schéma', () => {
        expect(cfg.version).toBe(2)
    })

    it('npm à la racine, hebdomadaire, 5 PR au plus', () => {
        const npm = entries.find((e) => e['package-ecosystem'] === 'npm')
        expect(npm.directory).toBe('/')
        expect(npm.schedule.interval).toBe('weekly')
        expect(npm['open-pull-requests-limit']).toBeLessThanOrEqual(5)
    })

    it('cargo pour les deux workspaces Rust', () => {
        const dirs = entries.filter((e) => e['package-ecosystem'] === 'cargo').map((e) => e.directory).sort()
        expect(dirs).toEqual(['/workers/geometry', '/workers/nesting/engine'])
    })

    it('pip pour nesting et fileprocessing', () => {
        const dirs = entries.filter((e) => e['package-ecosystem'] === 'pip').map((e) => e.directory).sort()
        expect(dirs).toEqual(['/workers/fileprocessing', '/workers/nesting'])
    })

    it('github-actions à la racine', () => {
        const gha = entries.find((e) => e['package-ecosystem'] === 'github-actions')
        expect(gha.directory).toBe('/')
    })

    it('chaque écosystème : au plus 5 PR ouvertes, hebdomadaire', () => {
        for (const e of entries) {
            expect(e.schedule.interval, e['package-ecosystem']).toBe('weekly')
            expect(e['open-pull-requests-limit'], e['package-ecosystem']).toBeLessThanOrEqual(5)
        }
    })
})

describe('audits automatiques — workflow audit.yml', () => {
    const wf = YAML.parse(read('.github/workflows/audit.yml'))
    // yaml 1.1 lit la clé « on » comme booléen dans certains outils : on accepte les deux.
    const triggers = wf.on ?? wf[true]

    it('déclenché chaque lundi et à la main, jamais sur push ni pull_request', () => {
        expect(Object.keys(triggers).sort()).toEqual(['schedule', 'workflow_dispatch'])
        const crons = triggers.schedule.map((s) => s.cron)
        expect(crons).toHaveLength(1)
        expect(crons[0].split(/\s+/)[4]).toBe('1') // jour de la semaine : lundi
    })

    it('un job npm audit --omit=dev et un job cargo audit', () => {
        const jobs = Object.values(wf.jobs)
        const runs = jobs.flatMap((j) => j.steps.map((s) => s.run || ''))
        expect(runs.some((r) => r.includes('npm audit --omit=dev'))).toBe(true)
        expect(runs.some((r) => r.includes('cargo install --locked cargo-audit'))).toBe(true)
        const cargoDirs = jobs.flatMap((j) => j.steps.map((s) => s['working-directory']).filter(Boolean))
        expect(cargoDirs).toContain('workers/nesting/engine')
        expect(cargoDirs).toContain('workers/geometry')
    })

    it('chaque étape est en continue-on-error: true', () => {
        for (const [name, job] of Object.entries(wf.jobs)) {
            for (const step of job.steps) {
                expect(step['continue-on-error'], `${name} / ${step.name ?? step.uses ?? step.run}`).toBe(true)
            }
        }
    })
})
