#!/usr/bin/env node
// Checks a deep-wiki folder for the defects that break or degrade the site.
//
// Usage: node scripts/check-wiki.mjs [wikiDir] [options]
//   --mode full|crisp     quality thresholds to apply (default: full)
//   --page <path>         check only this page (repeatable); links to pages that are
//                         in the catalogue but not written yet are accepted
//   --site                only the checks that affect the rendered site (used by `npm run build`)
//   --catalogue-only      validate catalogue.json alone (before any page exists)
//   --repo <path>         source repository root (default: git toplevel, else the parent folder)
//   --no-source           do not verify that cited files and line ranges exist
//   --baseline <file>     `git status --porcelain` output saved before the run; new untracked
//                         files outside the wiki are reported
//   --json                machine-readable output
// Exit code 1 when any error is found; warnings do not fail the run.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MARKER, listPages, loadCatalogue, parseFrontmatter, posix, walkCatalogue } from './lib.mjs'

const TITLE_MAX = 60
const TABLE_MAX_COLS = 5
const TOKEN_MAX = 60
const LLMS_MAX_BYTES = 5 * 1024
const THRESHOLDS = {
  full: { diagrams: 3, types: 2, files: 5 },
  crisp: { diagrams: 1, types: 1, files: 3 },
}
// HTML that Vue compiles without complaint; anything else tag-shaped must be in backticks.
const HTML_TAGS = new Set(
  ('a abbr b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre ' +
    'q s small span strong sub summary sup table tbody td th thead tr u ul var').split(' '),
)

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { wikiDir: '.', mode: 'full', pages: [], site: false, catalogueOnly: false, source: true, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mode') opts.mode = argv[++i]
    else if (a === '--page') opts.pages.push(argv[++i])
    else if (a === '--repo') opts.repo = argv[++i]
    else if (a === '--baseline') opts.baseline = argv[++i]
    else if (a === '--site') opts.site = true
    else if (a === '--catalogue-only') opts.catalogueOnly = true
    else if (a === '--no-source') opts.source = false
    else if (a === '--json') opts.json = true
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else opts.wikiDir = a
  }
  if (!THRESHOLDS[opts.mode]) throw new Error(`--mode must be full or crisp, got ${opts.mode}`)
  return opts
}

function findRepoRoot(wikiDir, explicit) {
  if (explicit) return path.resolve(explicit)
  try {
    const top = execFileSync('git', ['-C', wikiDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (top) return path.resolve(top)
  } catch {
    // not a git repository
  }
  return path.dirname(wikiDir)
}

// ---------------------------------------------------------------------------
// Markdown scanning
// ---------------------------------------------------------------------------
/** Blank out inline code spans, keeping column positions. */
const stripInlineCode = (line) => line.replace(/(`+)(?:(?!\1).)+\1/g, (m) => ' '.repeat(m.length))
const stripComments = (line) => line.replace(/<!--.*?-->/g, (m) => ' '.repeat(m.length))

/** VitePress heading slug (mdit-vue slugify), close enough for anchor checks. */
export function slugify(heading) {
  const text = heading
    .replace(/\s*\{#[^}]+\}\s*$/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/<[^>]+>/g, '')
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
}

/** Split a page into prose lines, fenced blocks, headings, and tables. */
function scanPage(text) {
  const fm = parseFrontmatter(text)
  const lines = text.split(/\r?\n/)
  const prose = [] // { n, text } with inline code and comments blanked
  const raw = [] // { n, text } outside fences, untouched
  const blocks = [] // { lang, start, end, lines }
  const headings = []
  let fence = null
  for (let i = fm.lineCount; i < lines.length; i++) {
    const line = lines[i]
    const n = i + 1
    const open = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]*)/)
    if (fence) {
      if (open && open[1][0] === fence.char && open[1].length >= fence.len && !open[2]) {
        fence.block.end = n
        blocks.push(fence.block)
        fence = null
      } else {
        fence.block.lines.push({ n, text: line })
      }
      continue
    }
    if (open) {
      fence = { char: open[1][0], len: open[1].length, block: { lang: open[2].toLowerCase(), start: n, end: n, lines: [] } }
      continue
    }
    raw.push({ n, text: line })
    prose.push({ n, text: stripComments(stripInlineCode(line)) })
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (h) headings.push(h[1])
  }
  if (fence) blocks.push(fence.block)

  const slugs = new Set()
  const seen = new Map()
  for (const h of headings) {
    const custom = h.match(/\{#([^}]+)\}\s*$/)
    const base = custom ? custom[1] : slugify(h)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    slugs.add(count ? `${base}-${count}` : base)
  }
  return { fm, lines, prose, raw, blocks, slugs }
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------
function readRepoUrl(wikiDir) {
  const config = path.join(wikiDir, '.vitepress', 'config.mts')
  if (!fs.existsSync(config)) return ''
  const m = fs.readFileSync(config, 'utf8').match(/const REPO_URL\s*=\s*['"]([^'"]*)['"]/)
  return m && !m[1].startsWith('__') ? m[1].replace(/\/+$/, '') : ''
}

/** Turn a host URL into `{ candidates: [repoPath...], start, end }`, or null when it is not a source link. */
function parseSourceUrl(url, repoUrl) {
  if (repoUrl && !url.startsWith(repoUrl)) return null
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const ado = u.searchParams.get('path')
  if (ado) {
    const start = Number(u.searchParams.get('line')) || null
    return { candidates: [decodeURIComponent(ado).replace(/^\/+/, '')], start, end: Number(u.searchParams.get('lineEnd')) || start }
  }
  const blob = u.pathname.match(/\/(?:-\/)?blob\/(.+)$/)
  if (!blob) return null
  // "<branch>/<path>": the branch may itself contain slashes, so offer each split.
  const parts = decodeURIComponent(blob[1]).split('/')
  const candidates = []
  for (let i = 1; i < parts.length && i <= 4; i++) candidates.push(parts.slice(i).join('/'))
  const range = u.hash.match(/^#L(\d+)(?:-L?(\d+))?$/)
  return { candidates, start: range ? Number(range[1]) : null, end: range ? Number(range[2] ?? range[1]) : null }
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------
export function checkWiki(options) {
  const opts = { mode: 'full', pages: [], site: false, catalogueOnly: false, source: true, ...options }
  const wikiDir = path.resolve(opts.wikiDir ?? '.')
  const repoRoot = findRepoRoot(wikiDir, opts.repo)
  const findings = []
  const stats = { pages: 0, sections: 0, leaves: 0, diagrams: 0 }
  const add = (level, file, line, rule, message) => findings.push({ level, file, line, rule, message })
  const error = (...a) => add('error', ...a)
  const warn = (...a) => add('warn', ...a)

  // Line counts of repository files, for citation and prompt checks.
  const scanned = new Map()
  const lineCache = new Map()
  const linesIn = (p) => (lineCache.has(p) ? lineCache.get(p) : lineCache.set(p, lineCountOf(p)).get(p))

  // ---- catalogue ----------------------------------------------------------
  let catalogue = null
  const leafPaths = new Set()
  const sectionDirs = new Set()
  try {
    catalogue = loadCatalogue(wikiDir)
  } catch (e) {
    error('catalogue.json', 0, 'catalogue', `invalid JSON: ${e.message}`)
  }
  if (catalogue) {
    const siblings = new Map()
    walkCatalogue(catalogue.items, (node, ctx) => {
      const label = node.title ?? node.name ?? '(unnamed)'
      const isSection = typeof node.dir === 'string'
      const isLeaf = typeof node.path === 'string'
      const peers = siblings.get(ctx.parent) ?? siblings.set(ctx.parent, new Set()).get(ctx.parent)
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(node.title ?? '')) error('catalogue.json', 0, 'catalogue', `"${label}": title must be a kebab-case slug`)
      if (peers.has(node.title)) error('catalogue.json', 0, 'catalogue', `"${label}": duplicate title among siblings`)
      peers.add(node.title)
      if (!node.name || !String(node.name).trim()) error('catalogue.json', 0, 'catalogue', `"${label}": missing name`)
      else if (String(node.name).length > TITLE_MAX) error('catalogue.json', 0, 'catalogue', `"${label}": name is over ${TITLE_MAX} characters`)
      if (isSection === isLeaf) error('catalogue.json', 0, 'catalogue', `"${label}": needs exactly one of dir (section) or path (page)`)
      if (ctx.depth > 4) error('catalogue.json', 0, 'catalogue', `"${label}": deeper than 4 levels`)
      if ((node.children?.length ?? 0) > 8) error('catalogue.json', 0, 'catalogue', `"${label}": more than 8 children`)
      if (isSection) {
        stats.sections++
        sectionDirs.add(ctx.dir)
        if (ctx.depth === 1 && !/^\d{2}-[a-z0-9-]+$/.test(ctx.dir)) error('catalogue.json', 0, 'catalogue', `"${label}": dir must look like NN-slug`)
        if (!node.children?.length) error('catalogue.json', 0, 'catalogue', `"${label}": section has no pages`)
      }
      if (isLeaf) {
        stats.leaves++
        const p = node.path.replace(/\\/g, '/')
        if (leafPaths.has(p)) error('catalogue.json', 0, 'catalogue', `"${label}": path ${p} is used twice`)
        leafPaths.add(p)
        if (!p.endsWith('.md')) error('catalogue.json', 0, 'catalogue', `"${label}": path must end in .md`)
        const parentDir = [...sectionDirs].filter((d) => p.startsWith(`${d}/`)).length
        if (!parentDir) error('catalogue.json', 0, 'catalogue', `"${label}": path ${p} is not inside a catalogue section folder`)
        if (!node.prompt || !String(node.prompt).trim()) error('catalogue.json', 0, 'catalogue', `"${label}": missing prompt`)
        else if (opts.source && !opts.site) checkPromptFiles(node, label)
      }
    })
  }

  function lineCountOf(repoPath) {
    const file = path.join(repoRoot, repoPath)
    try {
      if (!fs.statSync(file).isFile()) return null
    } catch {
      return null
    }
    const text = fs.readFileSync(file, 'utf8')
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  }

  /** File references in a catalogue prompt: stale paths and line ranges are worth a warning. */
  function checkPromptFiles(node, label) {
    const re = /(?<![\w/.-])((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8}|[\w@-]+\.[A-Za-z0-9]{1,8}(?=:\d))(?::(\d+)(?:-(\d+))?)?/g
    for (const m of String(node.prompt).matchAll(re)) {
      const count = linesIn(m[1])
      if (count === null) warn('catalogue.json', 0, 'catalogue-prompt', `"${label}": prompt names ${m[1]}, which is not in the repository`)
      else if (m[2] && Number(m[3] ?? m[2]) > count) {
        warn('catalogue.json', 0, 'catalogue-prompt', `"${label}": prompt cites ${m[0]} but the file has ${count} lines`)
      }
    }
  }

  if (opts.catalogueOnly) return finish()

  // ---- pages --------------------------------------------------------------
  const allPages = listPages(wikiDir)
  const onDisk = new Set(allPages)
  const pageMode = opts.pages.length > 0
  const targets = pageMode
    ? opts.pages.map((p) => posix(path.relative(wikiDir, path.resolve(fs.existsSync(path.resolve(p)) ? p : path.join(wikiDir, p)))))
    : allPages
  const repoUrl = readRepoUrl(wikiDir)
  const scan = (rel) => {
    if (!scanned.has(rel)) scanned.set(rel, scanPage(fs.readFileSync(path.join(wikiDir, rel), 'utf8')))
    return scanned.get(rel)
  }
  /** A page that exists, or (while pages are still being written) one the catalogue promises. */
  const pageExists = (rel) =>
    onDisk.has(rel) || (pageMode && (leafPaths.has(rel) || (rel.endsWith('/index.md') && sectionDirs.has(rel.slice(0, -9)))))

  const kindOf = (rel) => {
    const base = path.posix.basename(rel)
    if (base === 'index.md') return 'hub'
    if (rel.startsWith('onboarding/')) return /^(executive|product-manager)/.test(base) ? 'onboarding-light' : 'onboarding'
    if (leafPaths.has(rel) || /^\d+-/.test(rel)) return 'content'
    return 'other'
  }

  for (const rel of targets) {
    if (!fs.existsSync(path.join(wikiDir, rel))) {
      error(rel, 0, 'missing', 'page does not exist')
      continue
    }
    stats.pages++
    checkPage(rel)
  }

  function checkPage(rel) {
    const page = scan(rel)
    const kind = kindOf(rel)
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel)

    // frontmatter
    const fm = page.fm.data
    if (!fm) error(rel, 1, 'frontmatter', 'missing frontmatter block (title, description)')
    else {
      for (const key of ['title', 'description']) {
        const value = fm[key]
        if (!value) error(rel, 1, 'frontmatter', `missing ${key}`)
        else if (/(undefined|\[object Object\])\s*$/.test(value) || /^(undefined|null)$/.test(value)) {
          error(rel, 1, 'frontmatter', `${key} contains a script artefact: "…${value.slice(-40)}"`)
        }
      }
      if (fm.title && fm.title.length > TITLE_MAX) {
        error(rel, 1, 'title-length', `title is ${fm.title.length} characters (max ${TITLE_MAX}); it is the sidebar label, so use a name, not a sentence`)
      }
    }

    // prose: interpolation and tag-shaped text
    for (const { n, text } of page.prose) {
      if (/\{\{|\}\}/.test(text) && !/v-pre/.test(text)) {
        error(rel, n, 'interpolation', '`{{` or `}}` outside code: Vue evaluates it and the build fails; put it in backticks')
      }
      for (const m of text.matchAll(/<\/?([A-Za-z][\w.:-]*)(?:\s[^<>]*)?\/?>/g)) {
        if (!HTML_TAGS.has(m[1].toLowerCase())) error(rel, n, 'bare-tag', `${m[0]} is read as an HTML tag; wrap it in backticks`)
      }
    }

    // mermaid
    const types = new Set()
    let diagrams = 0
    for (const block of page.blocks) {
      if (block.lang !== 'mermaid') continue
      diagrams++
      const body = block.lines.filter((l) => l.text.trim() && !l.text.trim().startsWith('%%'))
      const type = (body[0]?.text.trim().split(/\s+/)[0] ?? '').replace(/^graph$/, 'flowchart')
      if (type) types.add(type)
      else error(rel, block.start, 'mermaid', 'empty diagram')
      if (type === 'sequenceDiagram' && !block.lines.some((l) => /^\s*autonumber\b/.test(l.text))) {
        error(rel, block.start, 'mermaid', 'sequenceDiagram without autonumber')
      }
      for (const { n, text } of block.lines) {
        if (/<br\s*\/>/i.test(text)) error(rel, n, 'mermaid', 'use <br> in labels, not <br/>')
        if (/^\s*%%\{\s*init/.test(text)) warn(rel, n, 'mermaid', 'per-diagram %%{init}%% overrides the site theme; remove it')
        for (const m of text.matchAll(/(fill|stroke|color)\s*:\s*#([0-9a-fA-F]+)\b/g)) {
          const hex = m[2]
          if (hex.length !== 3 && hex.length !== 6) error(rel, n, 'mermaid', `#${hex}: hex colors must have 3 or 6 digits`)
          else if (m[1] === 'fill') {
            const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
            const light = [0, 2, 4].every((i) => parseInt(full.slice(i, i + 2), 16) >= 0xc0)
            if (light) error(rel, n, 'mermaid', `fill:#${hex} is a light-mode color; use the dark palette`)
          }
        }
      }
      if (!opts.site && kind !== 'other') {
        const after = page.lines.slice(block.end).find((l) => l.trim())
        if (!after || !/^\s*<!--\s*Sources?:/.test(after)) warn(rel, block.end, 'mermaid-sources', 'diagram is not followed by <!-- Sources: ... -->')
      }
    }
    stats.diagrams += diagrams

    // links and citations
    const cited = new Set()
    const cite = (n, candidates, start, end, shown) => {
      if (!opts.source) return cited.add(candidates[0])
      const hit = candidates.find((c) => linesIn(c) !== null)
      if (!hit) return error(rel, n, 'citation', `cited file not found in the repository: ${shown}`)
      cited.add(hit)
      const count = linesIn(hit)
      if (end && end > count) error(rel, n, 'citation', `${shown} cites line ${end} but ${hit} has ${count} lines`)
      else if (start && end && start > end) error(rel, n, 'citation', `${shown}: line range runs backwards`)
    }

    for (const { n, text } of page.prose) {
      for (const m of text.matchAll(/!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        const url = m[2]
        if (/^https?:\/\//i.test(url)) {
          const src = parseSourceUrl(url, repoUrl)
          if (src && !opts.site) cite(n, src.candidates, src.start, src.end, m[1] || url)
          continue
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) continue // mailto:, tel:, ...
        const [target, anchor] = url.split('#')
        let dest = rel
        if (target) {
          dest = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(dir, target))
          if (dest.startsWith('..')) {
            if (!fs.existsSync(path.join(wikiDir, dest))) warn(rel, n, 'link', `${url} points outside the wiki and does not exist`)
            continue
          }
          if (dest === '' || dest.endsWith('/')) dest += 'index.md'
          else if (!path.posix.extname(dest)) dest = pageExists(`${dest}.md`) ? `${dest}.md` : `${dest}/index.md`
          else if (dest.endsWith('.html')) dest = dest.replace(/\.html$/, '.md')
          if (dest.endsWith('.md') ? !pageExists(dest) : !fs.existsSync(path.join(wikiDir, dest)) && !fs.existsSync(path.join(wikiDir, 'public', dest))) {
            error(rel, n, 'link', `broken link ${url} (no ${dest})`)
            continue
          }
        }
        if (anchor && dest.endsWith('.md') && onDisk.has(dest) && !scan(dest).slugs.has(decodeURIComponent(anchor).toLowerCase())) {
          warn(rel, n, 'anchor', `${url}: no heading in ${dest} matches #${anchor}`)
        }
      }
    }

    if (!opts.site) {
      // local-host citations "(src/a.ts:42-58)" and the "<!-- Sources: ... -->" comments
      const local = /\(((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,8}):(\d+)(?:-(\d+))?\)/g
      for (const { n, text } of page.prose) {
        for (const m of text.matchAll(local)) cite(n, [m[1]], Number(m[2]), Number(m[3] ?? m[2]), `${m[1]}:${m[2]}`)
      }
      for (const { n, text } of page.raw) {
        const c = text.match(/<!--\s*Sources?:\s*(.*?)\s*-->/)
        if (!c) continue
        for (const item of c[1].split(/[,;]\s*/)) {
          const m = item.trim().match(/^`?((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?:-(\d+))?)?`?$/)
          if (!m) continue
          if (!opts.source || linesIn(m[1]) !== null) cited.add(m[1])
          else warn(rel, n, 'citation', `Sources comment names ${m[1]}, which is not in the repository`)
        }
      }

      // thresholds
      const t = THRESHOLDS[opts.mode]
      if (kind === 'content') {
        if (diagrams < t.diagrams) error(rel, 0, 'threshold', `${diagrams} Mermaid diagram(s); ${opts.mode} mode needs at least ${t.diagrams}`)
        if (types.size < t.types) error(rel, 0, 'threshold', `${types.size} diagram type(s); needs at least ${t.types}`)
      }
      if (kind === 'onboarding' && opts.mode === 'full' && types.size < 2) error(rel, 0, 'threshold', `${types.size} diagram type(s); onboarding guides need at least 2`)
      if ((kind === 'content' || kind === 'onboarding') && cited.size < t.files) {
        error(rel, 0, 'threshold', `cites ${cited.size} distinct source file(s); ${opts.mode} mode needs at least ${t.files}`)
      }

      // tables
      for (let i = 0; i < page.raw.length - 1; i++) {
        const head = page.raw[i]
        if (!/^\s*\|.*\|\s*$/.test(head.text) || !/^\s*\|?\s*:?-{2,}/.test(page.raw[i + 1].text)) continue
        if (i > 0 && /^\s*\|/.test(page.raw[i - 1].text)) continue // not the header row
        const cols = stripInlineCode(head.text).replace(/\\\|/g, '').trim().replace(/^\||\|$/g, '').split('|').length
        if (cols > TABLE_MAX_COLS) warn(rel, head.n, 'table', `${cols} columns (max ${TABLE_MAX_COLS}); split the table or merge columns`)
        let longest = ''
        for (let j = i + 2; j < page.raw.length && /^\s*\|/.test(page.raw[j].text); j++) {
          const visible = page.raw[j].text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '')
          for (const token of visible.split(/[\s|]+/)) if (token.length > longest.length) longest = token
        }
        if (longest.length > TOKEN_MAX) warn(rel, head.n, 'table', `unbreakable ${longest.length}-character cell text "${longest}"; shorten it (file name, not full path)`)
      }
    }
    page.cited = cited.size
    page.diagrams = diagrams
  }

  if (pageMode) return finish()

  // ---- whole-wiki checks ----------------------------------------------------
  const config = path.join(wikiDir, '.vitepress', 'config.mts')
  if (fs.existsSync(config)) {
    const left = fs.readFileSync(config, 'utf8').match(/'__[A-Z_]+__'/g)
    if (left) error('.vitepress/config.mts', 0, 'placeholder', `unfilled placeholder(s): ${[...new Set(left)].join(', ')}`)
  }

  if (catalogue) {
    for (const p of leafPaths) if (!onDisk.has(p)) error('catalogue.json', 0, 'catalogue-drift', `catalogue page ${p} was never written`)
    if (!opts.site) {
      const topDirs = new Set([...sectionDirs].map((d) => d.split('/')[0]))
      for (const rel of allPages) {
        const top = rel.split('/')[0]
        if (!/^\d+-/.test(top) || !rel.includes('/')) continue
        if (!topDirs.has(top)) warn(rel, 0, 'catalogue-drift', `stale: section folder ${top}/ is not in the catalogue`)
        else if (!leafPaths.has(rel) && !rel.endsWith('/index.md')) warn(rel, 0, 'catalogue-drift', 'page is not in the catalogue')
      }
      for (const d of sectionDirs) {
        if (!onDisk.has(`${d}/index.md`)) warn(`${d}/index.md`, 0, 'section-index', 'section has no index.md; run `node scripts/gen-section-indexes.mjs .`')
      }
    }
  }

  if (!opts.site) {
    const llms = [
      ['llms.txt', path.join(wikiDir, 'llms.txt'), wikiDir],
      ['public/llms.txt', path.join(wikiDir, 'public', 'llms.txt'), null],
      ['../llms.txt', path.join(repoRoot, 'llms.txt'), repoRoot],
    ]
    for (const [label, file, base] of llms) {
      if (!fs.existsSync(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      if (label === '../llms.txt' && !text.includes(MARKER)) continue // not ours
      const bytes = Buffer.byteLength(text)
      if (bytes > LLMS_MAX_BYTES) warn(label, 0, 'llms', `${(bytes / 1024).toFixed(1)} KB; keep llms.txt under 5 KB (shorter descriptions, fewer optional links)`)
      text.split(/\r?\n/).forEach((line, i) => {
        if (!/^\s*-\s*\[/.test(line)) return
        const m = line.match(/^- \[([^\]]+)\]\(([^)\s]+)\)(?:: \S.*)?$/)
        if (!m || m[1] !== m[1].trim()) return error(label, i + 1, 'llms', 'link line must be exactly `- [Title](url): description`')
        if (base && !/^[a-z][a-z0-9+.-]*:|^\//i.test(m[2])) {
          const target = path.resolve(base, m[2].split('#')[0])
          if (!fs.existsSync(target)) error(label, i + 1, 'llms', `links to ${m[2]}, which does not exist`)
        }
      })
    }

    if (opts.baseline) checkLeftovers()
  }

  function checkLeftovers() {
    const untracked = (text) =>
      new Set(text.split(/\r?\n/).filter((l) => l.startsWith('?? ')).map((l) => l.slice(3).replace(/^"|"$/g, '')))
    let now
    try {
      now = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
    } catch {
      return
    }
    const before = fs.existsSync(opts.baseline) ? untracked(fs.readFileSync(opts.baseline, 'utf8')) : new Set()
    const wikiRel = posix(path.relative(repoRoot, wikiDir))
    const expected = /(^|\/)(AGENTS\.md|CLAUDE\.md|llms(-full)?\.txt)$|^\.github\/workflows\/deploy-wiki\.yml$/
    for (const file of untracked(now)) {
      const covered = [...before].some((b) => file === b || (b.endsWith('/') && file.startsWith(b)))
      if (covered || file.startsWith(`${wikiRel}/`) || expected.test(file)) continue
      warn(file, 0, 'leftover', 'file appeared during the run and is not a wiki output; delete it unless the user wants it')
    }
  }

  return finish()

  function finish() {
    // No cited file resolves at all: the source repository is not here. Say so once.
    const notFound = (f) => f.rule === 'citation' && f.message.includes('not found in the repository')
    if (findings.some(notFound) && ![...lineCache.values()].some((v) => v !== null)) {
      const count = findings.filter(notFound).length
      for (let i = findings.length - 1; i >= 0; i--) if (notFound(findings[i]) || findings[i].rule === 'threshold' && /distinct source/.test(findings[i].message)) findings.splice(i, 1)
      error('.', 0, 'citation', `none of the ${count} cited files exist under ${posix(repoRoot)}; pass --repo <source root> or --no-source`)
    }
    const errors = findings.filter((f) => f.level === 'error')
    const warnings = findings.filter((f) => f.level === 'warn')
    const pages = [...scanned].filter(([, p]) => p.diagrams !== undefined).map(([file, p]) => ({ file, diagrams: p.diagrams, citedFiles: p.cited }))
    return { ok: errors.length === 0, errors, warnings, stats, pages }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  const result = checkWiki(opts)
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const print = (f) => console.log(`  ${f.level === 'error' ? 'error' : 'warn '}  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}] ${f.message}`)
    result.errors.forEach(print)
    result.warnings.forEach(print)
    const s = result.stats
    console.log(
      `\ncatalogue: ${s.sections} section(s), ${s.leaves} page(s) | checked ${s.pages} page(s), ${s.diagrams} diagram(s) | ` +
        `${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
    )
  }
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
