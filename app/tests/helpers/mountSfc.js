// Monte un vrai composant .vue dans Node, sans navigateur ni dépendance de test :
// le gabarit et le <script setup> sont compilés par Vue, puis rendus dans un
// arbre de nœuds minimal. Un test lit donc ce qui est RÉELLEMENT affiché pour un
// état donné, et peut cliquer, là où une lecture du fichier source ne dit rien
// de ce qui est atteint. Ni CSS ni mise en page : pas de mesure de pixels ici.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const AsyncFunction = (async () => {}).constructor

// Fonctions que Nuxt importe tout seul dans les composants.
const { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, unref, useSlots, watch } = Vue
const VUE_AUTO_IMPORTS = { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, unref, useSlots, watch }

function importsToConsts(code) {
    return code.replace(/^import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (_, clause, spec) => {
        const named = clause.match(/\{[\s\S]*\}/)?.[0]
        const defaultName = clause.split(/[,{]/)[0].trim()
        const parts = []
        if (defaultName) parts.push(`const ${defaultName} = (await __import(${JSON.stringify(spec)})).default;`)
        if (named) parts.push(`const ${named.replace(/\s+as\s+/g, ': ')} = await __import(${JSON.stringify(spec)});`)
        return parts.join(' ')
    })
}

async function loadSfc(file, env) {
    const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file, sourceMap: false })
    const { content } = compileScript(descriptor, { id: 'test', inlineTemplate: true, genDefaultAs: '__sfc__' })
    const body = importsToConsts(content)
        .replaceAll('import.meta.client', 'true')
        .replaceAll('import.meta.server', 'false')
    const load = (spec) => {
        if (spec === 'vue') return Vue
        if (env.modules[spec]) return env.modules[spec]
        if (spec.endsWith('.vue')) {
            return loadSfc(resolve(dirname(file), spec), env).then((component) => ({ default: component }))
        }
        return import(/* @vite-ignore */ spec)
    }
    const names = Object.keys(env.globals)
    // Le bloc laisse un `const` du composant masquer un nom de `env.globals`.
    const run = new AsyncFunction('__import', ...names, `{\n${body}\nreturn __sfc__\n}`)
    return run(load, ...names.map((name) => env.globals[name]))
}

function makeNode(kind, fields = {}) {
    return { kind, parent: null, children: [], props: {}, text: '', calls: [], ...fields,
        addEventListener() {},
        focus(options) { this.calls.push(['focus', options]) },
        scrollIntoView(options) { this.calls.push(['scrollIntoView', options]) } }
}

const detach = (node) => {
    const siblings = node.parent?.children
    if (siblings) siblings.splice(siblings.indexOf(node), 1)
    node.parent = null
}

const nodeOps = {
    createElement: (tag) => makeNode('element', { tag }),
    createText: (text) => makeNode('text', { text }),
    createComment: (text) => makeNode('comment', { text }),
    setText(node, text) { node.text = text },
    setElementText(node, text) {
        node.children = text ? [makeNode('text', { text, parent: node })] : []
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
        const siblings = node.parent?.children
        return siblings ? siblings[siblings.indexOf(node) + 1] ?? null : null
    },
    insert(child, parent, anchor) {
        detach(child)
        const at = anchor ? parent.children.indexOf(anchor) : parent.children.length
        parent.children.splice(at, 0, child)
        child.parent = parent
    },
    remove: detach,
    patchProp(node, key, _previous, next) { node.props[key] = next },
}

function walk(node, visit) {
    visit(node)
    for (const child of node.children) walk(child, visit)
}

const flush = async () => {
    for (let i = 0; i < 4; i++) await new Promise((done) => setTimeout(done, 0))
}

/**
 * @param {string} file chemin absolu du .vue
 * @param {object} o
 * @param {object} [o.props] props du composant
 * @param {object} [o.globals] auto-imports Nuxt et globaux lus par le composant
 * @param {object} [o.modules] modules remplacés, par spécificateur d'import
 * @param {object} [o.components] composants globaux (auto-import) : un composant,
 *   ou le chemin absolu d'un .vue à compiler
 */
export async function mountSfc(file, { props = {}, globals = {}, modules = {}, components = {} } = {}) {
    const env = { modules, globals: { ...VUE_AUTO_IMPORTS, ...globals } }
    const component = await loadSfc(file, env)
    const root = makeNode('element', { tag: 'root' })
    const app = Vue.createRenderer(nodeOps).createApp({
        render: () => Vue.h(Vue.Suspense, null, { default: () => Vue.h(component, props) }),
    })
    for (const [name, value] of Object.entries(components)) {
        app.component(name, typeof value === 'string' ? await loadSfc(value, env) : value)
    }
    app.mount(root)
    await flush()

    const all = () => {
        const out = []
        walk(root, (node) => { if (node.kind === 'element') out.push(node) })
        return out
    }
    const textOf = (from) => {
        let out = ''
        walk(from, (node) => { if (node.kind === 'text') out += `${node.text} ` })
        return out.replace(/\s+/g, ' ').trim()
    }
    return {
        text: () => textOf(root),
        textOf,
        byTestId: (id) => all().find((node) => node.props['data-testid'] === id) ?? null,
        byClass: (name) => all().filter((node) => String(node.props.class ?? '').split(/\s+/).includes(name)),
        buttons: () => all().filter((node) => node.tag === 'button'),
        buttonNamed: (label) => all().find((node) => node.tag === 'button' && textOf(node) === label) ?? null,
        async click(node) {
            for (const handler of [node.props.onClick].flat()) await handler?.({ preventDefault() {} })
            await flush()
        },
    }
}

/** Composant qui rend seulement ce qu'on lui glisse (ex. un badge). */
export const passthrough = { setup: (_, { slots }) => () => Vue.h('span', null, slots.default?.()) }
