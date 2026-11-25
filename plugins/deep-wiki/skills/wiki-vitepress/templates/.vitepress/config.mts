import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Read the page title from frontmatter, then the first H1, then the file name. */
function titleOf(file: string): string {
  const text = fs.readFileSync(file, 'utf8')
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const fmTitle = fm?.[1].match(/^title:\s*(.+)$/m)
  if (fmTitle) return fmTitle[1].trim().replace(/^['"]|['"]$/g, '')
  const h1 = text.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : path.basename(file, '.md')
}

/** "02-getting-started" -> "Getting Started" (index.md title wins when present). */
function sectionName(dir: string): string {
  const index = path.join(root, dir, 'index.md')
  if (fs.existsSync(index)) return titleOf(index)
  return path
    .basename(dir)
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

type SidebarItem = { text: string; link?: string; collapsed?: boolean; items?: SidebarItem[] }

const EXCLUDED = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md'])

/**
 * Pages in `dir`, then one collapsible group per sub-folder, recursively, so a
 * catalogue up to four levels deep is fully reachable from the sidebar.
 */
function pagesIn(dir: string): SidebarItem[] {
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  const pages: SidebarItem[] = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !EXCLUDED.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => (a === 'index.md' ? -1 : b === 'index.md' ? 1 : a.localeCompare(b)))
    .map((f) => ({
      text: titleOf(path.join(root, dir, f)),
      link: `/${dir}/${f === 'index.md' ? '' : f.replace(/\.md$/, '')}`,
    }))
  const groups: SidebarItem[] = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['public', 'scripts', 'dist', 'node_modules'].includes(e.name))
    .map((e) => e.name)
    .sort()
    .map((sub) => ({ text: sectionName(`${dir}/${sub}`), collapsed: true, items: pagesIn(`${dir}/${sub}`) }))
    .filter((g) => g.items.length > 0)
  return [...pages, ...groups]
}

/** Onboarding first (expanded), then numbered sections; the first three expanded. */
function buildSidebar() {
  const numbered = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+-/.test(d.name))
    .map((d) => d.name)
    .sort()

  const groups: SidebarItem[] = []
  if (fs.existsSync(path.join(root, 'onboarding'))) {
    groups.push({ text: 'Onboarding', collapsed: false, items: pagesIn('onboarding') })
  }
  numbered.forEach((dir, i) => {
    groups.push({ text: sectionName(dir), collapsed: i >= 3, items: pagesIn(dir) })
  })
  return [{ text: 'Home', link: '/' }, ...groups]
}

function editLink() {
  if (!REPO_URL || !BRANCH) return undefined
  if (REPO_URL.includes('github.com')) {
    return { pattern: `${REPO_URL}/edit/${BRANCH}/${WIKI_DIR}/:path`, text: 'Edit this page' }
  }
  if (REPO_URL.includes('gitlab')) {
    return { pattern: `${REPO_URL}/-/edit/${BRANCH}/${WIKI_DIR}/:path`, text: 'Edit this page' }
  }
  return undefined
}

export default withMermaid(
  defineConfig({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    base: BASE,
    cleanUrls: true,
    lastUpdated: true,
    // Pages cite source files outside the wiki; those links are not site routes.
    ignoreDeadLinks: true,
    srcExclude: ['AGENTS.md', 'CLAUDE.md', 'README.md', 'scripts/**', 'dist/**'],
    // Dark only: no light/dark toggle.
    appearance: 'force-dark',
    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}logo.svg` }],
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
    },
    vite: {
      optimizeDeps: { include: ['mermaid'] },
    },
    themeConfig: {
      logo: '/logo.svg',
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Onboarding', link: '/onboarding/' },
      ],
      sidebar: buildSidebar(),
      outline: { level: [2, 3] },
      search: { provider: 'local' },
      socialLinks: REPO_URL.includes('github.com') ? [{ icon: 'github', link: REPO_URL }] : [],
      editLink: editLink(),
      footer: { message: 'Generated with deep-wiki' },
    },
    mermaid: {
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
