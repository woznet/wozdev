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
//                   Without it: the catalogue summary and each page's frontmatter description.
//   --force         replace a repository-root llms.txt that lacks the deep-wiki marker
//   --repo <path>   repository root (default: the git top level, else the wiki's parent folder)
//
// Writes:
//   <repo>/llms.txt              links into the wiki folder; skipped when it exists without the marker
//   <wiki>/llms.txt              wiki-relative .md links
//   <wiki>/llms-full.txt         every page inlined in a <doc> block, relative links rebased to the wiki root
//   <wiki>/public/llms.txt       \ the same two files with wiki links rewritten to site routes under `base`
//   <wiki>/public/llms-full.txt  / (only when the wiki has a site: .vitepress/config.mts or a recorded base)
// Each llms.txt stays under 5 KB: descriptions are shortened, then sections collapse to their index page,
// then pages move to ## Optional, then Optional entries are left out. llms-full.txt always has every page.
// Exit code 0 on success, 2 on a usage or I/O error.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MARKER,
  ONBOARDING_ORDER,
  gitTopLevel,
  listPages,
  loadCatalogue,
  loadState,
  normalizeBase,
  parseFrontmatter,
  posix,
  readConfigConst,
  readText,
  resolveDir,
} from './lib.mjs'

const MAX_BYTES = 5 * 1024
const INLINE_CODE = /(`+)(?:(?!\1).)+\1/g
// Same shape the checker accepts: one level of [brackets] in the text, one level of (parentheses) in the URL.
const LINK = /(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))+)>?((?:\s+"[^"]*")?)\s*\)/g

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

function parseArgs(argv) {
  const opts = { wikiDir: '.' }
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    let inline
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
    if (a === '--input' || a === '--repo') {
      const value = inline ?? argv[++i]
      if (!value) throw new UsageError(`${a} needs a value`)
      opts[a.slice(2)] = value
    } else if (a === '--force' || a === '--json') opts[a.slice(2)] = true
    else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`)
    else opts.wikiDir = a
  }
  return opts
}

function readInput(file) {
  if (!file) return {}
  let data
  try {
    data = JSON.parse(readText(path.resolve(file)))
  } catch (e) {
    throw new UsageError(`cannot read --input ${file}: ${e.message}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UsageError('--input must be a JSON object')
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
  if (data.summary !== undefined && typeof data.summary !== 'string') throw new UsageError('--input: "summary" must be a string')
  if (data.context !== undefined && !strings(data.context)) throw new UsageError('--input: "context" must be an array of strings')
  if (data.optional !== undefined && !strings(data.optional)) throw new UsageError('--input: "optional" must be an array of strings')
  if (data.descriptions !== undefined && (typeof data.descriptions !== 'object' || Array.isArray(data.descriptions))) {
    throw new UsageError('--input: "descriptions" must be an object of page path to text')
  }
  return data
}

/** Body lines outside code fences, with a flag per line. A backtick fence has no backtick in its info string. */
function* bodyLines(text) {
  let fence = null
  for (const line of text.split('\n')) {
    const bare = line.replace(/^(?: {0,3}>[ \t]?)+/, '')
    if (fence) {
      const close = bare.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null
      yield { line, code: true }
      continue
    }
    const open = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], len: open[1].length }
      yield { line, code: true }
      continue
    }
    yield { line, code: false }
  }
}

export function genLlms(options) {
  const wikiDir = path.resolve(options.wikiDir ?? '.')
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) throw new UsageError(`wiki folder not found: ${posix(wikiDir)}`)
  const repoRoot = options.repo ? path.resolve(options.repo) : (gitTopLevel(wikiDir) ?? path.dirname(wikiDir))
  const wikiRel = posix(path.relative(repoRoot, wikiDir))
  if (wikiRel.startsWith('..') || path.isAbsolute(wikiRel)) throw new UsageError(`${posix(wikiDir)} is not inside the repository root ${posix(repoRoot)}`)

  const input = readInput(options.input)
  const state = loadState(wikiDir)
  const hasSite = fs.existsSync(path.join(wikiDir, '.vitepress', 'config.mts')) || typeof state.base === 'string'
  const pick = (key, constant) => (typeof state[key] === 'string' && state[key] !== '' ? state[key] : readConfigConst(wikiDir, constant))
  const base = normalizeBase(pick('base', 'BASE') || '/')
  const repoUrl = pick('repoUrl', 'REPO_URL').replace(/\/+$/, '')
  const branch = pick('branch', 'BRANCH')
  const host = state.host || (/gitlab/i.test(repoUrl) ? 'gitlab' : /dev\.azure\.com|visualstudio\.com/i.test(repoUrl) ? 'azure-devops' : repoUrl ? 'github' : 'local')
  const notes = []

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
    else if (fs.existsSync(path.join(repoRoot, rel)) && fs.statSync(path.join(repoRoot, rel)).isFile()) optionalFiles.push(rel)
    else notes.push(`optional entry ${raw} is neither a wiki page nor a repository file; left out`)
  }
  const taken = new Set(optionalPages)
  const sections = []
  const addSection = (name, list, index) => {
    const own = [...new Set(list)].filter((p) => pageSet.has(p) && !taken.has(p))
    own.forEach((p) => taken.add(p))
    if (own.length) sections.push({ name, pages: own, index: index && own.includes(index) ? index : null })
  }
  const under = (dir) => paths.filter((p) => p.startsWith(`${dir}/`))

  // The landing page leads; `More` is kept for other root pages (changelog.md and the like).
  addSection('Start Here', ['index.md'], null)

  const onboarding = under('onboarding')
  const ordered = ONBOARDING_ORDER.map((f) => `onboarding/${f}`)
  addSection('Onboarding', [...ordered, ...onboarding.filter((p) => !ordered.includes(p))], 'onboarding/index.md')

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
  addSection('More', paths.filter((p) => !p.includes('/')), null)

  const project = oneLine(catalogue?.project || readConfigConst(wikiDir, 'SITE_TITLE') || path.basename(repoRoot))
  const summary = oneLine(input.summary ?? catalogue?.summary ?? readConfigConst(wikiDir, 'SITE_DESCRIPTION'))
  const context = (input.context ?? []).map(oneLine).filter(Boolean)
  if (!summary) notes.push('no summary: pass --input with a "summary", or add one to catalogue.json')
  const header = [`# ${project}`, MARKER, '', ...(summary ? [`> ${summary}`, ''] : []), ...context.flatMap((p) => [p, ''])]

  // ---- link targets ----------------------------------------------------------
  const route = (rel) => {
    if (rel === 'index.md') return base
    if (rel.endsWith('/index.md')) return `${base}${encodePath(rel.slice(0, -8))}`
    return `${base}${encodePath(rel.replace(/\.md$/, ''))}`
  }
  /** A link to a repository file on the git host, or null when the host or branch is unknown. */
  const blob = (repoPath) => {
    if (!repoUrl || !branch || repoPath.startsWith('..')) return null
    const p = encodePath(repoPath)
    if (host === 'github') return `${repoUrl}/blob/${branch}/${p}`
    if (host === 'gitlab') return `${repoUrl}/-/blob/${branch}/${p}`
    if (host === 'azure-devops') return `${repoUrl}?path=/${p}&version=GB${branch}`
    return null
  }
  const inRepo = (wikiPath) => path.posix.normalize(path.posix.join(wikiRel || '.', wikiPath))
  const VARIANTS = {
    root: { page: (rel) => `./${encodePath(path.posix.join(wikiRel, rel))}`, file: (repoPath) => `./${encodePath(repoPath)}` },
    wiki: { page: (rel) => `./${encodePath(rel)}`, file: (repoPath) => encodePath(path.posix.relative(wikiRel || '.', repoPath)) },
    public: { page: route, file: blob },
  }

  // ---- llms.txt ----------------------------------------------------------------
  /** plan: { short, collapsed: Set<section name>, demoted: Set<section name>, dropped: number } */
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
      if (plan.demoted.has(s.name)) {
        optional.push(...s.pages.map((rel) => entry(pages.get(rel), true)))
        continue
      }
      const list = plan.collapsed.has(s.name) ? [s.index] : s.pages
      lines.push(`## ${s.name}`, '', ...list.map((rel) => entry(pages.get(rel), false)), '')
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
        plan.collapsed.add(s.name)
      }
      for (const s of [...sections].reverse()) {
        if (!tooBig()) break
        if (!plan.collapsed.has(s.name)) plan.demoted.add(s.name)
      }
      const optionalCount = optionalPages.length + optionalFiles.length + sections.filter((s) => plan.demoted.has(s.name)).reduce((n, s) => n + s.pages.length, 0)
      while (tooBig() && plan.dropped < optionalCount) plan.dropped++
      const did = ['descriptions shortened']
      if (plan.collapsed.size) did.push(`${plan.collapsed.size} section(s) reduced to their index page (${[...plan.collapsed].join(', ')})`)
      if (plan.demoted.size) did.push(`${plan.demoted.size} section(s) moved to Optional without descriptions (${[...plan.demoted].join(', ')})`)
      if (plan.dropped) did.push(`${plan.dropped} Optional entr${plan.dropped === 1 ? 'y' : 'ies'} left out`)
      notes.push(`over 5 KB: ${did.join('; ')}. llms-full.txt still has every page.`)
      if (tooBig()) notes.push('still over 5 KB: shorten the "summary" and "context" in --input')
    }
  }

  // ---- llms-full.txt -----------------------------------------------------------
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
    if (variant === 'wiki') return outside ? `${dest}${suffix}` : `./${dest}${suffix}`

    const hostLink = (repoPath) => {
      const link = blob(repoPath)
      return link ? `${link}${host === 'azure-devops' ? '' : suffix}` : null
    }
    if (outside) return hostLink(inRepo(safeDecode(dest)))
    const plain = safeDecode(dest)
    if (plain === '' || plain.endsWith('/')) return `${base}${dest}${suffix}`
    if (pageSet.has(plain)) return `${route(plain)}${suffix}`
    if (!path.posix.extname(plain)) {
      if (pageSet.has(`${plain}.md`)) return `${route(`${plain}.md`)}${suffix}`
      if (pageSet.has(`${plain}/index.md`)) return `${route(`${plain}/index.md`)}${suffix}`
    }
    if (plain.startsWith('public/')) return `${base}${dest.slice('public/'.length)}${suffix}`
    return hostLink(inRepo(plain))
  }
  const rebase = (body, pageRel, variant) => {
    const out = []
    for (const { line, code } of bodyLines(body)) {
      if (code) {
        out.push(line)
        continue
      }
      // Inline code is copied through; only the text around it is scanned for links.
      let result = ''
      let last = 0
      const convert = (text) =>
        text.replace(LINK, (whole, bang, label, url, title) => {
          const next = rewrite(url, pageRel, variant)
          if (next === null) return label
          return next === url ? whole : `${bang}[${label}](${next}${title})`
        })
      for (const m of line.matchAll(INLINE_CODE)) {
        result += convert(line.slice(last, m.index)) + m[0]
        last = m.index + m[0].length
      }
      out.push(result + convert(line.slice(last)))
    }
    return out.join('\n')
  }
  const renderFull = (variant) => {
    const lines = [...header]
    const groups = [...sections.map((s) => ({ name: s.name, pages: s.pages })), ...(optionalPages.length ? [{ name: 'Optional', pages: optionalPages }] : [])]
    for (const g of groups) {
      lines.push(`## ${g.name}`, '')
      for (const rel of g.pages) {
        const p = pages.get(rel)
        lines.push(`<doc title="${p.title.replace(/"/g, '&quot;')}" path="${rel}">`, rebase(p.body, rel, variant), '</doc>', '')
      }
    }
    return `${lines.join('\n').trimEnd()}\n`
  }

  // ---- write -------------------------------------------------------------------
  const files = []
  const write = (file, content, guard) => {
    const label = posix(path.relative(repoRoot, file)) || path.basename(file)
    const existed = fs.existsSync(file)
    if (guard && existed && !options.force && !readText(file).includes(MARKER)) {
      files.push({ path: label, action: 'skipped', bytes: 0 })
      notes.push(`${label} exists without the deep-wiki marker and was left alone; pass --force to replace it`)
      return
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    files.push({ path: label, action: existed ? 'replaced' : 'wrote', bytes: Buffer.byteLength(content) })
  }
  if (wikiRel) write(path.join(repoRoot, 'llms.txt'), renderIndex('root', plan), true)
  else notes.push('the wiki folder is the repository root: there is no separate root llms.txt')
  write(path.join(wikiDir, 'llms.txt'), renderIndex('wiki', plan))
  write(path.join(wikiDir, 'llms-full.txt'), renderFull('wiki'))
  if (hasSite) {
    write(path.join(wikiDir, 'public', 'llms.txt'), renderIndex('public', plan))
    write(path.join(wikiDir, 'public', 'llms-full.txt'), renderFull('public'))
  } else {
    notes.push('no site scaffold (.vitepress/config.mts) and no recorded base: the public/ copies were not written')
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
