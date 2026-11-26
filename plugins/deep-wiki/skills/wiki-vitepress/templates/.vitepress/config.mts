import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// The scaffold always copies scripts/ next to .vitepress/, so the site, the checker, and the
// generators share one frontmatter and catalogue reader.
import {
  NEVER_PAGE_DIRS,
  ONBOARDING_ORDER,
  ROOT_SKIP_DIRS,
  createFenceScanner,
  inferHost,
  loadCatalogue,
  loadState,
  parseFrontmatter,
  readText,
  walkCatalogue,
} from '../scripts/lib.mjs'

// ---------------------------------------------------------------------------
// Fill these in when scaffolding (see the wiki-vitepress skill).
// ---------------------------------------------------------------------------
const SITE_TITLE = '__SITE_TITLE__'
const SITE_DESCRIPTION = '__SITE_DESCRIPTION__'
// '/' for a user/org Pages site or a custom domain; '/<repo-name>/' for a project Pages site.
const BASE = '__BASE__'
// Repository web URL (https, no .git) or '' when the repo is local-only.
const REPO_URL = '__REPO_URL__'
// Default branch, used for "Edit this page" links on GitHub/GitLab.
const BRANCH = '__BRANCH__'
// Path of this wiki folder relative to the repo root.
const WIKI_DIR = 'wiki'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** VitePress needs a leading and a trailing slash: 'repo' and '/repo' both become '/repo/'. */
function normalizeBase(value: string): string {
  const inner = value.trim().replace(/^\/+|\/+$/g, '')
  return inner ? `/${inner}/` : '/'
}
const base = normalizeBase(BASE)

/** `host` comes from wiki/.deep-wiki.json when the run recorded it; otherwise infer it from the URL. */
function detectHost(): string {
  let recorded: unknown
  try {
    recorded = (loadState(root) as { host?: string }).host
  } catch {
    // Unreadable state file: infer from the URL.
  }
  if (typeof recorded === 'string' && recorded) return recorded
  // Same rule as the scripts: a host that is not recognised is treated as `local`.
  return inferHost(REPO_URL)
}
const host = detectHost()

/** The page title: frontmatter, then the first H1 outside code fences, then the file name. */
function titleOf(file: string): string {
  const text: string = readText(file)
  const fm = parseFrontmatter(text)
  const title = fm.data?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const fenceAt = createFenceScanner()
  for (const line of text.split(/\r?\n/).slice(fm.lineCount)) {
    if (fenceAt(line).kind !== 'text') continue
    const h1 = line.match(/^#\s+(.+?)\s*#*\s*$/)
    if (h1) return h1[1]
  }
  return path.basename(file, '.md')
}

// Sidebar labels longer than this are a description, not a name: fall back to the folder name.
const MAX_LABEL = 60

type CatalogueNode = { name?: string; path?: string }

/** Section names and reading order from catalogue.json, when the wiki has one. */
function readCatalogue() {
  const names = new Map<string, string>()
  const order = new Map<string, number>()
  try {
    let n = 0
    walkCatalogue(loadCatalogue(root)?.items, (node: CatalogueNode, ctx: { dir: string | null }) => {
      if (ctx.dir) {
        if (typeof node.name === 'string' && node.name.trim()) names.set(ctx.dir, node.name.trim())
        order.set(ctx.dir, n++)
      } else if (typeof node.path === 'string') {
        order.set(node.path.replace(/\\/g, '/'), n++)
      }
    })
  } catch {
    // No catalogue, or an unreadable one (single-page and crisp runs): titles and file names decide.
  }
  return { names, order }
}

const catalogue = readCatalogue()

function titleCase(dir: string): string {
  return path
    .basename(dir)
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Catalogue name, then a short index.md title, then "02-getting-started" -> "Getting Started". */
function sectionName(dir: string): string {
  const named = catalogue.names.get(dir)
  if (named && named.length <= MAX_LABEL) return named
  const index = path.join(root, dir, 'index.md')
  if (fs.existsSync(index)) {
    const title = titleOf(index)
    if (title.length <= MAX_LABEL && !/undefined$/.test(title)) return title
  }
  return titleCase(dir)
}

type SidebarItem = { text: string; link?: string; collapsed?: boolean; items?: SidebarItem[] }

// Not pages: excluded from the site at any depth (see srcExclude) and never listed.
const NOT_PAGES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md'])
// Folders that hold no pages, as listPages() in scripts/lib.mjs defines them: `public` and
// `scripts` at the wiki root only; `dist` and `node_modules` at any depth, because VitePress
// never builds those.

/** The sidebar renders labels as HTML, so `List<T>` would lose its `<T>`. */
const label = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const isPage = (name: string) => name.endsWith('.md') && !NOT_PAGES.has(name)
const isContentDir = (dir: string, name: string) =>
  !name.startsWith('.') && !NEVER_PAGE_DIRS.has(name) && !(dir === '' && ROOT_SKIP_DIRS.has(name))

/** Sort names inside `dir`: catalogue order, then the given fixed order, then alphabetical. */
function ordered(dir: string, names: string[], fixed: readonly string[] = []): string[] {
  const rank = (name: string): [number, number] => {
    const inCatalogue = catalogue.order.get(dir ? `${dir}/${name}` : name)
    if (inCatalogue !== undefined) return [0, inCatalogue]
    const inFixed = fixed.indexOf(name)
    return inFixed >= 0 ? [1, inFixed] : [2, 0]
  }
  return [...names].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra[0] - rb[0] || ra[1] - rb[1] || a.localeCompare(b)
  })
}

/**
 * Pages and sub-folders of `dir` in reading order, recursively, so a catalogue up to four levels
 * deep is fully reachable. A folder's index.md is its group heading, not an item.
 */
function itemsIn(dir: string, fixed: readonly string[] = []): SidebarItem[] {
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  const names = entries
    .filter((e) => (e.isFile() ? isPage(e.name) && e.name !== 'index.md' : e.isDirectory() && isContentDir(dir, e.name)))
    .map((e) => e.name)
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name))
  const items: SidebarItem[] = []
  for (const name of ordered(dir, names, fixed)) {
    const rel = dir ? `${dir}/${name}` : name
    if (dirs.has(name)) {
      const sub = group(rel, sectionName(rel), true)
      if (sub) items.push(sub)
    } else {
      items.push({ text: label(titleOf(path.join(root, rel))), link: `/${rel.replace(/\.md$/, '')}` })
    }
  }
  return items
}

/** A collapsible group for one folder, or null when the folder has no pages at all. */
function group(dir: string, text: string, collapsed: boolean, fixed: readonly string[] = []): SidebarItem | null {
  const items = itemsIn(dir, fixed)
  const hasIndex = fs.existsSync(path.join(root, dir, 'index.md'))
  if (!items.length && !hasIndex) return null
  return { text: label(text), collapsed, items, ...(hasIndex ? { link: `/${dir}/` } : {}) }
}

/**
 * Home, Onboarding (expanded), the numbered sections (first three expanded), then anything else
 * the wiki holds: other folders such as research/, and root pages such as changelog.md.
 */
function buildSidebar(): SidebarItem[] {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  const folders = entries.filter((e) => e.isDirectory() && isContentDir('', e.name)).map((e) => e.name)
  const numbered = folders.filter((d) => /^\d+-/.test(d)).sort()
  const others = folders.filter((d) => !/^\d+-/.test(d) && d !== 'onboarding').sort()
  const rootPages = entries.filter((e) => e.isFile() && isPage(e.name) && e.name !== 'index.md').map((e) => e.name)

  const groups: (SidebarItem | null)[] = []
  if (folders.includes('onboarding')) groups.push(group('onboarding', 'Onboarding', false, ONBOARDING_ORDER))
  numbered.forEach((dir, i) => groups.push(group(dir, sectionName(dir), i >= 3)))
  others.forEach((dir) => groups.push(group(dir, sectionName(dir), true)))
  if (rootPages.length) {
    const items = ordered('', rootPages).map((f) => ({ text: label(titleOf(path.join(root, f))), link: `/${f.replace(/\.md$/, '')}` }))
    groups.push({ text: 'More', collapsed: true, items })
  }
  return [{ text: 'Home', link: '/' }, ...groups.filter((g): g is SidebarItem => g !== null)]
}

function editLink() {
  if (!REPO_URL || !BRANCH) return undefined
  if (host === 'github') return { pattern: `${REPO_URL}/edit/${BRANCH}/${WIKI_DIR}/:path`, text: 'Edit this page' }
  if (host === 'gitlab') return { pattern: `${REPO_URL}/-/edit/${BRANCH}/${WIKI_DIR}/:path`, text: 'Edit this page' }
  return undefined
}

function socialLinks() {
  if (!REPO_URL) return []
  if (host === 'github') return [{ icon: 'github' as const, link: REPO_URL }]
  if (host === 'gitlab') return [{ icon: 'gitlab' as const, link: REPO_URL }]
  return []
}

const hasPage = (rel: string) => fs.existsSync(path.join(root, rel))

export default withMermaid(
  defineConfig({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    base,
    cleanUrls: true,
    lastUpdated: true,
    // A broken link between wiki pages fails the build. Exempt: localhost URLs and the
    // agent/readme files that srcExclude keeps out of the site.
    ignoreDeadLinks: [/^https?:\/\/(localhost|127\.0\.0\.1)/, /(^|\/)(AGENTS|CLAUDE|README)(\.md)?$/],
    // Agent and readme files are not pages at any depth; scripts/ (root only) holds the wiki's
    // Node tools. VitePress itself already skips every dist/ and node_modules/ folder.
    srcExclude: ['**/AGENTS.md', '**/CLAUDE.md', '**/README.md', 'scripts/**'],
    // Dark only: no light/dark toggle.
    appearance: 'force-dark',
    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
      ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
      ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
      [
        'link',
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    ],
    markdown: {
      theme: { light: 'github-dark', dark: 'github-dark' },
      lineNumbers: true,
      config(md) {
        // Vue would evaluate "{{ ... }}" inside inline code (GitHub Actions expressions,
        // template syntax) and fail the build. Fenced blocks already get v-pre.
        const inline = md.renderer.rules.code_inline!
        md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
          tokens[idx].attrSet('v-pre', '')
          return inline(tokens, idx, options, env, self)
        }
      },
    },
    vite: {
      optimizeDeps: { include: ['mermaid'] },
    },
    themeConfig: {
      logo: '/logo.svg',
      nav: [
        { text: 'Home', link: '/' },
        // Only what exists: single-page and crisp runs may not write onboarding or a changelog.
        ...(hasPage('onboarding/index.md') ? [{ text: 'Onboarding', link: '/onboarding/' }] : []),
        ...(hasPage('changelog.md') ? [{ text: 'Changelog', link: '/changelog' }] : []),
      ],
      sidebar: buildSidebar(),
      outline: { level: [2, 3] },
      search: { provider: 'local' },
      socialLinks: socialLinks(),
      editLink: editLink(),
      footer: { message: 'Generated with deep-wiki' },
    },
    mermaid: {
      // Mermaid 12 defaults to the ELK layout and the "neo" look; keep the classic dagre rendering.
      layout: 'dagre',
      look: 'classic',
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#0d1117',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        primaryColor: '#2d333b',
        primaryTextColor: '#e6edf3',
        primaryBorderColor: '#6d5dfc',
        secondaryColor: '#1c2333',
        secondaryTextColor: '#e6edf3',
        secondaryBorderColor: '#6d5dfc',
        tertiaryColor: '#161b22',
        tertiaryTextColor: '#e6edf3',
        tertiaryBorderColor: '#30363d',
        lineColor: '#8b949e',
        textColor: '#e6edf3',
        mainBkg: '#2d333b',
        nodeBkg: '#2d333b',
        nodeBorder: '#6d5dfc',
        nodeTextColor: '#e6edf3',
        clusterBkg: '#161b22',
        clusterBorder: '#30363d',
        titleColor: '#e6edf3',
        edgeLabelBackground: '#1c2333',
        actorBkg: '#2d333b',
        actorTextColor: '#e6edf3',
        actorBorder: '#6d5dfc',
        actorLineColor: '#8b949e',
        signalColor: '#e6edf3',
        signalTextColor: '#e6edf3',
        labelBoxBkgColor: '#2d333b',
        labelBoxBorderColor: '#6d5dfc',
        labelTextColor: '#e6edf3',
        loopTextColor: '#e6edf3',
        activationBorderColor: '#6d5dfc',
        activationBkgColor: '#1c2333',
        sequenceNumberColor: '#0d1117',
        noteBkgColor: '#161b22',
        noteTextColor: '#e6edf3',
        noteBorderColor: '#30363d',
        classText: '#e6edf3',
        labelColor: '#e6edf3',
        altBackground: '#161b22',
      },
    },
    mermaidPlugin: { class: 'mermaid-diagram' },
  }),
)
