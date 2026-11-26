#!/usr/bin/env node
// Builds the llms files from the wiki pages. The pages are the source; nothing is written by hand.
//
// Usage: node wiki/scripts/gen-llms.mjs [wikiDir] [--input <file.json>] [--force] [--repo <path>] [--json]
//   --input <file>  judgment the pages cannot supply (every key optional):
//                   {
//                     "summary": "one dense paragraph: what the project does, for whom, with what",
//                     "context": ["extra paragraphs: constraints and non-obvious facts"],
//                     "optional": ["page paths (wiki-relative) or repo files to list under ## Optional"],
//                     "descriptions": { "<page path>": "one-sentence description that replaces the page's own" }
//                   }
//                   Default: <wiki>/.deep-wiki-llms.json when that file exists. With no input at all:
//                   the catalogue summary and each page's frontmatter description.
//   --force         replace a repository-root llms.txt that lacks the deep-wiki marker
//   --repo <path>   repository root (default: the root the state file records, else the git top level)
//
// Writes:
//   <repo>/llms.txt              links into the wiki folder; skipped when it exists without the marker,
//                                and when no repository root is known (it is never guessed)
//   <wiki>/llms.txt              wiki-relative .md links
//   <wiki>/llms-full.txt         every page inlined in a <doc> block, relative links rebased to the wiki root
//   <wiki>/public/llms.txt       \ the same two files with wiki links rewritten to site routes under `base`
//   <wiki>/public/llms-full.txt  / (only when the wiki has a site: .vitepress/config.mts exists)
// Each llms.txt stays under 5 KB: descriptions are shortened, then sections collapse to their index page,
// then pages move to ## Optional, then Optional entries are left out. llms-full.txt always has every page.
// Exit code 0 on success, 2 on a usage or I/O error.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertInside,
  MARKER,
  ONBOARDING_ORDER,
  createFenceScanner,
  isMarked,
  listPages,
  loadCatalogue,
  loadState,
  parseFrontmatter,
  posix,
  readConfigConst,
  readText,
  relativeInside,
  resolveDir,
  resolveRepoRoot,
  resolveSite,
  inlineLinks,
  linkDefinition,
} from './lib.mjs'

const MAX_BYTES = 5 * 1024
const DEFAULT_INPUT = '.deep-wiki-llms.json'
const INLINE_CODE = /(`+)(?:(?!\1).)+\1/g
// Headings this script adds itself, with the name each falls back to when a catalogue section already uses it.
const BUILT_IN_FALLBACK = { 'Start Here': 'Landing Page', Onboarding: 'Onboarding Guides', More: 'Other Pages' }

export class UsageError extends Error {}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
const encodePath = (p) => p.replace(/[ ()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const titleCase = (dir) =>
  path.posix
    .basename(dir)
    .replace(/^\d+-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** A description cut at its first sentence-level break, then at a comma or a word if it is still long. */
function firstClause(text) {
  const LIMIT = 90
  const cut = text.search(/[.;:]\s|\s[—–-]\s|\s\(/)
  let out = cut >= 20 ? text.slice(0, cut) : text
  if (out.length > LIMIT) {
    const comma = out.lastIndexOf(', ', LIMIT)
    out = comma >= 30 ? out.slice(0, comma) : out.slice(0, LIMIT).replace(/\s+\S*$/, '')
  }
  return out.replace(/[\s.,;:]+$/, '')
}

export function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    let inline
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
    if (a === '--input' || a === '--repo') {
      const value = inline ?? argv[++i]
      if (!value || (inline === undefined && value.startsWith('--'))) throw new UsageError(`${a} needs a value`)
      opts[a.slice(2)] = value
    } else if (a === '--force' || a === '--json') {
      if (inline !== undefined) throw new UsageError(`${a} takes no value`)
      opts[a.slice(2)] = true
    } else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`)
    else if (opts.wikiDir === undefined) opts.wikiDir = a
    else throw new UsageError(`Unexpected argument ${a} (the wiki folder is already ${opts.wikiDir})`)
  }
  return opts
}

function readInput(file) {
  let data
  try {
    data = JSON.parse(readText(path.resolve(file)))
  } catch (e) {
    throw new UsageError(`cannot read the llms input ${posix(file)}: ${e.message}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UsageError('the llms input must be a JSON object')
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
  if (data.summary !== undefined && typeof data.summary !== 'string') throw new UsageError('llms input: "summary" must be a string')
  if (data.context !== undefined && !strings(data.context)) throw new UsageError('llms input: "context" must be an array of strings')
  if (data.optional !== undefined && !strings(data.optional)) throw new UsageError('llms input: "optional" must be an array of strings')
  if (data.descriptions !== undefined && (!data.descriptions || typeof data.descriptions !== 'object' || Array.isArray(data.descriptions))) {
    throw new UsageError('llms input: "descriptions" must be an object of page path to text')
  }
  return data
}

/** Body lines with a flag for the ones inside (or delimiting) a code fence. */
function* bodyLines(text) {
  const fenceAt = createFenceScanner()
  for (const line of text.split('\n')) yield { line, code: fenceAt(line).kind !== 'text' }
}


export function genLlms(options) {
  const wikiDir = path.resolve(options.wikiDir ?? '.')
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) throw new UsageError(`wiki folder not found: ${posix(wikiDir)}`)
  const state = loadState(wikiDir)
  const notes = []

  // --repo, else the root the state file records, else the git top level. Null when none is
  // known: the parent folder is never guessed, and the root llms.txt is then not written.
  const repoRoot = resolveRepoRoot(wikiDir, { repo: options.repo, state }).root
  // '' when the wiki folder is the repository root; null when no repository root is known.
  const wikiRel = repoRoot ? relativeInside(repoRoot, wikiDir) : null
  if (repoRoot && wikiRel === null) throw new UsageError(`${posix(wikiDir)} is not inside the repository root ${posix(repoRoot)}`)

  let inputFile = options.input
  if (!inputFile && fs.existsSync(path.join(wikiDir, DEFAULT_INPUT))) {
    inputFile = path.join(wikiDir, DEFAULT_INPUT)
    notes.push(`read the summary and descriptions from ${DEFAULT_INPUT}`)
  }
  const input = inputFile ? readInput(inputFile) : {}

  const { hasSite, base, repoUrl, branch, host } = resolveSite(wikiDir, state)

  let catalogue = null
  try {
    catalogue = loadCatalogue(wikiDir)
  } catch (e) {
    throw new UsageError(`catalogue.json is not valid JSON: ${e.message}`)
  }

  // ---- pages -----------------------------------------------------------------
  const paths = listPages(wikiDir)
  const pageSet = new Set(paths)
  const pages = new Map()
  for (const rel of paths) {
    const text = readText(path.join(wikiDir, rel)).replace(/\r\n/g, '\n')
    const fm = parseFrontmatter(text)
    const body = text.split('\n').slice(fm.lineCount).join('\n').trim()
    let h1 = ''
    for (const { line, code } of bodyLines(body)) {
      const m = code ? null : line.match(/^#\s+(.+?)\s*#*\s*$/)
      if (m) {
        h1 = m[1]
        break
      }
    }
    const title = oneLine(fm.data?.title || h1 || path.posix.basename(rel, '.md')).replace(/[[\]]/g, '')
    const description = oneLine(input.descriptions?.[rel] ?? input.descriptions?.[`./${rel}`] ?? fm.data?.description)
    pages.set(rel, { path: rel, title, description, body })
  }

  // ---- sections --------------------------------------------------------------
  const optionalPages = []
  const optionalFiles = []
  for (const raw of input.optional ?? []) {
    const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '')
    if (pageSet.has(rel)) optionalPages.push(rel)
    else if (repoRoot && fs.existsSync(path.join(repoRoot, rel)) && fs.statSync(path.join(repoRoot, rel)).isFile()) optionalFiles.push(rel)
    else notes.push(`optional entry ${raw} is neither a wiki page nor a repository file; left out`)
  }
  const taken = new Set(optionalPages)
  // A section is identified by its object, never by its name: two sections may share a name.
  const sections = []
  const addSection = (name, list, index, builtIn = false) => {
    const own = [...new Set(list)].filter((p) => pageSet.has(p) && !taken.has(p))
    own.forEach((p) => taken.add(p))
    if (own.length) sections.push({ name, heading: name, builtIn, pages: own, index: index && own.includes(index) ? index : null })
  }
  const under = (dir) => paths.filter((p) => p.startsWith(`${dir}/`))

  // The landing page leads; `More` is kept for other root pages (changelog.md and the like).
  addSection('Start Here', ['index.md'], null, true)

  const onboarding = under('onboarding')
  const ordered = ONBOARDING_ORDER.map((f) => `onboarding/${f}`)
  addSection('Onboarding', [...ordered, ...onboarding.filter((p) => !ordered.includes(p))], 'onboarding/index.md', true)

  const walkSection = (node, dir, out) => {
    out.push(`${dir}/index.md`)
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (!child || typeof child !== 'object') continue
      if (typeof child.path === 'string') out.push(child.path.replace(/\\/g, '/'))
      else if (typeof child.dir === 'string') walkSection(child, resolveDir(child, dir), out)
    }
    return out
  }
  for (const node of Array.isArray(catalogue?.items) ? catalogue.items : []) {
    if (!node || typeof node !== 'object' || typeof node.dir !== 'string') continue
    const dir = resolveDir(node, '')
    addSection(oneLine(node.name) || titleCase(dir), [...walkSection(node, dir, []), ...under(dir)], `${dir}/index.md`)
  }
  const folders = [...new Set(paths.filter((p) => p.includes('/')).map((p) => p.split('/')[0]))]
  const numbered = folders.filter((f) => /^\d+-/.test(f)).sort()
  for (const dir of [...numbered, ...folders.filter((f) => !/^\d+-/.test(f)).sort()]) {
    const index = `${dir}/index.md`
    const name = /^\d+-/.test(dir) && pages.has(index) && pages.get(index).title.length <= 60 ? pages.get(index).title : titleCase(dir)
    addSection(name, [index, ...under(dir)], index)
  }
  addSection('More', paths.filter((p) => !p.includes('/')), null, true)

  // Headings must be unique, and `## Optional` has a meaning of its own in llms.txt. The wiki's
  // own section names win; a heading this script adds steps aside for them.
  const usedHeadings = new Set(['optional'])
  const claim = (name) => {
    let heading = name
    for (let n = 2; usedHeadings.has(heading.toLowerCase()); n++) heading = `${name} (${n})`
    usedHeadings.add(heading.toLowerCase())
    return heading
  }
  for (const s of sections.filter((x) => !x.builtIn)) s.heading = claim(s.name)
  for (const s of sections.filter((x) => x.builtIn)) s.heading = claim(usedHeadings.has(s.name.toLowerCase()) ? BUILT_IN_FALLBACK[s.name] : s.name)

  const project = oneLine(catalogue?.project || readConfigConst(wikiDir, 'SITE_TITLE') || path.basename(repoRoot ?? wikiDir))
  const summary = oneLine(input.summary ?? catalogue?.summary ?? readConfigConst(wikiDir, 'SITE_DESCRIPTION'))
  const context = (input.context ?? []).map(oneLine).filter(Boolean)
  if (!summary) notes.push(`no summary: add a "summary" to ${DEFAULT_INPUT}, or to catalogue.json`)
  const header = [`# ${project}`, MARKER, '', ...(summary ? [`> ${summary}`, ''] : []), ...context.flatMap((p) => [p, ''])]

  // ---- link targets ----------------------------------------------------------
  const route = (rel) => {
    if (rel === 'index.md') return base
    if (rel.endsWith('/index.md')) return `${base}${encodePath(rel.slice(0, -8))}`
    return `${base}${encodePath(rel.replace(/\.md$/, ''))}`
  }
  /** A link to a repository file on the git host, or null when the host, branch, or path is unknown. */
  const blob = (repoPath) => {
    if (!repoPath || !repoUrl || !branch || repoPath.startsWith('..')) return null
    const p = encodePath(repoPath)
    if (host === 'github') return `${repoUrl}/blob/${branch}/${p}`
    if (host === 'gitlab') return `${repoUrl}/-/blob/${branch}/${p}`
    if (host === 'azure-devops') return `${repoUrl}?path=/${p}&version=GB${branch}`
    return null
  }
  /** A wiki-relative path as a repository path; null when the repository root is unknown. */
  const inRepo = (wikiPath) => (wikiRel === null ? null : path.posix.normalize(path.posix.join(wikiRel || '.', wikiPath)))
  const VARIANTS = {
    root: { page: (rel) => `./${encodePath(path.posix.join(wikiRel ?? '', rel))}`, file: (repoPath) => `./${encodePath(repoPath)}` },
    wiki: { page: (rel) => `./${encodePath(rel)}`, file: (repoPath) => encodePath(path.posix.relative(wikiRel || '.', repoPath)) },
    public: { page: route, file: blob },
  }

  // ---- llms.txt ----------------------------------------------------------------
  /** plan: { short, collapsed: Set<section>, demoted: Set<section>, dropped: number } */
  const renderIndex = (variant, plan) => {
    const v = VARIANTS[variant]
    const describe = (p) => (plan.short ? firstClause(p.description) : p.description)
    const entry = (p, bare) => `- [${p.title}](${v.page(p.path)})${!bare && describe(p) ? `: ${describe(p)}` : ''}`
    const lines = [...header]
    const optional = optionalPages.map((rel) => entry(pages.get(rel), false))
    for (const repoPath of optionalFiles) {
      const url = v.file(repoPath)
      if (url) optional.push(`- [${path.posix.basename(repoPath)}](${url})`)
    }
    for (const s of sections) {
      if (plan.demoted.has(s)) {
        optional.push(...s.pages.map((rel) => entry(pages.get(rel), true)))
        continue
      }
      const list = plan.collapsed.has(s) ? [s.index] : s.pages
      lines.push(`## ${s.heading}`, '', ...list.map((rel) => entry(pages.get(rel), false)), '')
    }
    const kept = optional.slice(0, Math.max(0, optional.length - plan.dropped))
    if (kept.length) lines.push('## Optional', '', ...kept, '')
    return `${lines.join('\n').trimEnd()}\n`
  }
  const indexVariants = ['wiki', ...(wikiRel ? ['root'] : []), ...(hasSite ? ['public'] : [])]
  const plan = { short: false, collapsed: new Set(), demoted: new Set(), dropped: 0 }
  const tooBig = () => indexVariants.some((v) => Buffer.byteLength(renderIndex(v, plan)) > MAX_BYTES)
  if (tooBig()) {
    plan.short = true
    if (!tooBig()) notes.push('over 5 KB: descriptions shortened to their first clause')
    else {
      const collapsible = sections.filter((s) => s.index && s.pages.length > 1).sort((a, b) => b.pages.length - a.pages.length)
      for (const s of collapsible) {
        if (!tooBig()) break
        plan.collapsed.add(s)
      }
      for (const s of [...sections].reverse()) {
        if (!tooBig()) break
        if (!plan.collapsed.has(s)) plan.demoted.add(s)
      }
      const optionalCount = optionalPages.length + optionalFiles.length + [...plan.demoted].reduce((n, s) => n + s.pages.length, 0)
      while (tooBig() && plan.dropped < optionalCount) plan.dropped++
      const names = (set) => [...set].map((s) => s.heading).join(', ')
      const did = ['descriptions shortened']
      if (plan.collapsed.size) did.push(`${plan.collapsed.size} section(s) reduced to their index page (${names(plan.collapsed)})`)
      if (plan.demoted.size) did.push(`${plan.demoted.size} section(s) moved to Optional without descriptions (${names(plan.demoted)})`)
      if (plan.dropped) did.push(`${plan.dropped} Optional entr${plan.dropped === 1 ? 'y' : 'ies'} left out`)
      notes.push(`over 5 KB: ${did.join('; ')}. llms-full.txt still has every page.`)
      if (tooBig()) notes.push(`still over 5 KB: shorten the "summary" and "context" in ${DEFAULT_INPUT}`)
    }
  }

  // ---- llms-full.txt -----------------------------------------------------------
  const inPublic = (file) => fs.existsSync(path.join(wikiDir, 'public', file))
  /** Rewrite one relative link target. Returns the new URL, or null to drop the link and keep its text. */
  const rewrite = (url, pageRel, variant) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) return url
    // "/x" is relative to the wiki root in a page; only the deployed copy needs it turned into a route.
    if (url.startsWith('/') && variant === 'wiki') return url
    const cut = url.search(/[?#]/)
    const target = cut < 0 ? url : url.slice(0, cut)
    const suffix = cut < 0 ? '' : url.slice(cut)
    if (!target) return url
    let dest = target.startsWith('/')
      ? path.posix.normalize(target.replace(/^\/+/, '') || '.')
      : path.posix.normalize(path.posix.join(path.posix.dirname(pageRel), target))
    dest = dest === '.' || dest === './' ? '' : dest
    const outside = dest === '..' || dest.startsWith('../')
    if (variant === 'wiki') {
      if (outside) return `${dest}${suffix}`
      // A page linked by its built name (alpha.html) is that page's .md file here.
      const md = safeDecode(dest).replace(/\.html$/i, '.md')
      return /\.html$/i.test(dest) && pageSet.has(md) ? `./${encodePath(md)}${suffix}` : `./${dest}${suffix}`
    }

    const hostLink = (repoPath) => {
      const link = blob(repoPath)
      return link ? `${link}${host === 'azure-devops' ? '' : suffix}` : null
    }
    if (outside) return hostLink(inRepo(safeDecode(dest)))
    const plain = safeDecode(dest)
    if (plain === '' || plain.endsWith('/')) return `${base}${dest}${suffix}`
    const asPage = /\.html$/i.test(plain) ? plain.replace(/\.html$/i, '.md') : plain
    if (pageSet.has(asPage)) return `${route(asPage)}${suffix}`
    if (!path.posix.extname(plain)) {
      if (pageSet.has(`${plain}.md`)) return `${route(`${plain}.md`)}${suffix}`
      if (pageSet.has(`${plain}/index.md`)) return `${route(`${plain}/index.md`)}${suffix}`
    }
    // Files in public/ are served from the site root: "/logo.svg" in a page, or "public/logo.svg" relative to it.
    if (plain.startsWith('public/')) return `${base}${dest.slice('public/'.length)}${suffix}`
    if (target.startsWith('/') && inPublic(plain)) return `${base}${dest}${suffix}`
    return hostLink(inRepo(plain))
  }
  /** Rewrite the links of one line. Code spans are masked for matching, so a link whose label holds code is still found. */
  const rebaseLine = (line, pageRel, variant) => {
    const masked = line.replace(INLINE_CODE, (m) => ' '.repeat(m.length))
    let out = ''
    let last = 0
    // A "[ref]: target" definition is rewritten like a link; one whose target cannot be linked is dropped.
    const def = linkDefinition(masked)
    if (def) {
      const next = rewrite(def.url, pageRel, variant)
      if (next === null) return ''
      return next === def.url ? line : line.slice(0, def.urlSpan[0]) + next + line.slice(def.urlSpan[1])
    }
    for (const link of inlineLinks(masked)) {
      const next = rewrite(link.url, pageRel, variant)
      if (next === link.url) continue
      const [labelStart, labelEnd] = link.labelSpan
      const [urlStart, urlEnd] = link.urlSpan
      if (next === null) {
        out += line.slice(last, link.index) + line.slice(labelStart, labelEnd)
        last = link.index + link.length
      } else {
        out += line.slice(last, urlStart) + next
        last = urlEnd
      }
    }
    return out + line.slice(last)
  }
  const rebase = (body, pageRel, variant) => {
    const lines = [...bodyLines(body)]
    return lines.map(({ line, code }) => (code ? line : rebaseLine(line, pageRel, variant))).join('\n')
  }
  const renderFull = (variant) => {
    const lines = [...header]
    const groups = [...sections.map((s) => ({ name: s.heading, pages: s.pages })), ...(optionalPages.length ? [{ name: 'Optional', pages: optionalPages }] : [])]
    for (const g of groups) {
      lines.push(`## ${g.name}`, '')
      for (const rel of g.pages) {
        const p = pages.get(rel)
        // Attribute values are escaped, so the first ">" on the line always ends the tag.
        lines.push(`<doc title="${attr(p.title)}" path="${attr(rel)}">`, rebase(p.body, rel, variant), '</doc>', '')
      }
    }
    return `${lines.join('\n').trimEnd()}\n`
  }

  // ---- write -------------------------------------------------------------------
  const files = []
  const shown = (file) => (repoRoot ? posix(path.relative(repoRoot, file)) : posix(path.join(path.basename(wikiDir), path.relative(wikiDir, file)))) || path.basename(file)
  const write = (file, content, guard) => {
    const label = shown(file)
    // A wiki file stays in the wiki and the root file in the repository, symlinks included.
    try {
      assertInside(guard ? repoRoot : wikiDir, file, 'llms file')
    } catch (e) {
      throw new UsageError(e.message)
    }
    const existed = fs.existsSync(file)
    if (guard && existed && !options.force && !isMarked(readText(file))) {
      files.push({ path: label, action: 'skipped', bytes: 0 })
      notes.push(`${label} exists without the deep-wiki marker and was left alone; pass --force to replace it`)
      return
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    files.push({ path: label, action: existed ? 'replaced' : 'wrote', bytes: Buffer.byteLength(content) })
  }
  if (wikiRel) write(path.join(repoRoot, 'llms.txt'), renderIndex('root', plan), true)
  else if (wikiRel === '') notes.push('the wiki folder is the repository root: there is no separate root llms.txt')
  else notes.push('no repository root is known (no --repo, no recorded wikiDir, not a git repository): the root llms.txt was not written')
  write(path.join(wikiDir, 'llms.txt'), renderIndex('wiki', plan))
  write(path.join(wikiDir, 'llms-full.txt'), renderFull('wiki'))
  if (hasSite) {
    write(path.join(wikiDir, 'public', 'llms.txt'), renderIndex('public', plan))
    write(path.join(wikiDir, 'public', 'llms-full.txt'), renderFull('public'))
  } else {
    notes.push('no site scaffold (.vitepress/config.mts): the public/ copies were not written')
  }
  return { ok: true, pages: paths.length, files, notes }
}

function main() {
  const argv = process.argv.slice(2)
  const wantsJson = argv.includes('--json')
  try {
    const result = genLlms(parseArgs(argv))
    if (wantsJson) console.log(JSON.stringify(result, null, 2))
    else {
      for (const f of result.files) console.log(`${f.action.padEnd(8)} ${f.path}${f.bytes ? `  (${(f.bytes / 1024).toFixed(1)} KB)` : ''}`)
      for (const n of result.notes) console.log(`note: ${n}`)
      console.log(`${result.pages} page(s) in llms-full.txt`)
    }
    return 0
  } catch (e) {
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
