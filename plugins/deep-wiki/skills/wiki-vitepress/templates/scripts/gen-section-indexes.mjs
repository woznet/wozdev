#!/usr/bin/env node
// Writes the generated hub pages of a wiki:
//   <dir>/index.md         for every section in catalogue.json
//   onboarding/index.md    listing the onboarding guides that exist
//
// Usage: node wiki/scripts/gen-section-indexes.mjs [wikiDir] [--force] [--prune]
//   --force  also replace an index.md that lacks the deep-wiki marker
//   --prune  delete a marked section index.md whose folder is no longer a catalogue section
// A wiki without catalogue.json (crisp) gets the onboarding hub only.
// Nothing is written when the catalogue is unusable: it must be valid JSON, hold at least one
// section, and name only folders inside the wiki.
// Exit code 0 on success, 2 on a usage or I/O error.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKER, ONBOARDING_ORDER, SKIP_FILES, assertInside, isMarked, loadCatalogue, parseFrontmatter, readText, relativeInside, resolveDir, sectionDirProblem, walkCatalogue, yamlString } from './lib.mjs'

export class UsageError extends Error {}

const INLINE_CODE = /(`+)(?:(?!\1).)+\1/g

/** Apply `safe` to the text outside code spans; code spans are copied through unchanged. */
function outsideCode(text, safe) {
  let out = ''
  let last = 0
  for (const m of text.matchAll(INLINE_CODE)) {
    out += safe(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + safe(text.slice(last))
}

/**
 * Text from frontmatter or the catalogue that now lands in page prose. The checker rejects tag
 * shapes and `{{ }}` in both places, but a page that has not been fixed yet must not break the
 * hub that lists it: outside backticks `{{ … }}` is put in backticks and `<` becomes `&lt;`.
 */
const prose = (text) =>
  outsideCode(String(text ?? '').replace(/\r?\n/g, ' ').trim(), (part) => part.replace(/\{\{.*?\}\}|\{\{|\}\}/g, (m) => `\`${m}\``).replace(/</g, '&lt;'))
/** Prose inside a table cell: a bare pipe would end the cell, in or out of a code span. */
const cell = (text) => prose(text).replace(/\|/g, '\\|')
/** Prose used as link text: a bracket outside a code span would end the link. */
const linkText = (text) => outsideCode(cell(text), (part) => part.replace(/[[\]]/g, '\\$&'))

const relLink = (fromDir, target) => {
  const rel = path.posix.relative(fromDir, target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

function parseArgs(argv) {
  const opts = { force: false, prune: false }
  for (const a of argv) {
    if (a === '--force') opts.force = true
    else if (a === '--prune') opts.prune = true
    else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`)
    else if (opts.wikiDir === undefined) opts.wikiDir = a
    else throw new UsageError(`Unexpected argument ${a} (the wiki folder is already ${opts.wikiDir})`)
  }
  return opts
}

export function genIndexes(options) {
  const { force = false, prune = false } = options
  const wikiDir = path.resolve(options.wikiDir ?? '.')
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) throw new UsageError(`Not a folder: ${wikiDir}`)

  let catalogue = null
  try {
    catalogue = loadCatalogue(wikiDir)
  } catch (e) {
    throw new UsageError(`catalogue.json is not valid JSON: ${e.message}`)
  }

  // ---- validate before writing or deleting anything ----------------------------
  const sections = []
  const sectionDirs = new Set()
  if (catalogue) {
    walkCatalogue(catalogue?.items, (node, ctx) => {
      if (!ctx.dir) return
      const problem = sectionDirProblem(ctx.dir)
      // The folder must be inside the wiki: a `dir` with ".." would write an index.md somewhere else.
      if (problem || relativeInside(wikiDir, path.resolve(wikiDir, ctx.dir)) === null) {
        throw new UsageError(`catalogue.json: section dir "${node.dir}" ${problem ?? 'must stay inside the wiki'}; nothing was written`)
      }
      sections.push({ node, dir: ctx.dir })
      sectionDirs.add(ctx.dir)
    })
    // With no sections, --prune would read every generated index as stale and delete it.
    if (!sections.length) throw new UsageError('catalogue.json has no sections (an `items` array of nodes with a `dir`); nothing was written')
  }

  // Every file this run may write or delete, checked where it would really land: the section
  // folder being inside the wiki is not enough when index.md itself, or a folder above it,
  // is a symlink that points somewhere else.
  try {
    for (const { dir } of sections) assertInside(wikiDir, path.join(wikiDir, dir, 'index.md'), 'section index')
    assertInside(wikiDir, path.join(wikiDir, 'onboarding', 'index.md'), 'onboarding hub')
  } catch (e) {
    throw new UsageError(e.message)
  }

  const written = []
  const skipped = []
  const removed = []
  const messages = []
  const frontmatterOf = (relPath) => {
    const file = path.join(wikiDir, relPath)
    return fs.existsSync(file) && fs.statSync(file).isFile() ? (parseFrontmatter(readText(file)).data ?? {}) : {}
  }

  /** Write one generated hub page, unless a hand-written one is in the way. */
  const writeHub = (target, title, description, header, rows) => {
    const file = path.join(wikiDir, target)
    if (fs.existsSync(file) && !force && !isMarked(readText(file))) {
      skipped.push(target)
      return
    }
    // A line break in a catalogue value would end the quoted YAML scalar early.
    const flat = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
    const lines = ['---', `title: ${yamlString(flat(title))}`, `description: ${yamlString(flat(description))}`, '---', '', `# ${prose(title)}`, MARKER, '', prose(description), '']
    if (rows.length) lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => '------').join('|')}|`, ...rows, '')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, lines.join('\n'))
    written.push(target)
  }

  // ---- section indexes --------------------------------------------------------
  for (const { node, dir } of sections) {
    const target = `${dir}/index.md`
    const children = (Array.isArray(node.children) ? node.children : []).filter((c) => c && typeof c === 'object')
    // The catalogue gave this section its own index page: a writer owns it.
    if (children.some((c) => c.path === target)) continue

    const name = String(node.name ?? node.title ?? dir).trim()
    const description = String(node.description ?? '').trim() || `Pages in the ${name} section.`
    const rows = []
    for (const child of children) {
      if (typeof child.path === 'string') {
        const childPath = child.path.replace(/\\/g, '/')
        // A page the catalogue plans but nobody has written yet: no row, so the index has no dead link.
        if (!fs.existsSync(path.join(wikiDir, childPath))) continue
        const fm = frontmatterOf(childPath)
        rows.push(`| [${linkText(fm.title || child.name)}](${relLink(dir, childPath)}) | ${cell(fm.description)} |`)
      } else if (typeof child.dir === 'string') {
        const childDesc = child.description || `Pages in the ${child.name} section.`
        rows.push(`| [${linkText(child.name)}](${relLink(dir, `${resolveDir(child, dir)}/index.md`)}) | ${cell(childDesc)} |`)
      }
    }
    writeHub(target, name, description, ['Page', 'What it covers'], rows)
  }

  // ---- onboarding hub ---------------------------------------------------------
  const AUDIENCE = {
    'contributor-guide.md': 'New contributors',
    'staff-engineer-guide.md': 'Staff and principal engineers',
    'executive-guide.md': 'Engineering leaders',
    'product-manager-guide.md': 'Product managers',
  }
  const onboardingDir = path.join(wikiDir, 'onboarding')
  // Only files the site builds: AGENTS.md, CLAUDE.md and README.md are not pages.
  const present = fs.existsSync(onboardingDir) ? fs.readdirSync(onboardingDir).filter((f) => f.endsWith('.md') && f !== 'index.md' && !SKIP_FILES.has(f)) : []
  if (present.length) {
    const rank = (f) => (ONBOARDING_ORDER.includes(f) ? ONBOARDING_ORDER.indexOf(f) : ONBOARDING_ORDER.length)
    const rows = present
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((f) => {
        const fm = frontmatterOf(`onboarding/${f}`)
        return `| [${linkText(fm.title || f.replace(/\.md$/, ''))}](./${f}) | ${AUDIENCE[f] ?? ''} | ${cell(fm.description)} |`
      })
    writeHub('onboarding/index.md', 'Onboarding', 'Guides to this codebase, one per audience. Pick the one written for you.', ['Guide', 'Audience', 'What it covers'], rows)
  } else {
    const hub = path.join(onboardingDir, 'index.md')
    if (fs.existsSync(hub) && isMarked(readText(hub))) {
      // The guides it listed are gone. Rewrite it empty, so no row links to a deleted page.
      writeHub('onboarding/index.md', 'Onboarding', 'No onboarding guides have been written yet.', [], [])
      messages.push('no onboarding guides; the generated hub was emptied')
    } else {
      messages.push('no onboarding guides; hub not written')
    }
  }

  // ---- prune ------------------------------------------------------------------
  if (prune && catalogue) {
    const visit = (dir) => {
      // Never follow a link out of the wiki: nothing outside it is ours to delete.
      if (relativeInside(wikiDir, path.join(wikiDir, dir)) === null) return
      for (const e of fs.readdirSync(path.join(wikiDir, dir), { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.')) visit(`${dir}/${e.name}`)
      }
      const index = path.join(wikiDir, dir, 'index.md')
      if (!sectionDirs.has(dir) && fs.existsSync(index) && relativeInside(wikiDir, index) !== null && isMarked(readText(index))) {
        fs.rmSync(index)
        removed.push(`${dir}/index.md`)
        if (!fs.readdirSync(path.join(wikiDir, dir)).length) fs.rmdirSync(path.join(wikiDir, dir))
      }
    }
    for (const e of fs.readdirSync(wikiDir, { withFileTypes: true })) {
      if (e.isDirectory() && /^\d+-/.test(e.name)) visit(e.name)
    }
  }
  if (!catalogue) messages.push('no catalogue.json: section indexes not generated')
  return { ok: true, written, skipped, removed, messages, prune }
}

function main() {
  try {
    const result = genIndexes(parseArgs(process.argv.slice(2)))
    for (const f of result.written) console.log(`wrote    ${f}`)
    for (const f of result.skipped) console.log(`skipped  ${f} (no deep-wiki marker; pass --force to replace)`)
    for (const f of result.removed) console.log(`removed  ${f} (its folder is not a catalogue section)`)
    for (const m of result.messages) console.log(m)
    console.log(`${result.written.length} hub page(s) written, ${result.skipped.length} skipped${result.prune ? `, ${result.removed.length} removed` : ''}`)
    return 0
  } catch (e) {
    // Bad input and I/O failures alike: exit 2, one line.
    console.error(e instanceof UsageError || e?.code ? e.message : `internal error: ${e?.stack ?? e}`)
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
