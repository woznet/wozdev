#!/usr/bin/env node
// Writes the generated hub pages of a wiki:
//   <dir>/index.md         for every section in catalogue.json
//   onboarding/index.md    listing the onboarding guides that exist
//
// Usage: node scripts/gen-section-indexes.mjs [wikiDir] [--force] [--prune]
//   --force  also replace an index.md that lacks the deep-wiki marker
//   --prune  delete a marked section index.md whose folder is no longer a catalogue section
// A wiki without catalogue.json (crisp) gets the onboarding hub only.
// Exit code 0 on success, 2 when the wiki folder or the catalogue cannot be read.
import fs from 'node:fs'
import path from 'node:path'
import { MARKER, ONBOARDING_ORDER, loadCatalogue, parseFrontmatter, readText, resolveDir, walkCatalogue, yamlString } from './lib.mjs'

const args = process.argv.slice(2)
const unknown = args.find((a) => a.startsWith('--') && !['--force', '--prune'].includes(a))
if (unknown) fail(`Unknown option ${unknown}`)
const force = args.includes('--force')
const prune = args.includes('--prune')
const wikiDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.')
if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) fail(`Not a folder: ${wikiDir}`)

let catalogue = null
try {
  catalogue = loadCatalogue(wikiDir)
} catch (e) {
  fail(`catalogue.json is not valid JSON: ${e.message}`)
}

function fail(message) {
  console.error(message)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Text that came from frontmatter or the catalogue and now lands in page prose
// ---------------------------------------------------------------------------
/**
 * Frontmatter is not prose, so `Repository<T>` or `{{ value }}` is legal there. In a page body
 * Vue reads the first as a tag and evaluates the second, and the build fails. Text already in
 * backticks is left alone; elsewhere `{{ … }}` is put in backticks and `<` becomes `&lt;`.
 */
function prose(text) {
  const clean = String(text ?? '').replace(/\r?\n/g, ' ').trim()
  const safe = (part) =>
    part
      .replace(/\{\{.*?\}\}|\{\{|\}\}/g, (m) => `\`${m}\``)
      .replace(/</g, '&lt;')
  let out = ''
  let last = 0
  for (const m of clean.matchAll(/(`+)(?:(?!\1).)+\1/g)) {
    out += safe(clean.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + safe(clean.slice(last))
}
/** Prose inside a table cell: a bare pipe would end the cell. */
const cell = (text) => prose(text).replace(/\|/g, '\\|')
/** Prose used as link text: brackets would end the link. */
const linkText = (text) => cell(text).replace(/[[\]]/g, '\\$&')

const relLink = (fromDir, target) => {
  const rel = path.posix.relative(fromDir, target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

function frontmatterOf(relPath) {
  const file = path.join(wikiDir, relPath)
  return fs.existsSync(file) ? (parseFrontmatter(readText(file)).data ?? {}) : {}
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
const written = []
const skipped = []
const removed = []

const isMarked = (file) => readText(file).includes(MARKER)

/** Write one generated hub page, unless a hand-written one is in the way. */
function writeHub(target, title, description, header, rows) {
  const file = path.join(wikiDir, target)
  if (fs.existsSync(file) && !force && !isMarked(file)) {
    skipped.push(target)
    return
  }
  const lines = ['---', `title: ${yamlString(title)}`, `description: ${yamlString(description)}`, '---', '', `# ${prose(title)}`, MARKER, '', prose(description), '']
  if (rows.length) lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => '------').join('|')}|`, ...rows, '')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.join('\n'))
  written.push(target)
}

// ---- section indexes --------------------------------------------------------
const sectionDirs = new Set()
if (catalogue) {
  const sections = []
  walkCatalogue(catalogue.items, (node, ctx) => {
    if (ctx.dir) {
      sections.push({ node, dir: ctx.dir })
      sectionDirs.add(ctx.dir)
    }
  })

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
        const fm = frontmatterOf(child.path)
        rows.push(`| [${linkText(fm.title || child.name)}](${relLink(dir, child.path)}) | ${cell(fm.description)} |`)
      } else if (typeof child.dir === 'string') {
        const childDesc = child.description || `Pages in the ${child.name} section.`
        rows.push(`| [${linkText(child.name)}](${relLink(dir, `${resolveDir(child, dir)}/index.md`)}) | ${cell(childDesc)} |`)
      }
    }
    writeHub(target, name, description, ['Page', 'What it covers'], rows)
  }
}

// ---- onboarding hub ---------------------------------------------------------
const AUDIENCE = {
  'contributor-guide.md': 'New contributors',
  'staff-engineer-guide.md': 'Staff and principal engineers',
  'executive-guide.md': 'Engineering leaders',
  'product-manager-guide.md': 'Product managers',
}
const onboardingDir = path.join(wikiDir, 'onboarding')
if (fs.existsSync(onboardingDir)) {
  const present = fs.readdirSync(onboardingDir).filter((f) => f.endsWith('.md') && f !== 'index.md')
  const rank = (f) => (ONBOARDING_ORDER.includes(f) ? ONBOARDING_ORDER.indexOf(f) : ONBOARDING_ORDER.length)
  const guides = present.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  if (guides.length) {
    const rows = guides.map((f) => {
      const fm = frontmatterOf(`onboarding/${f}`)
      return `| [${linkText(fm.title || f.replace(/\.md$/, ''))}](./${f}) | ${AUDIENCE[f] ?? ''} | ${cell(fm.description)} |`
    })
    writeHub('onboarding/index.md', 'Onboarding', 'Guides to this codebase, one per audience. Pick the one written for you.', ['Guide', 'Audience', 'What it covers'], rows)
  } else {
    console.log('no onboarding guides; hub not written')
  }
} else {
  console.log('no onboarding guides; hub not written')
}

// ---- prune ------------------------------------------------------------------
if (prune && catalogue) {
  const visit = (dir) => {
    for (const e of fs.readdirSync(path.join(wikiDir, dir), { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) visit(`${dir}/${e.name}`)
    }
    const index = path.join(wikiDir, dir, 'index.md')
    if (!sectionDirs.has(dir) && fs.existsSync(index) && isMarked(index)) {
      fs.rmSync(index)
      removed.push(`${dir}/index.md`)
      if (!fs.readdirSync(path.join(wikiDir, dir)).length) fs.rmdirSync(path.join(wikiDir, dir))
    }
  }
  for (const e of fs.readdirSync(wikiDir, { withFileTypes: true })) {
    if (e.isDirectory() && /^\d+-/.test(e.name)) visit(e.name)
  }
}

for (const f of written) console.log(`wrote    ${f}`)
for (const f of skipped) console.log(`skipped  ${f} (no deep-wiki marker; pass --force to replace)`)
for (const f of removed) console.log(`removed  ${f} (its folder is not a catalogue section)`)
if (!catalogue) console.log('no catalogue.json: section indexes not generated')
console.log(`${written.length} hub page(s) written, ${skipped.length} skipped${prune ? `, ${removed.length} removed` : ''}`)
