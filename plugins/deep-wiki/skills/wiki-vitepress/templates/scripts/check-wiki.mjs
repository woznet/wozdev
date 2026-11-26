#!/usr/bin/env node
// Checks a deep-wiki folder for the defects that break or degrade the site.
//
// Usage (from the repository root): node wiki/scripts/check-wiki.mjs [wikiDir] [options]
//   --mode full|crisp       quality thresholds (default: `depth` in <wiki>/.deep-wiki.json, else full)
//   --page <path>           check only this page (repeatable); links to pages the run has not
//                           written yet (catalogue pages, section indexes, landing page, onboarding)
//                           are accepted
//   --pending               whole-wiki run while pages are still being written: accepts links to the
//                           landing page and onboarding pages before they exist, does not require a
//                           landing page, and skips the llms checks
//   --site                  only the checks that affect the rendered site (used by `npm run build`):
//                           frontmatter, {{ }}, tags, Mermaid rules, links, placeholders, landing page.
//                           No catalogue, citation, threshold, table, llms, or leftover checks: the
//                           build is never stopped by something VitePress itself would render.
//   --catalogue-only        validate catalogue.json alone (before any page exists)
//   --repo <path>           source repository root (default: the root the state file records, else the
//                           git top level; with neither, citations are checked against the wiki's
//                           parent folder and the summary says so)
//   --repo-url <url|none>   repository web URL; links under it are source citations
//                           (default: REPO_URL in .vitepress/config.mts, else the state file)
//   --branch <name>         default branch used in citation links (default: as for --repo-url)
//   --no-source             do not verify that cited files and line ranges exist
//   --write-baseline <file> save `git status` now, for a later --baseline run, and exit
//   --baseline <file>       report files that appeared or changed in the repository since then
//   --report                print a `Section | Pages | Diagrams | Cited files` table
//   --json                  machine-readable output
// Exit codes: 0 clean (warnings allowed), 1 errors found, 2 usage or I/O failure.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  HTML_TAGS,
  ONBOARDING_ORDER,
  VOID_TAGS,
  countSourceFiles,
  createFenceScanner,
  gitTopLevel,
  inlineLinks,
  isMarked,
  linkDefinition,
  pagePathProblem,
  listPages,
  loadCatalogue,
  loadState,
  parseFrontmatter,
  posix,
  readText,
  relativeInside,
  repoUrlFromArg,
  resolveRepoRoot,
  resolveSite,
  sectionDirProblem,
  walkCatalogue,
} from './lib.mjs'

export { HTML_TAGS }

const TITLE_MAX = 60
const TABLE_MAX_COLS = 5
const TOKEN_MAX = 60
const LLMS_MAX_BYTES = 5 * 1024
const SEQUENCE_MAX_PARTICIPANTS = 6
const GIT_MAX_BUFFER = 256 * 1024 * 1024

// Minimums per page kind. `files` is the number of distinct source files cited.
const THRESHOLDS = {
  full: {
    content: { diagrams: 3, types: 2, files: 5 },
    onboarding: { diagrams: 5, types: 2, files: 5 }, // contributor and staff engineer guides
    'onboarding-light': { diagrams: 3, types: 2, files: 0 }, // executive and product manager guides
  },
  crisp: {
    content: { diagrams: 1, types: 1, files: 3 },
    onboarding: { diagrams: 2, types: 1, files: 3 },
    'onboarding-light': { diagrams: 1, types: 1, files: 0 },
  },
}

// The four onboarding guides and the minimums each one gets; any other file under onboarding/ has none.
const ONBOARDING_KIND = {
  'contributor-guide.md': 'onboarding',
  'staff-engineer-guide.md': 'onboarding',
  'executive-guide.md': 'onboarding-light',
  'product-manager-guide.md': 'onboarding-light',
}
// "(example.com:443)" is a host and a port, not a file and a line.
const HOST_LIKE_EXTENSIONS = new Set('com org net io dev app co edu gov internal local localhost lan corp cloud'.split(' '))
// Extensions VitePress treats as assets. A relative link with any other extension is a page link.
const ASSET_EXTENSIONS = new Set(
  ('3g2 3gp aac ai apng au avif bin bmp cer class conf crl css csv dll doc eps epub exe gif gz ics ief jar jpe jpeg jpg ' +
    'js json jsonld m4a man mid midi mjs mov mp2 mp3 mp4 mpe mpeg mpg mpp oga ogg ogv ogx opus otf p10 p7c p7m p7s pdf ' +
    'png ps qt roff rtf rtx ser svg t tif tiff tr ts tsv ttf txt vtt wav weba webm webp woff woff2 xhtml xml yaml yml zip').split(' '),
)
// Files the site config keeps out of the build: a link to one never resolves on the site.
const NOT_A_PAGE_LINK = /(^|\/)(AGENTS|CLAUDE|README)(\.md)?$/
// File names with no extension that are still clearly files: "(Dockerfile:12)" is a citation.
const EXTENSIONLESS_FILES = new Set(
  ('Dockerfile Containerfile Makefile GNUmakefile Jenkinsfile Procfile Gemfile Rakefile Vagrantfile Brewfile Justfile ' +
    'Tiltfile Earthfile Caddyfile LICENSE LICENCE NOTICE COPYING CODEOWNERS AUTHORS CHANGELOG VERSION').split(' '),
)
// Tags that start a raw HTML block in Markdown. Until the next blank line nothing inside is
// Markdown, so backticks there are literal text and protect nothing.
const HTML_BLOCK_START = new RegExp(
  '^ {0,3}</?(?:address|article|aside|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|' +
    'figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|main|menu|nav|ol|optgroup|option|p|pre|' +
    'search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|ul)(?:\\s|/?>|$)',
  'i',
)
/** A GFM table delimiter row: "|---|:-:|". A bare "---" is a rule or a heading underline, not a table. */
const isDelimiterRow = (text) => text.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text)
/** Table cells as GFM splits them: on every pipe that is not backslash-escaped, in or out of backticks. */
const splitCells = (line) => line.split(/(?<!\\)\|/)
const LIGHT_COLOR_NAMES = new Set(
  ('white whitesmoke snow ivory beige linen seashell floralwhite ghostwhite aliceblue azure mintcream honeydew lavender ' +
    'lightyellow lightblue lightgreen lightgray lightgrey lightcyan lightpink yellow pink cyan aqua lime gold silver ' +
    'orange khaki wheat gainsboro').split(' '),
)

/** A bad command line or an unreadable input: exit code 2, never a finding. */
export class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const VALUE_OPTIONS = { '--mode': 'mode', '--repo': 'repo', '--repo-url': 'repoUrl', '--branch': 'branch', '--baseline': 'baseline', '--write-baseline': 'writeBaseline' }
const FLAG_OPTIONS = { '--site': ['site', true], '--catalogue-only': ['catalogueOnly', true], '--pending': ['pending', true], '--no-source': ['source', false], '--report': ['report', true], '--json': ['json', true] }

export function parseArgs(argv) {
  const opts = { pages: [] }
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    let inline
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
    if (a === '--page' || VALUE_OPTIONS[a]) {
      const value = inline ?? argv[++i]
      // `--repo-url ''` is how a shell passes "no URL"; every other option needs text.
      const mayBeEmpty = a === '--repo-url'
      if (value === undefined || (value === '' && !mayBeEmpty) || (inline === undefined && value.startsWith('--'))) throw new UsageError(`${a} needs a value`)
      if (a === '--page') opts.pages.push(value)
      else opts[VALUE_OPTIONS[a]] = a === '--repo-url' ? repoUrlFromArg(value) : value
    } else if (FLAG_OPTIONS[a]) {
      if (inline !== undefined) throw new UsageError(`${a} takes no value`)
      opts[FLAG_OPTIONS[a][0]] = FLAG_OPTIONS[a][1]
    } else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`)
    else if (opts.wikiDir === undefined) opts.wikiDir = a
    else throw new UsageError(`Unexpected argument ${a} (the wiki folder is already ${opts.wikiDir})`)
  }
  opts.wikiDir = opts.wikiDir ?? '.'
  if (opts.mode !== undefined && !THRESHOLDS[opts.mode]) throw new UsageError(`--mode must be full or crisp, got ${opts.mode}`)
  return opts
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER })
}

/**
 * Where cited files are looked up. With no --repo, no recorded root, and no git, the wiki's
 * parent folder is the only candidate: `guessed` is then true and the summary says so.
 */
function findRepoRoot(wikiDir, explicit, state) {
  const { root } = resolveRepoRoot(wikiDir, { repo: explicit, state })
  return root ? { repoRoot: root, guessed: false } : { repoRoot: path.dirname(wikiDir), guessed: true }
}

const gitStatus = (repoRoot) => git(repoRoot, ['status', '--porcelain', '--untracked-files=all'])

/** Save the working-tree state so a later `--baseline` run can tell what the run left behind. */
export function writeBaseline(options) {
  const wikiDir = path.resolve(options.wikiDir ?? '.')
  const { repoRoot } = findRepoRoot(wikiDir, options.repo)
  let status
  try {
    status = gitStatus(repoRoot)
  } catch {
    throw new UsageError(`${posix(repoRoot)} is not a git repository; skip the baseline and the leftover check`)
  }
  const file = path.resolve(options.writeBaseline)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `# deep-wiki baseline\n${status}`, 'utf8')
  return file
}

// ---------------------------------------------------------------------------
// Markdown scanning
// ---------------------------------------------------------------------------
const INLINE_CODE = /(`+)(?:(?!\1).)+\1/g
/** Blank out inline code spans, keeping column positions. */
const stripInlineCode = (line) => line.replace(INLINE_CODE, (m) => ' '.repeat(m.length))

/** Blank out HTML comments, including ones that span lines (`state.open` carries over). */
function blankComments(text, state) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (state.open) {
      const end = text.indexOf('-->', i)
      if (end < 0) return out + ' '.repeat(text.length - i)
      out += ' '.repeat(end + 3 - i)
      i = end + 3
      state.open = false
    } else {
      const start = text.indexOf('<!--', i)
      if (start < 0) return out + text.slice(i)
      out += text.slice(i, start)
      i = start
      state.open = true
    }
  }
  return out
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** VitePress heading slug (mdit-vue slugify), close enough for anchor checks. */
export function slugify(heading) {
  // Inline code keeps its text (`List<T>` contributes "List<T>"); markup around it does not.
  const text = heading
    .replace(/\s*\{#[^}]+\}\s*$/, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, ' ') // an entity renders as punctuation, which the slug drops
    .split(/(`+[^`]*`+)/)
    .map((part) =>
      part.startsWith('`')
        ? part.replace(/^`+|`+$/g, '')
        : part
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\*/g, '')
            .replace(/<[^>]+>/g, ''),
    )
    .join('')
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

/** Split a page into prose lines, fenced blocks, headings, and `<!-- Sources -->` comments. */
function scanPage(source) {
  const text = source.replace(/^\uFEFF/, '')
  const fm = parseFrontmatter(text)
  const lines = text.split(/\r?\n/)
  const prose = [] // { n, text } with inline code and comments blanked
  const raw = [] // { n, text } outside fences, untouched
  const blocks = [] // { lang, start, end, lines }
  const headings = []
  const comment = { open: false }
  const fenceAt = createFenceScanner()
  let block = null
  let vpre = false
  let inTable = false // inside a GFM table (header row through the last row)
  let inHtml = false // inside a raw HTML block (opening tag line through the next blank line)
  for (let i = fm.lineCount; i < lines.length; i++) {
    const line = lines[i]
    const n = i + 1
    // Inside an HTML comment nothing opens a fence; the scanner is not shown those lines.
    const step = !block && comment.open ? { kind: 'text' } : fenceAt(line)
    if (step.kind === 'open') {
      block = { lang: step.lang, info: step.info, start: n, end: n, lines: [] }
      inTable = inHtml = false
      continue
    }
    if (block) {
      if (step.kind === 'close') {
        block.end = n
        blocks.push(block)
        block = null
      } else block.lines.push({ n, text: line })
      continue
    }
    if (vpre) {
      if (/^\s*:::+\s*$/.test(line)) vpre = false
      continue
    }
    if (!comment.open && /^\s*:::+\s*v-pre\b/.test(line)) {
      vpre = true
      continue
    }
    const startsInComment = comment.open
    if (!line.trim()) inTable = inHtml = false
    else if (!inTable && !inHtml && !startsInComment) {
      if (line.includes('|') && isDelimiterRow(lines[i + 1] ?? '')) inTable = true
      else if (HTML_BLOCK_START.test(line)) inHtml = true
    }
    // What the reader's browser gets as text rather than code. In a raw HTML block backticks are
    // literal; in a table row a code span cannot cross a cell boundary.
    const visible = inHtml ? line : inTable ? splitCells(line).map(stripInlineCode).join('|') : stripInlineCode(line)
    raw.push({ n, text: line, table: inTable })
    prose.push({ n, text: blankComments(visible, comment), html: inHtml })
    const h = startsInComment ? null : line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (h) headings.push(h[1])
  }
  if (block) blocks.push(block)

  const slugs = new Set()
  const seen = new Map()
  for (const h of headings) {
    const custom = h.match(/\{#([^}]+)\}\s*$/)
    const base = custom ? custom[1] : slugify(h)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    slugs.add(count ? `${base}-${count}` : base)
  }

  // "<!-- Sources: a.ts:1, b.ts:2 -->", possibly spanning lines.
  const sources = []
  const outside = raw.map((l) => l.text).join('\n')
  for (const m of outside.matchAll(/<!--\s*Sources?:([\s\S]*?)-->/g)) {
    const n = raw[outside.slice(0, m.index).split('\n').length - 1].n
    sources.push({ n, items: m[1].split(/[,;\n]/).map((s) => s.trim().replace(/^`+|`+$/g, '')).filter(Boolean) })
  }
  return { fm, lines, prose, raw, blocks, slugs, sources }
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------
/**
 * Turn a host URL into `{ candidates: [repoPath...], start, end }`, or null when it is not a
 * link into this repository. `repoUrl` empty means "unknown": the caller then treats a match
 * as a citation only if a candidate exists.
 */
function parseSourceUrl(url, repoUrl, branch) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (repoUrl) {
    // Same repository, not a look-alike: "o/r" must not claim "o/r-other".
    if (!url.toLowerCase().startsWith(repoUrl.toLowerCase())) return null
    if (!/^($|[/?#])/.test(url.slice(repoUrl.length))) return null
  }
  const adoPath = u.searchParams.get('path')
  if (adoPath && u.pathname.includes('/_git/')) {
    // "line=0" must survive as 0 so it can be reported: line numbers start at 1.
    const number = (key) => (/^\d+$/.test(u.searchParams.get(key) ?? '') ? Number(u.searchParams.get(key)) : null)
    const start = number('line')
    return { candidates: [adoPath.replace(/^\/+/, '')], start, end: number('lineEnd') ?? start }
  }
  const blob = u.pathname.match(/\/(?:-\/)?blob\/(.+)$/)
  if (!blob) return null
  const rest = safeDecode(blob[1])
  // "<ref>/<path>": the known branch is stripped exactly. Any other ref is taken to be one
  // segment; guessing longer refs would let a wrong path match by its tail.
  const file = branch && rest.startsWith(`${branch}/`) ? rest.slice(branch.length + 1) : rest.split('/').slice(1).join('/')
  if (!file) return null
  const range = u.hash.match(/^#L(\d+)(?:-L?(\d+))?$/)
  return { candidates: [file], start: range ? Number(range[1]) : null, end: range ? Number(range[2] ?? range[1]) : null }
}

/** `path:42`, `path:42-58`, or `path:~Symbol` -> parts; null when the text is not that shape. */
function parseCitation(item) {
  const colon = item.lastIndexOf(':')
  if (colon <= 0 || /\s/.test(item)) return null
  const file = item.slice(0, colon)
  const tail = item.slice(colon + 1)
  if (file.includes('//') || /[,;]/.test(file)) return null
  const lines = tail.match(/^(\d+)(?:-(\d+))?$/)
  if (!lines && !/^~[\w.$#<>-]+$/.test(tail)) return null
  return { file, start: lines ? Number(lines[1]) : null, end: lines ? Number(lines[2] ?? lines[1]) : null }
}

/**
 * A name that reads as a file even before we know it exists: its last segment has a lettered
 * extension or is a well-known extensionless file (Dockerfile, Makefile, LICENSE, ...).
 * "(example.com:443)", "(db.internal:5432)" and "(library/postgres:16)" do not.
 */
const looksLikeFile = (p) => {
  const name = path.posix.basename(p)
  if (EXTENSIONLESS_FILES.has(name)) return true
  const ext = name.match(/\.([A-Za-z][\w+-]*)$/)?.[1]
  return Boolean(ext) && (p.includes('/') || !HOST_LIKE_EXTENSIONS.has(ext.toLowerCase()))
}

/** Relative luminance (0 black to 1 white) of sRGB channels given as 0-255. */
const luminance = (channels) => {
  const [r, g, b] = channels.map((v) => {
    const c = Math.min(255, Math.max(0, v)) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const hexLuminance = (hex) => {
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
  return luminance([0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)))
}
/** True for `rgb(...)` or `hsl(...)` text that paints a light color. A faint overlay (alpha under 0.35) is not one. */
function isLightFunction(text) {
  const m = text.match(/^(rgb|hsl)a?\(([^)]*)\)$/i)
  if (!m) return false
  const parts = m[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return false
  if (parts[3] !== undefined) {
    const alpha = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    if (alpha < 0.35) return false
  }
  if (m[1].toLowerCase() === 'hsl') return parseFloat(parts[2]) > 60
  return luminance(parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)))) > 0.4
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------
export function checkWiki(options) {
  const wikiDir = path.resolve(options.wikiDir ?? '.')
  let isDir = false
  try {
    isDir = fs.statSync(wikiDir).isDirectory()
  } catch {
    // reported below
  }
  if (!isDir) throw new UsageError(`wiki folder not found: ${posix(wikiDir)}`)

  const state = loadState(wikiDir)
  const opts = { pages: [], site: false, catalogueOnly: false, pending: false, source: true, ...options }
  opts.mode = opts.mode ?? (THRESHOLDS[state.depth] ? state.depth : 'full')
  if (!THRESHOLDS[opts.mode]) throw new UsageError(`mode must be full or crisp, got ${opts.mode}`)
  const { repoRoot, guessed: repoRootGuessed } = findRepoRoot(wikiDir, opts.repo, state)
  const site = resolveSite(wikiDir, state)
  const repoUrl = opts.repoUrl === undefined ? site.repoUrl : repoUrlFromArg(opts.repoUrl)
  const branch = String(opts.branch ?? site.branch)

  const findings = []
  const stats = { pages: 0, sections: 0, leaves: 0, diagrams: 0 }
  const add = (level, file, line, rule, message) => findings.push({ level, file, line, rule, message })
  const error = (...a) => add('error', ...a)
  const warn = (...a) => add('warn', ...a)

  // ---- repository files ----------------------------------------------------
  const scanned = new Map()
  const lineCache = new Map()
  let resolvedAnyFile = false // some cited or prompt-named file exists: the source repository is here
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
  /** Line count of a repository file, or null when it is not a file. */
  const linesIn = (p) => {
    if (!lineCache.has(p)) lineCache.set(p, lineCountOf(p))
    if (lineCache.get(p) !== null) resolvedAnyFile = true
    return lineCache.get(p)
  }
  const existsInRepo = (p) => fs.existsSync(path.join(repoRoot, p))
  const isRepoFolder = (p) => {
    try {
      return fs.statSync(path.join(repoRoot, p)).isDirectory()
    } catch {
      return false
    }
  }
  // A repository with three source files cannot be cited five times over: cap the minimum.
  let sourceFiles
  const sourceFileCap = () => (sourceFiles = sourceFiles ?? countSourceFiles(repoRoot, wikiDir, 5))
  /** Repo-relative path with forward slashes and no leading "./"; null when it escapes the repository. */
  const repoPath = (p) => {
    const norm = path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^\/+/, '')
    return norm === '.' || norm.startsWith('..') ? null : norm
  }
  let realRoot = null
  /** The path as the file system spells it, to catch `src/A.ts` cited for `src/a.ts`. */
  const trueCase = (p) => {
    try {
      realRoot = realRoot ?? fs.realpathSync.native(repoRoot)
      const real = posix(path.relative(realRoot, fs.realpathSync.native(path.join(repoRoot, p))))
      return real.toLowerCase() === p.toLowerCase() ? real : p
    } catch {
      return p
    }
  }

  // ---- catalogue ----------------------------------------------------------
  let catalogue = null
  let hasCatalogueFile = false
  const leafPaths = new Set()
  const sectionDirs = new Set()
  const minFiles = new Map()
  // The site build reads the catalogue only for names and order: its schema is not a site check.
  const cat = (message) => {
    if (!opts.site) error('catalogue.json', 0, 'catalogue', message)
  }
  try {
    catalogue = loadCatalogue(wikiDir)
    hasCatalogueFile = catalogue !== null
  } catch (e) {
    hasCatalogueFile = true
    cat(`invalid JSON: ${e.message}`)
  }
  if (!hasCatalogueFile && opts.catalogueOnly) cat('catalogue.json not found')
  if (catalogue !== null && (typeof catalogue !== 'object' || Array.isArray(catalogue) || !Array.isArray(catalogue.items))) {
    cat('must be an object with an `items` array')
    catalogue = null
  }
  if (catalogue) {
    const checkShape = (items, where) => {
      items.forEach((node, i) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return cat(`${where}[${i}] is not an object`)
        if (node.children !== undefined && !Array.isArray(node.children)) cat(`"${node.title ?? i}": children must be an array`)
        else if (node.children) checkShape(node.children, `"${node.title ?? i}".children`)
      })
    }
    checkShape(catalogue.items, 'items')

    const siblings = new Map()
    walkCatalogue(catalogue.items, (node, ctx) => {
      const label = node.title ?? node.name ?? '(unnamed)'
      const isSection = typeof node.dir === 'string'
      const isLeaf = typeof node.path === 'string'
      const children = Array.isArray(node.children) ? node.children : []
      const peers = siblings.get(ctx.parent) ?? siblings.set(ctx.parent, new Set()).get(ctx.parent)
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(node.title ?? '')) cat(`"${label}": title must be a kebab-case slug`)
      if (peers.has(node.title)) cat(`"${label}": duplicate title among siblings`)
      peers.add(node.title)
      // Names and descriptions are copied into page titles and prose, where Vue reads tags and {{ }}.
      const unsafe = (text) => /[<>]|\{\{|\}\}/.test(String(text ?? ''))
      // A line break in these ends up inside generated frontmatter and dispatch prompts.
      for (const key of ['name', 'description', 'prompt']) {
        if (typeof node[key] === 'string' && /[\r\n]/.test(node[key])) cat(`"${label}": ${key} must be a single line (no line breaks)`)
      }
      if (!node.name || !String(node.name).trim()) cat(`"${label}": missing name`)
      else if (String(node.name).length > TITLE_MAX) cat(`"${label}": name is over ${TITLE_MAX} characters`)
      else if (unsafe(node.name)) cat(`"${label}": name must not contain <, >, {{ or }}`)
      if (isSection === isLeaf) cat(`"${label}": needs exactly one of dir (section) or path (page)`)
      if (ctx.depth > 4) cat(`"${label}": deeper than 4 levels`)
      if (children.length > 8) cat(`"${label}": more than 8 children`)
      if (isSection) {
        stats.sections++
        const problem = sectionDirProblem(ctx.dir)
        if (problem) cat(`"${label}": dir ${ctx.dir} ${problem}`)
        else if (sectionDirs.has(ctx.dir)) cat(`"${label}": dir ${ctx.dir} is used by two sections`)
        sectionDirs.add(ctx.dir)
        if (node.description !== undefined && typeof node.description !== 'string') cat(`"${label}": description must be a string`)
        else if (unsafe(node.description)) cat(`"${label}": description must not contain <, >, {{ or }}`)
        if (!children.length) cat(`"${label}": section has no pages`)
      }
      if (isLeaf) {
        stats.leaves++
        const p = node.path.replace(/\\/g, '/')
        if (leafPaths.has(p)) cat(`"${label}": path ${p} is used twice`)
        leafPaths.add(p)
        const pathProblem = p.endsWith('.md') ? pagePathProblem(p) : 'must end in .md'
        if (pathProblem) cat(`"${label}": path ${p} ${pathProblem}`)
        if (path.posix.basename(p) === 'index.md') cat(`"${label}": index.md is generated for every section; give the page its own name`)
        if (!ctx.parentDir) cat(`"${label}": page is not inside a section`)
        else if (!p.startsWith(`${ctx.parentDir}/`)) cat(`"${label}": path ${p} is not inside its section folder ${ctx.parentDir}/`)
        if (children.length) cat(`"${label}": a page cannot have children`)
        if (node.minFiles !== undefined) {
          if (Number.isInteger(node.minFiles) && node.minFiles >= 2 && node.minFiles <= 4) minFiles.set(p, node.minFiles)
          else cat(`"${label}": minFiles must be an integer from 2 to 4`)
        }
        if (!node.prompt || !String(node.prompt).trim()) cat(`"${label}": missing prompt`)
        else if (opts.source && !opts.site) checkPromptFiles(node, label)
      }
    })
    if (!stats.leaves) cat('catalogue has no pages')
  }

  /** File references in a catalogue prompt: stale paths and line ranges are worth a warning. */
  function checkPromptFiles(node, label) {
    const re = /(?<![\w/.-])((?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]{1,12}|[\w@+-]+\.[A-Za-z0-9]{1,12}(?=:\d))(?![\w/])(?::(\d+)(?:-(\d+))?)?/g
    for (const m of String(node.prompt).matchAll(re)) {
      const p = repoPath(m[1])
      if (!p) continue
      const count = linesIn(p)
      if (count === null) {
        if (existsInRepo(p)) continue // a folder with a dot in its name
        // Only a path whose first folder exists is clearly meant as a repository path ("Node.js/Express.js" is not).
        if (p.includes('/') && existsInRepo(p.split('/')[0])) {
          warn('catalogue.json', 0, 'catalogue-prompt', `"${label}": prompt names ${p}, which is not in the repository`)
        }
      } else if (m[2] && Number(m[3] ?? m[2]) > count) {
        warn('catalogue.json', 0, 'catalogue-prompt', `"${label}": prompt cites ${m[0]} but the file has ${count} lines`)
      }
    }
  }

  if (opts.catalogueOnly) return finish()

  // ---- pages --------------------------------------------------------------
  const allPages = listPages(wikiDir)
  const onDisk = new Set(allPages)
  const pageMode = opts.pages.length > 0
  const acceptPending = pageMode || opts.pending
  /** `--page` value -> path relative to the wiki. The wiki-relative reading wins over the cwd. */
  const pageArg = (p) => {
    const inWiki = (abs) => {
      const rel = posix(path.relative(wikiDir, abs))
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null
    }
    const candidates = [inWiki(path.resolve(wikiDir, p)), inWiki(path.resolve(p))].filter(Boolean)
    if (!candidates.length) throw new UsageError(`--page ${p} is not inside ${posix(wikiDir)}`)
    return candidates.find((rel) => fs.existsSync(path.join(wikiDir, rel))) ?? candidates[candidates.length - 1]
  }
  const targets = pageMode ? opts.pages.map(pageArg) : allPages
  const scan = (rel) => {
    if (!scanned.has(rel)) scanned.set(rel, scanPage(fs.readFileSync(path.join(wikiDir, rel), 'utf8')))
    return scanned.get(rel)
  }
  // Pages every full run writes after the catalogue pages: the landing page and onboarding.
  const LATER_PAGES = new Set(['index.md', ...ONBOARDING_ORDER.map((n) => `onboarding/${n}`)])
  /** A page that exists, or (while pages are still being written) one the run promises. */
  const pageExists = (rel) =>
    onDisk.has(rel) ||
    (acceptPending && LATER_PAGES.has(rel)) ||
    (pageMode && (leafPaths.has(rel) || (rel.endsWith('/index.md') && sectionDirs.has(rel.slice(0, -9)))))

  const kindOf = (rel) => {
    const base = path.posix.basename(rel)
    if (leafPaths.has(rel)) return 'content'
    if (base === 'index.md') return 'hub'
    if (rel.startsWith('onboarding/')) return (rel === `onboarding/${base}` && ONBOARDING_KIND[base]) || 'other'
    if (/^\d+-[^/]*\//.test(rel)) return 'content'
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

    const HTML_HINT = 'this line is in a raw HTML block, where Markdown is off and backticks protect nothing: leave a blank line after the opening tag'
    const checkInterpolation = (n, text, where, fix = 'put it in backticks') => {
      if (/\{\{|\}\}/.test(text) && !/<[a-z][^>]*\sv-pre\b[^>]*>/i.test(text)) {
        error(rel, n, 'interpolation', `\`{{\` or \`}}\` ${where}: Vue evaluates it and the build fails; ${fix}`)
      }
    }
    /** Tag-shaped text, as markdown-it reads it: `<Name>`, `<Name attr>`, `</Name>`. */
    const tagsIn = (text) => [...text.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/?)>/g)]
    const checkTags = (n, text, balance, fix = 'wrap it in backticks') => {
      for (const m of tagsIn(text)) {
        // Case matters: `<A>` in `Promise<A>` is not an anchor to Vue.
        if (!HTML_TAGS.has(m[2])) error(rel, n, 'bare-tag', `${m[0]} is read as an HTML tag; ${fix}`)
        else if (balance && !VOID_TAGS.has(m[2]) && !m[3]) {
          const entry = balance.get(m[2]) ?? balance.set(m[2], { open: 0, line: n, text: m[0] }).get(m[2])
          entry.open += m[1] ? -1 : 1
        }
      }
    }

    // frontmatter
    const fm = page.fm.data
    if (!fm) error(rel, 1, 'frontmatter', 'missing frontmatter block (title, description)')
    else {
      const flagged = new Set(page.fm.issues.map((i) => i.key))
      for (const issue of page.fm.issues) error(rel, 1, 'frontmatter', `${issue.key} ${issue.problem}`)
      for (const key of ['title', 'description']) {
        const value = fm[key]
        if (!value) {
          if (!flagged.has(key)) error(rel, 1, 'frontmatter', `missing ${key}`)
          continue
        }
        // "…reference.undefined" is a script gluing a missing value on; "returns undefined" is prose.
        if (/\S\.undefined\s*$|\[object Object\]/.test(value) || /^(undefined|null|NaN)$/.test(value)) {
          error(rel, 1, 'frontmatter', `${key} contains a script artefact: "…${value.slice(-40)}"`)
        }
        const plain = stripInlineCode(value)
        checkInterpolation(1, plain, `in the ${key}`)
        checkTags(1, plain, null)
      }
      if (fm.title && fm.title.length > TITLE_MAX) {
        error(rel, 1, 'title-length', `title is ${fm.title.length} characters (max ${TITLE_MAX}); it is the sidebar label, so use a name, not a sentence`)
      }
    }

    // prose: interpolation and tag-shaped text
    const balance = new Map()
    for (const { n, text, html } of page.prose) {
      checkInterpolation(n, text, html ? 'in a raw HTML block' : 'outside code', html ? HTML_HINT : undefined)
      checkTags(n, text, balance, html ? HTML_HINT : undefined)
    }
    // GFM splits a table row on every unescaped pipe, even one inside backticks: the code span
    // never forms, the cell breaks in two, and whatever the backticks were hiding reaches Vue.
    // The site still builds (the row just renders wrongly), so this does not stop a --site run.
    for (const { n, text, table } of page.raw) {
      if (!table || opts.site) continue
      for (const m of text.matchAll(INLINE_CODE)) {
        if (/(?<!\\)\|/.test(m[0])) error(rel, n, 'table', `${m[0]} has a | inside inline code in a table row, which splits the cell; escape it as \\|`)
      }
    }
    // VitePress leaves `{{ }}` live in a fence whose language ends in "-vue" (```js-vue).
    for (const block of page.blocks) {
      if (block.lang.endsWith('-vue')) for (const { n, text } of block.lines) checkInterpolation(n, text, `in a ${block.lang} block, where it is not escaped`)
    }
    for (const [tag, entry] of balance) {
      if (entry.open !== 0) error(rel, entry.line, 'bare-tag', `<${tag}> is opened and closed a different number of times; close it, or wrap ${entry.text} in backticks`)
    }

    // mermaid
    const types = new Set()
    let diagrams = 0
    for (const block of page.blocks) {
      if (block.lang !== 'mermaid' && block.lang !== 'mmd') continue
      // The Mermaid plugin renders a fence only when its info string is exactly "mermaid".
      if (block.info !== 'mermaid') {
        error(rel, block.start, 'mermaid', `fence opened with "${block.info}" is not rendered as a diagram; open it with exactly \`\`\`mermaid`)
        continue
      }
      diagrams++
      let body = block.lines.filter((l) => l.text.trim() && !l.text.trim().startsWith('%%'))
      // A diagram may open with its own "---\ntitle: …\n---" block.
      if (body[0]?.text.trim() === '---') {
        const close = body.findIndex((l, i) => i > 0 && l.text.trim() === '---')
        body = close > 0 ? body.slice(close + 1) : []
      }
      const type = (body[0]?.text.trim().split(/[\s:;]+/)[0] ?? '').replace(/^graph$/, 'flowchart')
      if (type) types.add(type)
      else error(rel, block.start, 'mermaid', 'empty diagram')
      if (type === 'sequenceDiagram') {
        if (!body.some((l) => /^\s*autonumber\b/.test(l.text))) error(rel, block.start, 'mermaid', 'sequenceDiagram without autonumber')
        const participants = body.filter((l) => /^\s*(participant|actor)\s/.test(l.text)).length
        if (participants > SEQUENCE_MAX_PARTICIPANTS) {
          warn(rel, block.start, 'mermaid', `${participants} participants (max ${SEQUENCE_MAX_PARTICIPANTS}); split the diagram so it stays readable at page width`)
        }
      }
      for (const { n, text } of block.lines) {
        if (/<br\s*\/>/i.test(text)) error(rel, n, 'mermaid', 'use <br> in labels, not <br/>')
        if (/^\s*%%\{\s*init/.test(text)) warn(rel, n, 'mermaid', 'per-diagram %%{init}%% overrides the site theme; remove it')
        // "rect rgb(255, 255, 255)" paints a background band in a sequence diagram.
        const band = text.match(/^\s*rect\s+((?:rgb|hsl)a?\([^)]*\)|#[0-9a-fA-F]{3,8}\b|[a-zA-Z]+)/)
        if (band) {
          const value = band[1]
          const light = value.startsWith('#')
            ? [3, 6].includes(value.length - 1) && hexLuminance(value.slice(1)) > 0.4
            : value.includes('(')
              ? isLightFunction(value)
              : LIGHT_COLOR_NAMES.has(value.toLowerCase())
          if (light) error(rel, n, 'mermaid', `rect ${value} is a light-mode color; use the dark palette`)
        }
        for (const m of text.matchAll(/\b(fill|stroke|color)\s*:\s*(#[0-9a-fA-F]+\b|(?:rgb|hsl)a?\([^)]*\)|[a-zA-Z]+)/g)) {
          const value = m[2]
          if (!value.startsWith('#')) {
            const light = value.includes('(') ? isLightFunction(value) : LIGHT_COLOR_NAMES.has(value.toLowerCase())
            if (m[1] === 'fill' && light) error(rel, n, 'mermaid', `fill:${value} is a light-mode color; use the dark palette`)
            continue
          }
          const hex = value.slice(1)
          if (hex.length !== 3 && hex.length !== 6) error(rel, n, 'mermaid', `#${hex}: hex colors must have 3 or 6 digits`)
          else if (m[1] === 'fill' && hexLuminance(hex) > 0.4) error(rel, n, 'mermaid', `fill:#${hex} is a light-mode color; use the dark palette`)
        }
      }
      if (!opts.site && kind !== 'other') {
        const after = page.lines.slice(block.end).find((l) => l.trim())
        if (!after || !/^\s*<!--\s*Sources?:/.test(after)) warn(rel, block.end, 'mermaid-sources', 'diagram is not followed by <!-- Sources: ... -->')
      }
    }
    stats.diagrams += diagrams

    // citations
    const cited = new Set()
    /**
     * Record a citation. `level` says how sure we are that the text cites this repository:
     *   'strict'  it does: a missing file is an error, and lines and letter case are verified
     *   'verify'  it may: ignored when the file is missing, verified like 'strict' when it exists
     *   'loose'   a link that could be to another repository: counts when the file exists, no errors
     */
    const cite = (n, candidates, start, end, shown, level = 'strict') => {
      const paths = candidates.map(repoPath).filter(Boolean)
      if (!paths.length) return
      if (!opts.source) {
        if (level === 'strict') cited.add(paths[0])
        return
      }
      const hit = paths.find((c) => linesIn(c) !== null)
      if (!hit) {
        // A link to a folder is a pointer, not a file citation.
        if (level === 'strict' && !paths.some(isRepoFolder)) error(rel, n, 'citation', `cited file not found in the repository: ${shown}`)
        return
      }
      const spelled = trueCase(hit)
      cited.add(spelled)
      if (level === 'loose') return
      if (spelled !== hit) error(rel, n, 'citation', `${shown}: the file is ${spelled}; match its upper and lower case`)
      const count = linesIn(hit)
      if (start === 0) error(rel, n, 'citation', `${shown}: line numbers start at 1`)
      else if (end && end > count) error(rel, n, 'citation', `${shown} cites line ${end} but ${hit} has ${count} lines`)
      else if (start && end && start > end) error(rel, n, 'citation', `${shown}: line range runs backwards`)
    }
    /** A `path:lines` item from prose or a Sources comment. Text that is not clearly a file is ignored. */
    /**
     * How sure we are that a local path names a file: by its name, or because its folder is in
     * the repository ("src/Dockerfle:3" is a typo to report; "library/postgres:16" is an image tag).
     */
    const localLevel = (p) =>
      looksLikeFile(p) || (opts.source && p.includes('/') && isRepoFolder(path.posix.dirname(p))) ? 'strict' : 'verify'
    const citeLocal = (n, item) => {
      const c = parseCitation(item)
      if (!c) return
      const p = repoPath(c.file)
      if (p) cite(n, [p], c.start, c.end, item, localLevel(p))
    }

    // links
    const handleUrl = (n, url, label, isImage) => {
      if (!url || url.startsWith('//')) return // "//host/path" is an external URL
      if (/^https?:\/\//i.test(url)) {
        const src = opts.site ? null : parseSourceUrl(url, repoUrl, branch)
        if (src) cite(n, src.candidates, src.start, src.end, label.trim() || url, repoUrl ? 'strict' : 'loose')
        return
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return // mailto:, tel:, ...
      checkLink(n, url, isImage)
    }
    // Inline links, and reference-style links through their "[ref]: target" definition (lib.mjs).
    // Every definition is checked, used or not: deciding "used" reliably needs a full Markdown parser.
    for (const { n, text } of page.prose) {
      for (const link of inlineLinks(text)) handleUrl(n, link.url, link.label, link.isImage)
      const def = linkDefinition(text)
      if (def) handleUrl(n, def.url, def.label, false)
    }

    function checkLink(n, url, isImage) {
      const hashAt = url.indexOf('#')
      const target = safeDecode((hashAt < 0 ? url : url.slice(0, hashAt)).split('?')[0])
      const anchor = hashAt < 0 ? '' : url.slice(hashAt + 1)
      let dest = rel
      if (target) {
        dest = target.startsWith('/') ? target.replace(/^\/+/, '') : path.posix.normalize(path.posix.join(dir, target))
        dest = dest === '.' ? '' : dest.replace(/^\.\//, '')
        const ext = path.posix.extname(dest).slice(1).toLowerCase()
        const isAsset = ext !== '' && ASSET_EXTENSIONS.has(ext)
        // README, AGENTS and CLAUDE files are kept out of the build, wherever they are.
        if (NOT_A_PAGE_LINK.test(dest)) {
          error(rel, n, 'link', `${url} is not part of the site; cite the file instead of linking it`)
          return
        }
        if (dest === '..' || dest.startsWith('../')) {
          // Whatever the file type: the site either reports a dead link or ships a link that 404s.
          error(rel, n, 'link', `${url} leaves the wiki; cite the file with a repository URL or plain text instead`)
          return
        }
        if (isAsset) {
          const inWiki = fs.existsSync(path.join(wikiDir, dest))
          const inPublic = fs.existsSync(path.join(wikiDir, 'public', dest))
          if (target.startsWith('/')) {
            // A site-root path is served from public/ and from nowhere else.
            if (!inPublic) {
              error(rel, n, 'link', inWiki ? `${url} is a site-root path, but the file is not in public/; move it to public/${dest} or link it with a relative path` : `broken link ${url} (no public/${dest})`)
            }
          } else if (!inWiki) {
            // A file in public/ is served from the site root; a relative path to it resolves nowhere.
            if (inPublic) error(rel, n, 'link', `${url} exists only in public/; link it from the site root as /${dest}`)
            else error(rel, n, 'link', `broken link ${url} (no ${dest})`)
          } else if (!isImage) {
            // The build bundles embedded images; a plain link to any other file is not copied to the site.
            warn(rel, n, 'link', `${url} is a file the site does not publish (only pages and embedded images are); put it in public/ and link it from the site root`)
          }
          return
        }
        const isFolderLink = dest === '' || target.endsWith('/')
        if (isFolderLink) dest = dest === '' ? 'index.md' : `${dest.replace(/\/+$/, '')}/index.md`
        else if (ext === 'html') dest = dest.replace(/\.html$/i, '.md')
        else if (ext !== 'md') {
          // VitePress resolves "./section" to section.md only; it adds index only after a slash.
          if (!pageExists(`${dest}.md`) && pageExists(`${dest}/index.md`)) {
            error(rel, n, 'link', `${url} is a folder link without a trailing slash, which the site build reports as dead; link ${url}/index.md`)
            return
          }
          dest = `${dest}.md`
        }
        // ".." and "." reach a folder without the slash VitePress needs.
        if (isFolderLink && !target.endsWith('/') && pageExists(dest)) {
          error(rel, n, 'link', `${url} is a folder link without a trailing slash, which the site build reports as dead; link ${url}/index.md`)
          return
        }
        if (!pageExists(dest)) {
          // Without a catalogue (crisp runs) a sibling may simply not be written yet.
          const pending = pageMode && !catalogue
          add(pending ? 'warn' : 'error', rel, n, 'link', `broken link ${url} (no ${dest})${pending ? '; fine if that page is still being written' : ''}`)
          return
        }
      }
      if (anchor && dest.endsWith('.md') && onDisk.has(dest) && !scan(dest).slugs.has(safeDecode(anchor).toLowerCase())) {
        warn(rel, n, 'anchor', `${url}: no heading in ${dest} matches #${anchor}`)
      }
    }

    if (!opts.site) {
      // Local-host citations: "(src/a.ts:42-58)", "(src/a.ts:1, src/b.ts:2)", "(`src/a.ts:42`)".
      const GROUP = /\(((?:[^()]|\([^()]*\))*)\)/g
      for (let i = 0; i < page.prose.length; i++) {
        const { n, text } = page.prose[i]
        for (const m of text.matchAll(GROUP)) for (const item of m[1].split(/[,;]\s*/)) citeLocal(n, item.trim())
        for (const m of page.raw[i].text.matchAll(/\(`([^`\s]+)`\)/g)) citeLocal(n, m[1])
      }
      for (const { n, items } of page.sources) {
        for (const item of items) {
          if (parseCitation(item)) citeLocal(n, item)
          else if (!/\s/.test(item) && repoPath(item) && localLevel(repoPath(item)) === 'strict') cite(n, [item], null, null, item)
        }
      }

      // thresholds
      // A page may declare `depth: crisp` in its frontmatter: a crisp page inside a full wiki.
      const depth = fm?.depth === 'crisp' ? 'crisp' : opts.mode
      const t = THRESHOLDS[depth][kind]
      if (t) {
        const what = kind === 'content' ? 'page' : 'onboarding guide'
        if (diagrams < t.diagrams) error(rel, 0, 'threshold', `${diagrams} Mermaid diagram(s); a ${depth} ${what} needs at least ${t.diagrams}`)
        if (types.size < t.types) error(rel, 0, 'threshold', `${types.size} diagram type(s); a ${depth} ${what} needs at least ${t.types}`)
        let files = Math.min(t.files, minFiles.get(rel) ?? t.files)
        // Never ask for more files than the repository has (only knowable when it is here to read).
        if (opts.source && files > 0) files = Math.min(files, sourceFileCap())
        if (cited.size < files) error(rel, 0, 'threshold', `cites ${cited.size} distinct source file(s); a ${depth} ${what} needs at least ${files}`)
      }

      // tables
      // Local citations keep the full path, so a long `path:line` is expected in a local wiki.
      const exemptToken = (token) => site.host === 'local' && parseCitation(token.replace(/^[(`]+|[)`.,;]+$/g, '')) !== null
      for (let i = 0; i < page.raw.length - 1; i++) {
        const head = page.raw[i]
        if (!/^\s*\|.*\|\s*$/.test(head.text) || !isDelimiterRow(page.raw[i + 1].text)) continue
        if (i > 0 && /^\s*\|/.test(page.raw[i - 1].text)) continue // not the header row
        const cols = stripInlineCode(head.text).replace(/\\\|/g, '').trim().replace(/^\||\|$/g, '').split('|').length
        if (cols > TABLE_MAX_COLS) warn(rel, head.n, 'table', `${cols} columns (max ${TABLE_MAX_COLS}); split the table or merge columns`)
        let longest = ''
        for (let j = i + 2; j < page.raw.length && /^\s*\|/.test(page.raw[j].text); j++) {
          const visible = page.raw[j].text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '')
          for (const token of visible.split(/[\s|]+/)) if (token.length > longest.length && !exemptToken(token)) longest = token
        }
        if (longest.length > TOKEN_MAX) warn(rel, head.n, 'table', `unbreakable ${longest.length}-character cell text "${longest}"; shorten it (file name, not full path)`)
      }
    }
    page.cited = cited
    page.diagrams = diagrams
  }

  if (pageMode) return finish()

  // ---- whole-wiki checks ----------------------------------------------------
  const config = path.join(wikiDir, '.vitepress', 'config.mts')
  if (fs.existsSync(config)) {
    const left = readText(config).match(/'__[A-Z_]+__'/g)
    if (left) error('.vitepress/config.mts', 0, 'placeholder', `unfilled placeholder(s): ${[...new Set(left)].join(', ')}`)
  }
  const pkg = path.join(wikiDir, 'package.json')
  if (fs.existsSync(pkg) && readText(pkg).includes('__PACKAGE_NAME__')) {
    error('package.json', 0, 'placeholder', 'unfilled placeholder: __PACKAGE_NAME__')
  }
  if (!onDisk.has('index.md') && !opts.pending) error('index.md', 0, 'landing', 'the wiki has no landing page (index.md)')

  if (catalogue && !opts.site) {
    for (const p of leafPaths) if (!onDisk.has(p)) error('catalogue.json', 0, 'catalogue-drift', `catalogue page ${p} was never written`)
    const topDirs = new Set([...sectionDirs].map((d) => d.split('/')[0]))
    for (const rel of allPages) {
      const top = rel.split('/')[0]
      if (!/^\d+-/.test(top) || !rel.includes('/')) continue
      if (!topDirs.has(top)) warn(rel, 0, 'catalogue-drift', `stale: section folder ${top}/ is not in the catalogue`)
      else if (rel.endsWith('/index.md')) {
        if (!sectionDirs.has(rel.slice(0, -9))) warn(rel, 0, 'catalogue-drift', 'stale: this index belongs to a folder that is not a catalogue section')
      } else if (!leafPaths.has(rel)) warn(rel, 0, 'catalogue-drift', 'page is not in the catalogue')
    }
    for (const d of sectionDirs) {
      if (!onDisk.has(`${d}/index.md`)) warn(`${d}/index.md`, 0, 'section-index', 'section has no index.md; run `node wiki/scripts/gen-section-indexes.mjs wiki`')
    }
  }

  // The llms files are regenerated after the pages: a run that is still writing pages skips them.
  if (!opts.site && !opts.pending) {
    const llms = [
      ['llms.txt', path.join(wikiDir, 'llms.txt'), wikiDir],
      ['public/llms.txt', path.join(wikiDir, 'public', 'llms.txt'), null],
      ['../llms.txt', path.join(repoRoot, 'llms.txt'), repoRoot],
    ]
    const siteBase = site.base
    const isExternal = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')
    /** Why a link in a deployed (public/) copy is not a working site route, or null when it is one. */
    const routeProblem = (url) => {
      if (isExternal(url)) return null
      if (!url.startsWith('/')) return 'is a relative link; the deployed copy needs a site route'
      const target = safeDecode(url.split(/[?#]/)[0])
      if (!target.startsWith(siteBase)) return `is outside the site base ${siteBase}`
      const route = target.slice(siteBase.length)
      if (/\.(md|html)$/i.test(route)) return 'must be a clean route (no .md or .html)'
      if (route === '' || route.endsWith('/')) return onDisk.has(`${route}index.md`) ? null : `has no page (${route}index.md)`
      return onDisk.has(`${route}.md`) || fs.existsSync(path.join(wikiDir, 'public', route)) ? null : `has no page (${route}.md)`
    }
    for (const [label, file, base] of llms) {
      if (!fs.existsSync(file)) continue
      const text = readText(file)
      if (label === '../llms.txt' && (!isMarked(text) || path.resolve(file) === path.resolve(wikiDir, 'llms.txt'))) continue // not ours, or the wiki is the repo root
      const bytes = Buffer.byteLength(text)
      if (bytes > LLMS_MAX_BYTES) warn(label, 0, 'llms', `${(bytes / 1024).toFixed(1)} KB; keep llms.txt under 5 KB (shorter descriptions, fewer optional links)`)
      text.split(/\r?\n/).forEach((line, i) => {
        if (!/^\s*-\s*\[/.test(line)) return
        const m = line.match(/^- \[([^\]]+)\]\(([^)\s]+)\)(?:: \S.*)?$/)
        if (!m || m[1] !== m[1].trim()) return error(label, i + 1, 'llms', 'link line must be exactly `- [Title](url): description`')
        if (label === 'public/llms.txt') {
          const problem = routeProblem(m[2])
          if (problem) error(label, i + 1, 'llms', `${m[2]} ${problem}`)
        } else if (base && !/^[a-z][a-z0-9+.-]*:|^\//i.test(m[2])) {
          const target = path.resolve(base, safeDecode(m[2].split('#')[0]))
          if (!fs.existsSync(target)) error(label, i + 1, 'llms', `links to ${m[2]}, which does not exist`)
        }
      })
    }

    // llms-full.txt inlines every page; its deployed copy uses site routes.
    for (const label of ['llms-full.txt', 'public/llms-full.txt']) {
      const file = path.join(wikiDir, label)
      if (!fs.existsSync(file)) continue
      const text = readText(file)
      // gen-llms escapes <, >, & and " in the attributes, so the first ">" ends the tag.
      const inlined = new Set([...text.matchAll(/^<doc\b[^>\n]*\spath="([^"\n]+)"[^>\n]*>/gm)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')))
      const absent = allPages.filter((p) => !inlined.has(p))
      if (absent.length) {
        const shown = `${absent.slice(0, 5).join(', ')}${absent.length > 5 ? ', …' : ''}`
        error(label, 0, 'llms', `${absent.length} page(s) have no <doc> block (${shown}); run \`node wiki/scripts/gen-llms.mjs wiki\``)
      }
      // Same links gen-llms rewrites: inline ones and "[ref]: target" definitions.
      const fullProse = scanPage(text).prose
      for (const { n, text: line } of fullProse) {
        const def = linkDefinition(line)
        const defUrls = def ? [def.url] : []
        for (const url of [...inlineLinks(line).map((l) => l.url), ...defUrls]) {
          if (label.startsWith('public/')) {
            const problem = routeProblem(url)
            if (problem) error(label, n, 'llms', `${url} ${problem}`)
          } else if (!isExternal(url)) {
            const target = safeDecode(url.split(/[?#]/)[0])
            const resolved = target.startsWith('/') ? path.join(wikiDir, target) : path.resolve(wikiDir, target)
            const served = target.startsWith('/') && fs.existsSync(path.join(wikiDir, 'public', target))
            if (target && !served && !fs.existsSync(resolved) && !fs.existsSync(resolved + '.md')) error(label, n, 'llms', `links to ${url}, which does not exist`)
          }
        }
      }
    }

  }
  if (!opts.site && opts.baseline) checkLeftovers()

  function checkLeftovers() {
    /** `git status --porcelain` text -> Map(file -> status). */
    const parse = (text) => {
      const entries = new Map()
      for (const line of text.split(/\r?\n/)) {
        if (line.length < 4 || line.startsWith('#')) continue
        const file = line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')
        entries.set(file, line.slice(0, 2))
      }
      return entries
    }
    let saved
    try {
      saved = fs.readFileSync(opts.baseline)
    } catch {
      return error(posix(opts.baseline), 0, 'baseline', 'baseline file not found, so leftovers cannot be told from files that were already there; delete nothing')
    }
    // PowerShell 5.1 `>` writes UTF-16; read as UTF-8 it would look like "no files existed before".
    if ((saved[0] === 0xff && saved[1] === 0xfe) || (saved[0] === 0xfe && saved[1] === 0xff) || saved.includes(0)) {
      return error(posix(opts.baseline), 0, 'baseline', 'baseline file is not UTF-8 text; write it with --write-baseline and delete nothing')
    }
    let now
    try {
      now = gitStatus(repoRoot)
    } catch {
      return warn(posix(opts.baseline), 0, 'baseline', 'git status failed, so the leftover check was skipped')
    }
    const before = parse(saved.toString('utf8'))
    // `git status` paths are relative to the git top level, which is not always --repo.
    const wikiRel = relativeInside(gitTopLevel(repoRoot) ?? repoRoot, wikiDir)
    const inWiki = (file) => (wikiRel === '' ? file : wikiRel !== null && file.startsWith(`${wikiRel}/`) ? file.slice(wikiRel.length + 1) : null)
    const expected = /(^|\/)(AGENTS\.md|CLAUDE\.md|llms(-full)?\.txt)$|^\.github\/workflows\/deploy-wiki\.yml$/
    const wikiOutput = /\.md$|^(catalogue\.json|llms(-full)?\.txt|package(-lock)?\.json|\.gitignore|\.deep-wiki(-llms)?\.json)$|^(\.vitepress|scripts|public|node_modules)\//
    for (const [file, status] of parse(now)) {
      const known = before.has(file) || [...before.keys()].some((b) => b.endsWith('/') && file.startsWith(b))
      if (known || expected.test(file)) continue
      const wikiFile = inWiki(file)
      if (wikiFile !== null) {
        if (!wikiOutput.test(wikiFile)) warn(file, 0, 'leftover', 'file appeared in the wiki folder during the run and is not a wiki output; ask before deleting it')
      } else if (status === '??') {
        warn(file, 0, 'leftover', 'file appeared during the run and is not a wiki output; ask before deleting it')
      } else {
        warn(file, 0, 'leftover', 'tracked file changed during the run; the source repository is meant to stay untouched')
      }
    }
  }

  return finish()

  function finish() {
    // Nothing the wiki or the catalogue names exists here: this is not the source repository. Say so once.
    const notFound = (f) => f.rule === 'citation' && f.message.startsWith('cited file not found')
    const missing = findings.filter(notFound).length
    if (missing >= 10 && !resolvedAnyFile) {
      for (let i = findings.length - 1; i >= 0; i--) {
        if (notFound(findings[i]) || (findings[i].rule === 'threshold' && /distinct source/.test(findings[i].message))) findings.splice(i, 1)
      }
      error('.', 0, 'citation', `none of the ${missing} cited files exist under ${posix(repoRoot)}; pass --repo <path to the source repository>`)
    }
    const errors = findings.filter((f) => f.level === 'error')
    const warnings = findings.filter((f) => f.level === 'warn')
    const checked = [...scanned].filter(([, p]) => p.cited)
    const pages = checked.map(([file, p]) => ({ file, diagrams: p.diagrams, citedFiles: p.cited.size }))
    // Per section: distinct cited files, so a file cited by three pages counts once.
    const groups = new Map()
    // Rows are labelled with the section's catalogue name; the folder name is the fallback.
    const sectionNames = new Map()
    for (const node of Array.isArray(catalogue?.items) ? catalogue.items : []) {
      if (node && typeof node.dir === 'string' && typeof node.name === 'string' && node.name.trim()) {
        sectionNames.set(node.dir.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, ''), node.name.trim())
      }
    }
    for (const [file, p] of checked) {
      const key = file.includes('/') ? file.split('/')[0] : '(root)'
      const label = sectionNames.get(key) ?? (key === 'onboarding' ? 'Onboarding' : key)
      const g = groups.get(key) ?? groups.set(key, { section: label, pages: 0, diagrams: 0, files: new Set() }).get(key)
      g.pages++
      g.diagrams += p.diagrams
      for (const f of p.cited) g.files.add(f)
    }
    const all = new Set(checked.flatMap(([, p]) => [...p.cited]))
    const report = [...groups.values()].map((g) => ({ section: g.section, pages: g.pages, diagrams: g.diagrams, citedFiles: g.files.size }))
    report.push({ section: 'Total', pages: checked.length, diagrams: stats.diagrams, citedFiles: all.size })
    // No --repo, no recorded root, no git: the parent folder was used, which may not be the repository.
    const notes = []
    if (repoRootGuessed && opts.source && !opts.site && !opts.catalogueOnly) {
      notes.push(`no repository root is known (no --repo, no recorded root, not in git): citations were checked against ${posix(repoRoot)}`)
    }
    return { ok: errors.length === 0, mode: opts.mode, errors, warnings, stats, pages, report, repoRoot: posix(repoRoot), notes }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2)
  const wantsJson = argv.includes('--json')
  try {
    const opts = parseArgs(argv)
    if (opts.writeBaseline) {
      const file = writeBaseline(opts)
      console.log(opts.json ? JSON.stringify({ ok: true, baseline: posix(file) }) : `baseline written to ${posix(file)}`)
      return 0
    }
    const result = checkWiki(opts)
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
      return result.ok ? 0 : 1
    }
    const print = (f) => console.log(`  ${f.level === 'error' ? 'error' : 'warn '}  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}] ${f.message}`)
    result.errors.forEach(print)
    result.warnings.forEach(print)
    if (opts.report) {
      console.log('\n| Section | Pages | Diagrams | Cited files |\n|---------|-------|----------|-------------|')
      for (const r of result.report) console.log(`| ${r.section} | ${r.pages} | ${r.diagrams} | ${r.citedFiles} |`)
    }
    const s = result.stats
    console.log(
      `\n${result.mode} | catalogue: ${s.sections} section(s), ${s.leaves} page(s) | checked ${s.pages} page(s), ${s.diagrams} diagram(s) | ` +
        `${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
    )
    for (const note of result.notes) console.log(`note: ${note}`)
    return result.ok ? 0 : 1
  } catch (e) {
    // Bad options and unreadable inputs are not findings: exit 2 so callers can tell them apart.
    const message = e instanceof UsageError || e?.code ? e.message : `internal error: ${e?.stack ?? e}`
    if (wantsJson) console.log(JSON.stringify({ ok: false, error: message }))
    else console.error(message)
    return 2
  }
}

function isMain() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) process.exitCode = main()
