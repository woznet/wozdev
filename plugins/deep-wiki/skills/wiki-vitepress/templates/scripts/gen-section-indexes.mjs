#!/usr/bin/env node
// Writes <dir>/index.md for every section in catalogue.json.
// Usage: node scripts/gen-section-indexes.mjs [wikiDir] [--force]
//   --force  also replace an index.md that lacks the deep-wiki marker
import fs from 'node:fs'
import path from 'node:path'
import { MARKER, loadCatalogue, parseFrontmatter, resolveDir, walkCatalogue, yamlString } from './lib.mjs'

const args = process.argv.slice(2)
const force = args.includes('--force')
const wikiDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.')

const catalogue = loadCatalogue(wikiDir)
if (!catalogue) {
  console.error(`No catalogue.json in ${wikiDir}`)
  process.exit(1)
}

const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
const relLink = (fromDir, target) => {
  const rel = path.posix.relative(fromDir, target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

function frontmatterOf(relPath) {
  const file = path.join(wikiDir, relPath)
  return fs.existsSync(file) ? (parseFrontmatter(fs.readFileSync(file, 'utf8')).data ?? {}) : {}
}

const sections = []
walkCatalogue(catalogue.items, (node, ctx) => {
  if (ctx.dir) sections.push({ node, dir: ctx.dir })
})

const written = []
const skipped = []
for (const { node, dir } of sections) {
  const target = `${dir}/index.md`
  const children = Array.isArray(node.children) ? node.children : []
  // The architect gave this section its own index page: a writer owns it.
  if (children.some((c) => c.path === target)) continue

  const file = path.join(wikiDir, target)
  if (fs.existsSync(file) && !force && !fs.readFileSync(file, 'utf8').includes(MARKER)) {
    skipped.push(target)
    continue
  }

  const name = String(node.name ?? node.title ?? dir).trim()
  const description = String(node.description ?? '').trim() || `Pages in the ${name} section.`
  const rows = []
  for (const child of children) {
    if (typeof child.path === 'string') {
      const fm = frontmatterOf(child.path)
      rows.push(`| [${cell(fm.title || child.name)}](${relLink(dir, child.path)}) | ${cell(fm.description)} |`)
    } else if (typeof child.dir === 'string') {
      const childDir = resolveDir(child, dir)
      const childDesc = child.description || `Pages in the ${child.name} section.`
      rows.push(`| [${cell(child.name)}](${relLink(dir, `${childDir}/index.md`)}) | ${cell(childDesc)} |`)
    }
  }

  const lines = [
    '---',
    `title: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    '---',
    '',
    `# ${name}`,
    MARKER,
    '',
    description,
    '',
  ]
  if (rows.length) lines.push('| Page | What it covers |', '|------|----------------|', ...rows, '')

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.join('\n'))
  written.push(target)
}

for (const f of written) console.log(`wrote    ${f}`)
for (const f of skipped) console.log(`skipped  ${f} (no deep-wiki marker; pass --force to replace)`)
console.log(`${written.length} section index page(s) written, ${skipped.length} skipped`)
