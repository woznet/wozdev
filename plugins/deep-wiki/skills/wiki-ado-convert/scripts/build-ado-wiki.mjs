#!/usr/bin/env node
// Convert a VitePress/GFM wiki into Azure DevOps Wiki-compatible Markdown.
//
// Usage: node build-ado-wiki.mjs [sourceDir] [outDir]
//   sourceDir  defaults to the parent of this script's folder (wiki/ when the
//              script lives in wiki/scripts/), else ./wiki
//   outDir     defaults to <sourceDir>/dist/ado-wiki
//
// Zero dependencies. Source files are never modified.

import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, dirname, resolve, extname, basename, posix, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['node_modules', '.vitepress', '.git', 'dist', 'build', 'out', 'scripts'])
const SKIP_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'llms.txt', 'llms-full.txt', 'package.json', 'package-lock.json', '.gitignore'])
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'])
const CONTAINER_MAP = { tip: 'TIP', info: 'NOTE', note: 'NOTE', warning: 'WARNING', danger: 'CAUTION', caution: 'CAUTION', important: 'IMPORTANT', details: 'NOTE' }

function resolveDirs() {
  const here = dirname(fileURLToPath(import.meta.url))
  const fallback = basename(here) === 'scripts' && existsSync(join(here, '..', 'index.md')) ? resolve(here, '..') : resolve('wiki')
  const src = resolve(process.argv[2] ?? fallback)
  const out = resolve(process.argv[3] ?? join(src, 'dist', 'ado-wiki'))
  return { src, out }
}

async function collect(dir, root, acc = { md: [], assets: [] }) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      // `public/` holds site assets (logo, llms copies); keep only real images from it.
      await collect(full, root, acc)
    } else if (!SKIP_FILES.has(entry.name)) {
      if (entry.name.endsWith('.md')) acc.md.push(full)
      else if (ASSET_EXT.has(extname(entry.name).toLowerCase())) acc.assets.push(full)
    }
  }
  return acc
}

/** Returns [body, hadFrontMatter, frontMatterText]. */
function stripFrontMatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m) return [content, false, '']
  return [content.slice(m[0].length).replace(/^\n+/, ''), true, m[1]]
}

function convertMermaid(content, stats) {
  const out = []
  let inMermaid = false
  let inOtherFence = false
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!inMermaid && !inOtherFence && /^```mermaid\s*$/.test(t)) {
      out.push('::: mermaid')
      inMermaid = true
      stats.mermaid++
      continue
    }
    if (inMermaid && /^```\s*$/.test(t)) {
      out.push(':::')
      inMermaid = false
      continue
    }
    if (!inMermaid && /^(```|~~~)/.test(t)) inOtherFence = !inOtherFence
    if (inMermaid) {
      let fixed = line.replace(/^(\s*)flowchart(\s+(TD|TB|BT|LR|RL)\b|\s*$)/, (_m, ws, rest) => {
        stats.flowchart++
        return `${ws}graph${rest || ' TD'}`
      })
      fixed = fixed.replace(/<br\s*\/?>/gi, () => {
        stats.br++
        return ' '
      })
      fixed = fixed.replace(/-{4,}>/g, () => {
        stats.arrows++
        return '-->'
      })
      out.push(fixed)
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

/**
 * Keep links that resolve to a Markdown page or asset inside the wiki (cross-page links).
 * Flatten relative links that escape the wiki root (source-file citations that only
 * work in the repo) to their link text. External URLs and anchors are untouched.
 */
function convertLinks(content, filePath, src, stats) {
  const fileDir = dirname(filePath)
  let inFence = false
  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~|::: mermaid|:::\s*$)/.test(line)) {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
        return line
      }
      if (inFence) return line
      return line.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m, bang, text, url) => {
        if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return m
        const target = resolve(fileDir, decodeURI(url.split('#')[0]))
        const rel = relative(src, target)
        if (rel.startsWith('..')) {
          stats.sourceLinks++
          return bang ? `${text}` : text
        }
        return m
      })
    })
    .join('\n')
}

function convertContainers(content, stats) {
  const out = []
  let open = null
  let inFence = false
  // Mermaid blocks were already converted to `::: mermaid` ... `:::`; their closing
  // `:::` must not be mistaken for the enclosing container's close.
  let inMermaid = false
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) inFence = !inFence
    if (!inFence && t === '::: mermaid') inMermaid = true
    else if (!inFence && inMermaid && t === ':::') {
      inMermaid = false
      out.push(open ? `> ${line}` : line)
      continue
    }
    if (!inFence && !inMermaid && !open) {
      const m = t.match(/^:::\s*(tip|info|note|warning|danger|caution|important|details)\b\s*(.*)$/i)
      if (m) {
        open = CONTAINER_MAP[m[1].toLowerCase()]
        out.push(`> [!${open}]`)
        if (m[2]) out.push(`> **${m[2]}**`)
        stats.containers++
        continue
      }
    }
    if (open && !inFence && !inMermaid && t === ':::') {
      open = null
      out.push('')
      continue
    }
    out.push(open ? (line.length ? `> ${line}` : '>') : line)
  }
  return out.join('\n')
}

const PLACEHOLDER = /TODO:|Give a short introduction|TSA bug filing/i

async function buildIndex(src, out, pages, stats) {
  const indexOut = join(out, 'index.md')
  if (existsSync(indexOut)) {
    const body = (await readFile(indexOut, 'utf8')).trim()
    if (body && !PLACEHOLDER.test(body)) return
  }
  let name = basename(resolve(src, '..'))
  try {
    name = JSON.parse(await readFile(join(src, 'package.json'), 'utf8')).name?.replace(/-wiki$/, '') || name
  } catch {}
  const rows = pages
    .filter((p) => p.rel !== 'index.md')
    .map((p) => `| [${p.title}](./${p.rel.split('\\').join('/')}) | \`${posix.dirname(p.rel.split('\\').join('/'))}\` |`)
  const text = [`# ${name} — Wiki`, '', `Documentation for ${name}.`, '', '## Contents', '', '| Page | Section |', '|------|---------|', ...rows, ''].join('\n')
  await writeFile(indexOut, text, 'utf8')
  stats.indexGenerated = true
}

function sortKey(name) {
  if (name === 'index') return '0'
  if (name === 'onboarding') return '1'
  return `2${name}`
}

/** ADO uses a .order file per folder to order pages and sub-folders in the sidebar. */
async function writeOrderFiles(dir) {
  let count = 0
  const entries = await readdir(dir, { withFileTypes: true })
  const names = []
  for (const e of entries) {
    if (e.isDirectory()) {
      names.push(e.name)
      count += await writeOrderFiles(join(dir, e.name))
    } else if (e.name.endsWith('.md')) {
      names.push(e.name.slice(0, -3))
    }
  }
  const unique = [...new Set(names)].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  if (unique.length) {
    await writeFile(join(dir, '.order'), unique.join('\n') + '\n', 'utf8')
    count++
  }
  return count
}

async function main() {
  const { src, out } = resolveDirs()
  if (!existsSync(src) || !(await stat(src)).isDirectory()) throw new Error(`Wiki source not found: ${src}`)
  // Refuse outputs that would delete the source: the source itself, an ancestor of it,
  // or a folder inside it that the converter would read from (anything but dist/).
  const outRel = relative(src, out)
  const isInsideSrc = outRel && !outRel.startsWith('..') && !isAbsolute(outRel)
  const firstSegment = outRel.split(sep)[0]
  if (!outRel || !relative(out, src).startsWith('..') || (isInsideSrc && firstSegment !== 'dist')) {
    throw new Error(`Refusing output ${out}: use a folder outside ${src} or under its dist/`)
  }
  await rm(out, { recursive: true, force: true })

  const { md, assets } = await collect(src, src)
  const stats = { files: 0, frontMatter: 0, mermaid: 0, flowchart: 0, br: 0, arrows: 0, sourceLinks: 0, containers: 0, assets: 0, orderFiles: 0, indexGenerated: false }
  const pages = []

  for (const file of md) {
    const raw = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
    let [body, hadFm, fm] = stripFrontMatter(raw)
    if (hadFm) stats.frontMatter++
    body = convertMermaid(body, stats)
    body = convertContainers(body, stats)
    body = convertLinks(body, file, src, stats)
    const rel = relative(src, file)
    const fmTitle = fm.match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '')
    const h1 = body.match(/^#\s+(.+)$/m)?.[1].trim()
    pages.push({ rel, title: fmTitle || h1 || basename(file, '.md') })
    if (rel === 'index.md' && !body.trim()) continue // hero-only VitePress home: regenerate below
    const target = join(out, rel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body, 'utf8')
    stats.files++
  }

  for (const file of assets) {
    const rel = relative(src, file)
    const target = join(out, rel)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file, target)
    stats.assets++
  }

  await mkdir(out, { recursive: true })
  await buildIndex(src, out, pages, stats)
  stats.orderFiles = await writeOrderFiles(out)

  console.log(`ADO wiki written to ${out}`)
  console.table(stats)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
