// Run with: node --test "plugins/deep-wiki/tests/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/wiki-vitepress/templates/scripts')
const checker = path.join(scripts, 'check-wiki.mjs')
const { checkWiki, slugify, parseArgs, UsageError } = await import(pathToFileURL(checker).href)
const lib = await import(pathToFileURL(path.join(scripts, 'lib.mjs')).href)
const genIndexes = path.join(scripts, 'gen-section-indexes.mjs')

const FENCE = '```'
const BOM = '﻿'
const SOURCES = ['a', 'b', 'c', 'd', 'e'].map((n) => `src/${n}.ts`)
const REPO_URL = 'https://github.com/o/r'

const diagram = (...lines) => [`${FENCE}mermaid`, ...lines, FENCE, '<!-- Sources: src/a.ts:1 -->', ''].join('\n')
const frontmatter = (title, description = 'A page used by the tests.') => `---\ntitle: ${title}\ndescription: ${description}\n---\n`

function goodPage(title, extra = '') {
  return [
    frontmatter(title),
    `# ${title}`,
    '',
    `Facts: ${SOURCES.map((s) => `(${s}:1-3)`).join(' ')}.`,
    '',
    diagram('flowchart TD', '  A --> B'),
    diagram('sequenceDiagram', '  autonumber', '  A->>B: call'),
    diagram('flowchart LR', '  C --> D'),
    extra,
    '',
  ].join('\n')
}

const LANDING = `${frontmatter('Demo')}\n# Demo\n\nStart with [Setup](./01-getting-started/setup.md).\n`
const SECTION_INDEX = `${frontmatter('Getting Started', 'Section.')}\n# Getting Started\n`
const leaf = (name, extra = {}) => ({
  title: name,
  name: name[0].toUpperCase() + name.slice(1),
  path: `01-getting-started/${name}.md`,
  prompt: 'Read src/a.ts and src/b.ts.',
  children: [],
  ...extra,
})
const catalogueOf = (...leaves) => ({
  project: 'Demo',
  summary: 'Demo project.',
  items: [{ title: 'getting-started', name: 'Getting Started', dir: '01-getting-started', description: 'How to install and run the demo.', children: leaves }],
})
const CATALOGUE = catalogueOf(leaf('setup'), leaf('usage'))

/**
 * A small repository with a valid wiki, removed when the test ends.
 * `pages` overrides or adds wiki files (null removes one); `repoFiles` adds files to the repository.
 */
function fixture(t, pages = {}, { catalogue = CATALOGUE, repoFiles = {} } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-test-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const wiki = path.join(repo, 'wiki')
  const write = (base, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true })
    fs.writeFileSync(path.join(base, rel), text)
  }
  for (const s of SOURCES) write(repo, s, 'one\ntwo\nthree\nfour\nfive\n')
  for (const [rel, text] of Object.entries(repoFiles)) write(repo, rel, text)
  const files = {
    'catalogue.json': catalogue === null ? null : JSON.stringify(catalogue),
    'index.md': LANDING,
    '01-getting-started/index.md': SECTION_INDEX,
    '01-getting-started/setup.md': goodPage('Setup', 'See [Usage](./usage.md).'),
    '01-getting-started/usage.md': goodPage('Usage'),
    ...pages,
  }
  fs.mkdirSync(wiki, { recursive: true })
  for (const [rel, text] of Object.entries(files)) if (text !== null) write(wiki, rel, text)
  return { repo, wiki }
}

const run = (f, opts = {}) => checkWiki({ wikiDir: f.wiki, repo: f.repo, ...opts })
const rules = (result, level = 'errors') => result[level].map((x) => x.rule)
const messages = (result, level = 'errors') => result[level].map((x) => x.message).join('\n')
const usage = (extra) => ({ '01-getting-started/usage.md': goodPage('Usage', extra) })
const withState = (state) => ({ '.deep-wiki.json': JSON.stringify(state) })
const cli = (...args) => spawnSync(process.execPath, [checker, ...args], { encoding: 'utf8' })

// ---------------------------------------------------------------------------
// Section index generator
// ---------------------------------------------------------------------------
test('section indexes take their title from the catalogue', (t) => {
  const f = fixture(t, { '01-getting-started/index.md': null })
  execFileSync(process.execPath, [genIndexes, f.wiki])
  const index = fs.readFileSync(path.join(f.wiki, '01-getting-started/index.md'), 'utf8')
  assert.match(index, /^---\r?\ntitle: "Getting Started"\r?\n/)
  assert.match(index, /\[Setup\]\(\.\/setup\.md\)/)
  assert.doesNotMatch(index, /undefined/)
  assert.deepEqual(run(f).errors, [])
})

test('a hand-written index without the marker is kept unless --force', (t) => {
  const f = fixture(t)
  const file = path.join(f.wiki, '01-getting-started/index.md')
  execFileSync(process.execPath, [genIndexes, f.wiki])
  assert.match(fs.readFileSync(file, 'utf8'), /title: Getting Started\n/)
  execFileSync(process.execPath, [genIndexes, f.wiki, '--force'])
  assert.match(fs.readFileSync(file, 'utf8'), /title: "Getting Started"/)
})

// ---------------------------------------------------------------------------
// Whole wiki
// ---------------------------------------------------------------------------
test('a clean wiki passes with no warnings and reports real counts', (t) => {
  const result = run(fixture(t))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.stats, { pages: 4, sections: 1, leaves: 2, diagrams: 6 })
  assert.deepEqual(result.report.at(-1), { section: 'Total', pages: 4, diagrams: 6, citedFiles: 5 })
  assert.deepEqual(result.report.find((r) => r.section === '(root)'), { section: '(root)', pages: 1, diagrams: 0, citedFiles: 0 })
})

test('a missing landing page is an error unless the run is --pending', (t) => {
  const f = fixture(t, { 'index.md': null })
  assert.deepEqual(rules(run(f)), ['landing'])
  assert.deepEqual(run(f, { pending: true }).errors, [])
})

test('CRLF and BOM files are read like any other', (t) => {
  const page = `${BOM}${goodPage('Usage').replace(/\n/g, '\r\n')}`
  assert.deepEqual(run(fixture(t, { '01-getting-started/usage.md': page })).errors, [])
  assert.equal(lib.parseFrontmatter(`${BOM}---\ntitle: A\n---\n`).data.title, 'A')
})

test('scripts and public are skipped at the wiki root only; dist and node_modules at any depth', (t) => {
  const pages = {
    '01-getting-started/scripts/build.md': goodPage('Build'),
    '01-getting-started/public/x.md': goodPage('X'),
    // VitePress never builds these two folders, wherever they are: they hold no pages.
    '01-getting-started/dist/old.md': 'not built',
    '01-getting-started/node_modules/pkg/readme.md': 'not built',
    'scripts/notes.md': 'not a page',
    'public/x.md': 'not a page',
  }
  const f = fixture(t, pages)
  const found = lib.listPages(f.wiki).filter((p) => /scripts|public|dist|node_modules/.test(p))
  assert.deepEqual(found, ['01-getting-started/public/x.md', '01-getting-started/scripts/build.md'])
  assert.deepEqual(run(f).errors, [])
})

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------
test('a sentence-long title ending in undefined is an error', (t) => {
  const title = `${'How the thing works in great detail, '.repeat(4)}with a quick reference.undefined`
  const f = fixture(t, { '01-getting-started/index.md': `---\ntitle: "${title}"\ndescription: Section.\n---\n\n# Getting Started\n` })
  assert.deepEqual(rules(run(f)), ['frontmatter', 'title-length'])
})

test('prose that ends in the word undefined is not a script artefact', (t) => {
  const page = goodPage('Usage').replace('A page used by the tests.', 'Why the handler returns undefined')
  assert.deepEqual(run(fixture(t, { '01-getting-started/usage.md': page })).errors, [])
})

test('frontmatter a YAML parser would reject is an error', (t) => {
  const page = (title, description = 'Fine.') => ({
    '01-getting-started/usage.md': goodPage('Usage').replace(/^---\n[\s\S]*?\n---\n/, `---\ntitle: ${title}\ndescription: ${description}\n---\n`),
  })
  assert.match(messages(run(fixture(t, page('CLI: Commands')))), /title must be wrapped in double quotes/)
  assert.match(messages(run(fixture(t, page('>-\n  A folded sentence')))), /title is a block scalar/)
  assert.match(messages(run(fixture(t, page('')))), /title is empty/)
  assert.match(messages(run(fixture(t, page('Usage', 'Notes #1 on usage')))), /description must be wrapped/)
  assert.deepEqual(run(fixture(t, page('"CLI: Commands"', '"Notes #1: usage"'))).errors, [])
})

test('{{ }} and tag-shaped text in frontmatter are errors', (t) => {
  const page = goodPage('Usage').replace('A page used by the tests.', 'How Repository<T> renders {{ value }}')
  assert.deepEqual(rules(run(fixture(t, { '01-getting-started/usage.md': page }))), ['interpolation', 'bare-tag'])
})

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------
test('{{ }} is an error in prose but not in code or v-pre', (t) => {
  const safe = ['Use `${{ github.ref }}`.', '', `${FENCE}yaml`, 'ref: ${{ github.ref }}', FENCE, '', '::: v-pre', '{{ raw }}', ':::', '', '<span v-pre>{{ x }}</span>'].join('\n')
  assert.deepEqual(run(fixture(t, usage(safe))).errors, [])
  assert.deepEqual(rules(run(fixture(t, usage('Use ${{ github.ref }} here.')))), ['interpolation'])
  assert.deepEqual(rules(run(fixture(t, usage('The v-pre directive does not excuse {{ this }}.')))), ['interpolation'])
})

test('bare generics are an error, allowed HTML is not', (t) => {
  const result = run(fixture(t, usage('Returns List<T> and <span>fine</span> and Foo<my_type>.')))
  assert.deepEqual(rules(result), ['bare-tag'])
  assert.match(result.errors[0].message, /<T>/)
})

test('single-letter generics that look like HTML tags are errors', (t) => {
  const found = rules(run(fixture(t, usage('Returns Promise<A>, Option<U>, Box<P>, Foo<S>.'))))
  assert.deepEqual(found, ['bare-tag', 'bare-tag', 'bare-tag', 'bare-tag'])
  assert.match(messages(run(fixture(t, usage('Use the <p> element.')))), /<p> is opened and closed a different number/)
  assert.deepEqual(run(fixture(t, usage('<details>\n<summary>More</summary>\n\nText<br>here.\n\n</details>'))).errors, [])
})

test('comments may span lines and hide their contents', (t) => {
  assert.deepEqual(run(fixture(t, usage('<!-- note\nMap<K> and {{ tpl }}\n-->\n\nDone.'))).errors, [])
})

test('inline triple backticks at line start do not open a fence', (t) => {
  const result = run(fixture(t, usage(`${FENCE}npm test${FENCE} runs tests.\n\nThen List<T> appears.`)))
  assert.deepEqual(rules(result), ['bare-tag'])
})

test('fences may use tildes and sit inside blockquotes', (t) => {
  const text = `~~~ts\nconst x: List<T> = {{ a }}\n~~~\n\n> ${FENCE}ts\n> let y: Map<K>\n> ${FENCE}`
  assert.deepEqual(run(fixture(t, usage(text))).errors, [])
})

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
test('broken links fail; links to pages still being written pass in --page mode', (t) => {
  const bad = fixture(t, { '01-getting-started/setup.md': goodPage('Setup', 'See [Nope](./nope.md).') })
  assert.deepEqual(rules(run(bad)), ['link'])
  const pending = fixture(t, { '01-getting-started/usage.md': null })
  assert.deepEqual(run(pending, { pages: ['01-getting-started/setup.md'] }).errors, [])
  assert.deepEqual(rules(run(pending)), ['link', 'catalogue-drift'])
})

test('links to onboarding are accepted before it exists with --page or --pending', (t) => {
  const page = goodPage('Setup', 'See [Guide](../onboarding/contributor-guide.md) and [Usage](./usage.md).')
  const f = fixture(t, { '01-getting-started/setup.md': page })
  assert.deepEqual(run(f, { pages: ['01-getting-started/setup.md'] }).errors, [])
  assert.deepEqual(run(f, { pending: true }).errors, [])
  assert.deepEqual(rules(run(f)), ['link'])
})

test('without a catalogue a --page link to a missing sibling is only a warning', (t) => {
  const f = fixture(t, { '01-getting-started/setup.md': goodPage('Setup', 'See [Later](./later.md).') }, { catalogue: null })
  const result = run(f, { pages: ['01-getting-started/setup.md'] })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(rules(result, 'warnings'), ['link'])
})

test('links to the wiki root and to folders with a trailing slash are valid', (t) => {
  const text = '[Home](../) and [Home](../index.md) and [Section](./) and [Section](../01-getting-started/) and [Setup](./setup).'
  const result = run(fixture(t, usage(text)))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})

test('README, AGENTS and CLAUDE files are never link targets, inside or outside the wiki', (t) => {
  // The site build leaves these files out, so the link would be dead on the site wherever the file is.
  const text = '[a](../AGENTS.md) [r](../../README.md) [c](../../CLAUDE.md) [n](./README.md) [x](../README)'
  const f = fixture(t, { ...usage(text), 'AGENTS.md': '# Agents\n', '01-getting-started/README.md': '# Readme\n' }, { repoFiles: { 'README.md': 'x' } })
  for (const result of [run(f), run(f, { site: true })]) {
    assert.deepEqual(rules(result), ['link', 'link', 'link', 'link', 'link'])
    assert.ok(result.errors.every((e) => /is not part of the site; cite the file/.test(e.message)), messages(result))
  }
})

test('a folder link without a trailing slash is an error: VitePress reports it dead', (t) => {
  const result = run(fixture(t, usage('[Top](..) and [Section](../01-getting-started) and [Here](.).')))
  assert.deepEqual(rules(result), ['link', 'link', 'link'])
  assert.match(result.errors[1].message, /folder link without a trailing slash.*link \.\.\/01-getting-started\/index\.md/)
})

test('a relative link that leaves the wiki is an error whatever its extension, also with --site', (t) => {
  const text = '[c](../../CONTRIBUTING.md) [p](../../logo.png) [s](../../src/a.ts)'
  const f = fixture(t, usage(text), { repoFiles: { 'CONTRIBUTING.md': 'x', 'logo.png': 'x' } })
  assert.deepEqual(rules(run(f)), ['link', 'link', 'link'])
  assert.deepEqual(rules(run(f, { site: true })), ['link', 'link', 'link'])
  assert.match(messages(run(f)), /CONTRIBUTING\.md leaves the wiki/)
  assert.match(messages(run(f)), /src\/a\.ts leaves the wiki/)
  assert.deepEqual(rules(run(fixture(t, usage('[m](../../src/main.py)')), { site: true })), ['link'])
})

test('a file in public/ is linked from the site root, not by a relative path', (t) => {
  const files = { 'public/logo.svg': '<svg/>', '01-getting-started/shot.png': 'x' }
  assert.deepEqual(run(fixture(t, { ...usage('![logo](/logo.svg) ![shot](./shot.png)'), ...files })).errors, [])
  const result = run(fixture(t, { ...usage('![logo](../logo.svg)'), ...files }))
  assert.deepEqual(rules(result), ['link'])
  assert.match(messages(result), /exists only in public\/; link it from the site root as \/logo\.svg/)
})

test('anchors use VitePress slugs and a stray % does not crash', (t) => {
  const f = fixture(t, usage('## 7. Limits\n\n[ok](#_7-limits) [bad](#7-limits) [odd](./setup.md#100%-coverage)'))
  const result = run(f)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(rules(result, 'warnings'), ['anchor', 'anchor'])
})

test('heading slugs match VitePress', () => {
  assert.equal(slugify('7. Performance SLAs'), '_7-performance-slas')
  assert.equal(slugify('Token `refresh()` & retry'), 'token-refresh-retry')
  assert.equal(slugify('`List<T>` handling'), 'list-t-handling')
  assert.equal(slugify('![logo](x.png) Title'), 'title')
  assert.equal(slugify('[Linked](./a.md) <b>bold</b> text'), 'linked-bold-text')
})

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------
test('citations must point at real files and lines', (t) => {
  assert.match(messages(run(fixture(t, usage('Also (src/a.ts:40-58).')))), /cites line 58 but src\/a\.ts has 5 lines/)
  const missing = fixture(t, usage('Also (src/zzz.ts:1).'))
  assert.match(messages(run(missing)), /not found in the repository/)
  assert.deepEqual(run(missing, { source: false }).errors, [])
  const notCitations = 'Ratios (3:1), ports (HTTP:80), notes (see: 5), and (https://x.dev:8080) are not citations.'
  assert.deepEqual(run(fixture(t, usage(notCitations))).errors, [])
})

test('local citations accept the file names real repositories have', (t) => {
  const names = ['Dockerfile', 'src/main/resources/application.properties', 'src/routes/+page.svelte', 'app/[slug]/page.tsx', 'app/(marketing)/page.tsx']
  const page = [
    frontmatter('Usage'),
    '# Usage',
    '',
    '(Dockerfile:1) (src/main/resources/application.properties:1) (src/routes/+page.svelte:1, app/[slug]/page.tsx:2)',
    '(app/(marketing)/page.tsx:~Page) (`src/a.ts:1`)',
    '',
    diagram('flowchart TD', '  A --> B'),
    diagram('sequenceDiagram', '  autonumber', '  A->>B: x'),
    diagram('flowchart LR', '  A --> B'),
  ].join('\n')
  const f = fixture(t, { '01-getting-started/usage.md': page }, { repoFiles: Object.fromEntries(names.map((n) => [n, 'a\nb\n'])) })
  const result = run(f)
  assert.deepEqual(result.errors, [])
  assert.equal(result.pages.find((p) => p.file.endsWith('usage.md')).citedFiles, 6)
})

test('Sources comments are verified like prose citations, across lines', (t) => {
  const page = goodPage('Usage').replace('<!-- Sources: src/a.ts:1 -->', '<!-- Sources:\n  src/a.ts:9999,\n  src/nope.ts:1\n-->')
  const result = run(fixture(t, { '01-getting-started/usage.md': page }))
  assert.deepEqual(rules(result), ['citation', 'citation'])
  assert.deepEqual(result.warnings, [])
})

test('citation case must match the file system', (t) => {
  const f = fixture(t, usage('See (src/A.ts:1).'))
  const text = messages(run(f))
  // A case-insensitive file system finds the file and reports its real spelling; a case-sensitive one does not find it.
  assert.match(text, fs.existsSync(path.join(f.repo, 'SRC', 'A.TS')) ? /the file is src\/a\.ts/ : /not found in the repository/)
})

test('host links are citations only for this repository', (t) => {
  const state = withState({ repoUrl: REPO_URL, branch: 'main' })
  const links = [
    `[a.ts:2-9](${REPO_URL}/blob/main/src/a.ts#L2-L9)`, // past the end of the file
    `[other](${REPO_URL}-other/blob/main/src/zzz.ts#L1)`, // look-alike repository
    '[express](https://github.com/expressjs/express/blob/master/lib/router/index.js)', // someone else
    '[search](https://example.com/search?path=/foo)',
  ].join(' ')
  const result = run(fixture(t, { ...usage(links), ...state }))
  assert.deepEqual(rules(result), ['citation'])
  assert.match(result.errors[0].message, /cites line 9 but src\/a\.ts has 5 lines/)
  // Case differences in the URL are the same repository.
  const upper = fixture(t, { ...usage('[z](https://github.com/O/R/blob/main/src/zzz.ts#L1)'), ...state })
  assert.match(messages(run(upper)), /not found in the repository/)
})

test('the configured branch is stripped exactly, so a wrong path cannot match by its tail', (t) => {
  const link = `[x](${REPO_URL}/blob/main/lib/src/a.ts#L2)`
  const main = withState({ repoUrl: REPO_URL, branch: 'main' })
  assert.match(messages(run(fixture(t, { ...usage(link), ...main }))), /not found in the repository/)
  const slash = `[x](${REPO_URL}/blob/feature/x/src/a.ts#L2)`
  assert.deepEqual(run(fixture(t, { ...usage(slash), ...withState({ repoUrl: REPO_URL, branch: 'feature/x' }) })).errors, [])
  assert.deepEqual(run(fixture(t, usage(slash)), { repoUrl: REPO_URL, branch: 'feature/x' }).errors, [])
})

test('GitLab and Azure DevOps citation links are parsed', (t) => {
  const gitlab = 'https://gitlab.com/o/r'
  const gl = fixture(t, { ...usage(`[a](${gitlab}/-/blob/main/src/a.ts#L2-9)`), ...withState({ repoUrl: gitlab, branch: 'main' }) })
  assert.match(messages(run(gl)), /cites line 9 but src\/a\.ts has 5 lines/)
  const ado = 'https://dev.azure.com/org/proj/_git/repo'
  const link = `[a](${ado}?path=/src/a.ts&version=GBmain&line=2&lineEnd=9&lineStartColumn=1&lineEndColumn=1)`
  const az = fixture(t, { ...usage(link), ...withState({ repoUrl: ado, branch: 'main' }) })
  assert.match(messages(run(az)), /cites line 9 but src\/a\.ts has 5 lines/)
})

test('with no repository URL an unresolved host link is not a citation', (t) => {
  // Nothing says which repository these links point at, so none of them can be called wrong:
  // a missing file is ignored, and a line past the end is not reported.
  const text = '[express](https://github.com/expressjs/express/blob/master/lib/router/index.js) [a](https://github.com/o/r/blob/main/src/a.ts#L9)'
  assert.deepEqual(run(fixture(t, usage(text))).errors, [])
})

test('with no repository URL a host link counts only when its whole path exists', (t) => {
  // "deep/src/e.ts" must not match src/e.ts by its tail.
  const page = goodPage('Usage').replace('(src/e.ts:1-3)', '[e](https://github.com/x/y/blob/main/deep/src/e.ts)')
  assert.match(messages(run(fixture(t, { '01-getting-started/usage.md': page }))), /cites 4 distinct source file/)
  const exact = goodPage('Usage').replace('(src/e.ts:1-3)', '[e](https://github.com/x/y/blob/main/src/e.ts)')
  assert.deepEqual(run(fixture(t, { '01-getting-started/usage.md': exact })).errors, [])
})

test('host names, ports, and image tags in parentheses are not citations', (t) => {
  const text = 'Connects to (db.internal:5432) and (example.com:443), image (library/postgres:16).'
  assert.deepEqual(run(fixture(t, usage(text))).errors, [])
  // With --no-source nothing can be looked up, so only text that is clearly a file counts.
  const bare = `${frontmatter('Usage')}\n# Usage\n\n${text} (README.md:1) (src/a.ts:1) (src/b.ts:2)\n\n${diagram('flowchart TD', '  A --> B')}`
  const result = run(fixture(t, { '01-getting-started/usage.md': bare }), { source: false, mode: 'crisp' })
  assert.deepEqual(result.pages.find((p) => p.file === '01-getting-started/usage.md').citedFiles, 3)
})

test('a citation of line 0 is an error; a link to a folder is not a citation', (t) => {
  const state = withState({ repoUrl: REPO_URL, branch: 'main' })
  assert.match(messages(run(fixture(t, { ...usage('See (src/a.ts:0).'), ...state }))), /line numbers start at 1/)
  assert.deepEqual(run(fixture(t, { ...usage(`See [src](${REPO_URL}/blob/main/src).`), ...state })).errors, [])
})

test('links with parentheses or brackets in the path are read whole', (t) => {
  const link = `[app/[slug]/page.tsx:1](${REPO_URL}/blob/main/app/(marketing)/page.tsx#L9)`
  const pages = { ...usage(link), ...withState({ repoUrl: REPO_URL, branch: 'main' }) }
  const f = fixture(t, pages, { repoFiles: { 'app/(marketing)/page.tsx': 'a\n' } })
  assert.match(messages(run(f)), /cites line 9 but app\/\(marketing\)\/page\.tsx has 1 lines/)
})

test('when the checker is pointed at the wrong repository it says so once', (t) => {
  const cites = Array.from({ length: 12 }, (_, i) => `(lib/x${i}.ts:1)`).join(' ')
  const page = goodPage('Usage').replace(/Facts: .*\n/, `${cites}\n`).replace(/<!-- Sources: [^>]* -->/g, '<!-- Sources: lib/x0.ts:1 -->')
  const catalogue = catalogueOf(leaf('setup', { prompt: 'Read lib/x0.ts.' }), leaf('usage', { prompt: 'Read lib/x1.ts.' }))
  const f = fixture(t, { '01-getting-started/usage.md': page, '01-getting-started/setup.md': page }, { catalogue })
  // The wrong root is a real project: it has plenty of files, just none of the cited ones. The
  // file minimum therefore stays at 5 and the "cites 0 files" findings exist until they are folded in.
  const wrongRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-other-'))
  t.after(() => fs.rmSync(wrongRoot, { recursive: true, force: true }))
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(wrongRoot, `other${i}.py`), 'x\n')
  assert.equal(lib.countSourceFiles(wrongRoot, f.wiki, 5), 5)
  const result = checkWiki({ wikiDir: f.wiki, repo: wrongRoot })
  assert.deepEqual(rules(result), ['citation'])
  assert.match(result.errors[0].message, /none of the \d+ cited files exist.*pass --repo/)
  assert.doesNotMatch(result.errors[0].message, /no-source/)
})

test('a few bad citations are reported one by one, never collapsed', (t) => {
  const page = goodPage('Usage').replace(/Facts: .*\n/, '(lib/x.ts:1) (lib/y.ts:2)\n')
  const f = fixture(t, { '01-getting-started/usage.md': page }, { catalogue: null })
  assert.equal(rules(run(f)).filter((r) => r === 'citation').length, 2)
})

// ---------------------------------------------------------------------------
// Thresholds and Mermaid
// ---------------------------------------------------------------------------
test('thresholds and Mermaid rules are enforced', (t) => {
  const thin = `${frontmatter('Usage', 'Thin.')}\n# Usage\n\n(src/a.ts:1)\n\n${FENCE}mermaid\nsequenceDiagram\n  A->>B: hi<br/>there\n${FENCE}\n`
  const pages = { '01-getting-started/usage.md': thin }
  const found = rules(run(fixture(t, pages)))
  assert.equal(found.filter((r) => r === 'threshold').length, 3)
  assert.equal(found.filter((r) => r === 'mermaid').length, 2)
  assert.deepEqual(rules(run(fixture(t, pages), { site: true })), ['mermaid', 'mermaid'])
})

test('crisp depth lowers the thresholds, from the flag or the state file', (t) => {
  const crisp = `${frontmatter('Usage')}\n# Usage\n\n(src/a.ts:1) (src/b.ts:1) (src/c.ts:1)\n\n${diagram('flowchart TD', '  A --> B')}`
  const pages = { '01-getting-started/usage.md': crisp, '01-getting-started/setup.md': crisp }
  assert.equal(rules(run(fixture(t, pages))).filter((r) => r === 'threshold').length, 6)
  assert.deepEqual(run(fixture(t, pages), { mode: 'crisp' }).errors, [])
  const stateful = { ...pages, ...withState({ depth: 'crisp' }) }
  assert.deepEqual(run(fixture(t, stateful)).errors, [])
  assert.equal(run(fixture(t, stateful)).mode, 'crisp')
  assert.equal(run(fixture(t, stateful), { mode: 'full' }).mode, 'full')
})

test('minFiles lowers the cited-file floor for one catalogue page', (t) => {
  const pages = { '01-getting-started/usage.md': goodPage('Usage').replace(/Facts: .*\n/, '(src/a.ts:1) (src/b.ts:1)\n').replace(/<!-- Sources: [^>]* -->/g, '<!-- Sources: src/a.ts:1 -->') }
  const withMin = (minFiles) => ({ catalogue: catalogueOf(leaf('setup'), leaf('usage', { minFiles })) })
  assert.match(messages(run(fixture(t, pages))), /cites 2 distinct source file\(s\); a full page needs at least 5/)
  assert.deepEqual(run(fixture(t, pages, withMin(2))).errors, [])
  assert.match(messages(run(fixture(t, pages, withMin(1)))), /minFiles must be an integer from 2 to 4/)
})

test('onboarding guides have their own minimums', (t) => {
  const empty = `${frontmatter('Guide')}\n# Guide\n`
  const f = fixture(t, { 'onboarding/contributor-guide.md': empty, 'onboarding/executive-guide.md': empty, 'onboarding/index.md': empty })
  const result = run(f)
  const of = (name) => result.errors.filter((e) => e.file === `onboarding/${name}`).map((e) => e.message)
  assert.deepEqual(of('contributor-guide.md'), [
    '0 Mermaid diagram(s); a full onboarding guide needs at least 5',
    '0 diagram type(s); a full onboarding guide needs at least 2',
    'cites 0 distinct source file(s); a full onboarding guide needs at least 5',
  ])
  assert.deepEqual(of('executive-guide.md'), [
    '0 Mermaid diagram(s); a full onboarding guide needs at least 3',
    '0 diagram type(s); a full onboarding guide needs at least 2',
  ])
  assert.deepEqual(of('index.md'), [])
})

test('pages outside sections and onboarding have no thresholds', (t) => {
  const page = `${frontmatter('Changelog')}\n# Changelog\n\n- fixed things\n`
  assert.deepEqual(run(fixture(t, { 'changelog.md': page, 'research/topic.md': page })).errors, [])
})

test('Mermaid frontmatter does not hide the diagram type', (t) => {
  const page = goodPage('Usage').replace('sequenceDiagram\n  autonumber', '---\ntitle: Flow\n---\nsequenceDiagram')
  assert.match(messages(run(fixture(t, { '01-getting-started/usage.md': page }))), /sequenceDiagram without autonumber/)
})

test('light fills are errors whatever their notation; dark palette fills pass', (t) => {
  const style = (fill) => ({ '01-getting-started/usage.md': goodPage('Usage').replace('  A --> B', `  A --> B\n  style A fill:${fill},stroke:#6d5dfc,color:#e6edf3`) })
  for (const fill of ['#f9f', '#ffeb3b', '#90caf9', '#ffcc00', 'white', '#fff', '#e1f5fe']) {
    assert.match(messages(run(fixture(t, style(fill)))), /light-mode color/, fill)
  }
  for (const fill of ['#2d333b', '#161b22', '#1a3a2a', '#3a1d1d']) {
    assert.deepEqual(run(fixture(t, style(fill))).errors, [], fill)
  }
  assert.match(messages(run(fixture(t, style('#2d33')))), /3 or 6 digits/)
})

test('too many sequence participants and %%{init}%% are warnings', (t) => {
  const many = ['sequenceDiagram', '  autonumber', ...'ABCDEFG'.split('').map((p) => `  participant ${p}`), '  A->>B: x']
  const page = goodPage('Usage').replace(diagram('sequenceDiagram', '  autonumber', '  A->>B: call'), diagram("%%{init: {'theme':'dark'}}%%", ...many))
  const result = run(fixture(t, { '01-getting-started/usage.md': page }))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(rules(result, 'warnings'), ['mermaid', 'mermaid'])
})

test('wide tables and malformed llms.txt lines are reported', (t) => {
  const table = '| A | B | C | D | E | F |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |'
  const llms = [
    '# Demo',
    '<!-- generated by deep-wiki -->',
    '',
    '- [ Setup](./01-getting-started/setup.md):  Two spaces.',
    '- [Usage](./01-getting-started/usage.md): Fine.',
    '- [Gone](./gone.md): Missing.',
    '',
  ].join('\n')
  const result = run(fixture(t, { ...usage(table), 'llms.txt': llms }))
  assert.deepEqual(rules(result), ['llms', 'llms'])
  assert.deepEqual(rules(result, 'warnings'), ['table'])
})

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
test('catalogue schema problems are errors', (t) => {
  const catalogue = { project: 'Demo', summary: 's', items: [{ title: 'Bad Title', name: 'X', dir: 'guide', children: [] }] }
  const text = messages(run(fixture(t, {}, { catalogue }), { catalogueOnly: true }))
  assert.match(text, /kebab-case/)
  assert.match(text, /NN-slug/)
  assert.match(text, /no pages/)
})

test('--catalogue-only fails when there is nothing valid to check', (t) => {
  const only = (catalogue) => run(fixture(t, {}, { catalogue }), { catalogueOnly: true })
  assert.match(messages(only(null)), /catalogue\.json not found/)
  assert.match(messages(only([])), /`items` array/)
  assert.match(messages(only({ items: {} })), /`items` array/)
  assert.match(messages(only({ items: [] })), /no pages/)
  assert.match(messages(only({ items: [null, 'x'] })), /items\[0\] is not an object/)
  const broken = fixture(t, { 'catalogue.json': '{ not json' })
  assert.match(messages(run(broken, { catalogueOnly: true })), /invalid JSON/)
  assert.deepEqual(only(CATALOGUE).errors, [])
})

test('catalogue pages must be named, placed, and childless', (t) => {
  const only = (catalogue) => messages(run(fixture(t, {}, { catalogue }), { catalogueOnly: true }))
  assert.match(only(catalogueOf(leaf('setup', { path: '01-getting-started/index.md' }))), /index\.md is generated/)
  assert.match(only(catalogueOf(leaf('setup', { path: '02-other/setup.md' }))), /not inside its section folder 01-getting-started\//)
  assert.match(only(catalogueOf(leaf('setup', { children: [leaf('deep')] }))), /a page cannot have children/)
  assert.match(only({ project: 'D', summary: 's', items: [leaf('setup')] }), /not inside a section/)
})

test('catalogue prompts that name missing files or lines are warnings', (t) => {
  const prompt = 'Read src/a.ts:1-900, src/missing.ts, etc/conf.d/ and the Node.js/Express.js stack.'
  const f = fixture(t, {}, { catalogue: catalogueOf(leaf('setup', { prompt }), leaf('usage')), repoFiles: { 'etc/conf.d/x.conf': 'x' } })
  const result = run(f, { catalogueOnly: true })
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 2)
  assert.match(messages(result, 'warnings'), /src\/a\.ts:1-900 but the file has 5 lines/)
  assert.match(messages(result, 'warnings'), /src\/missing\.ts, which is not in the repository/)
})

test('pages and folders the catalogue does not list are warnings; --site ignores the catalogue', (t) => {
  const pages = {
    '01-getting-started/extra.md': goodPage('Extra'),
    '01-getting-started/old/index.md': SECTION_INDEX,
    '09-gone/page.md': goodPage('Gone'),
    '01-getting-started/usage.md': null,
    '01-getting-started/setup.md': goodPage('Setup'),
  }
  const f = fixture(t, pages)
  const result = run(f)
  assert.deepEqual(rules(result), ['catalogue-drift'])
  assert.equal(rules(result, 'warnings').filter((r) => r === 'catalogue-drift').length, 3)
  assert.deepEqual(run(f, { site: true }).errors, [])
})

test('unfilled placeholders are errors', (t) => {
  const f = fixture(t, { '.vitepress/config.mts': "const SITE_TITLE = '__SITE_TITLE__'\n", 'package.json': '{"name":"__PACKAGE_NAME__-wiki"}' })
  assert.deepEqual(rules(run(f, { site: true })), ['placeholder', 'placeholder'])
})

// ---------------------------------------------------------------------------
// Leftovers
// ---------------------------------------------------------------------------
test('the baseline separates what was there from what the run left behind', (t) => {
  const f = fixture(t)
  const git = (...args) => execFileSync('git', ['-C', f.repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { stdio: 'ignore' })
  try {
    git('init', '-q')
    git('add', 'src')
    git('commit', '-q', '-m', 'src')
  } catch {
    return t.skip('git is not available')
  }
  fs.writeFileSync(path.join(f.repo, 'notes.txt'), 'mine')
  const baseline = path.join(f.wiki, '.vitepress', 'cache', 'baseline.txt')
  assert.equal(cli(f.wiki, '--write-baseline', baseline).status, 0)
  assert.deepEqual(run(f, { baseline }).warnings, [])

  fs.writeFileSync(path.join(f.repo, 'testResults.xml'), '<x/>')
  fs.writeFileSync(path.join(f.repo, 'src/a.ts'), 'changed\n'.repeat(5))
  fs.writeFileSync(path.join(f.wiki, 'scratch.log'), 'x')
  fs.writeFileSync(path.join(f.repo, 'AGENTS.md'), '# Agents\n')
  const left = run(f, { baseline }).warnings.filter((w) => w.rule === 'leftover')
  assert.deepEqual(left.map((w) => w.file).sort(), ['src/a.ts', 'testResults.xml', 'wiki/scratch.log'])
  assert.match(left.find((w) => w.file === 'src/a.ts').message, /tracked file changed/)

  // A missing or UTF-16 baseline must never read as "nothing was there before".
  assert.deepEqual(rules(run(f, { baseline: path.join(f.repo, 'none.txt') })), ['baseline'])
  const utf16 = path.join(f.repo, 'utf16.txt')
  fs.writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('?? notes.txt\n', 'utf16le')]))
  const result = run(f, { baseline: utf16 })
  assert.match(messages(result), /not UTF-8 text/)
  assert.deepEqual(result.warnings.filter((w) => w.rule === 'leftover'), [])
})

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------
test('parseArgs accepts both option styles and rejects bad input', () => {
  assert.equal(parseArgs(['wiki', '--mode=crisp']).mode, 'crisp')
  assert.deepEqual(parseArgs(['--page', 'a.md', '--page=b.md']).pages, ['a.md', 'b.md'])
  assert.equal(parseArgs(['--no-source']).source, false)
  for (const bad of [['--page'], ['--mode', 'fast'], ['--bogus'], ['--repo', '--json'], ['--json=1']]) {
    assert.throws(() => parseArgs(bad), UsageError, bad.join(' '))
  }
})

test('exit codes: 0 clean, 1 findings, 2 usage or missing input', (t) => {
  const f = fixture(t)
  assert.equal(cli(f.wiki, '--repo', f.repo).status, 0)
  const bad = fixture(t, usage('Returns List<T>.'))
  const failed = cli(bad.wiki, '--repo', bad.repo)
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /\[bare-tag\]/)
  assert.match(failed.stdout, /full \| catalogue: 1 section\(s\), 2 page\(s\)/)
  assert.equal(cli(f.wiki, '--bogus').status, 2)
  const gone = cli(path.join(f.repo, 'no-such-wiki'))
  assert.equal(gone.status, 2)
  assert.match(gone.stderr, /wiki folder not found/)
  assert.equal(gone.stderr.trim().split('\n').length, 1)
  assert.equal(cli(f.wiki, '--page', path.join(os.tmpdir(), 'elsewhere.md')).status, 2)
})

test('--json prints one object, also for usage errors; --report prints the table', (t) => {
  const f = fixture(t)
  const ok = JSON.parse(cli(f.wiki, '--repo', f.repo, '--json').stdout)
  assert.deepEqual(Object.keys(ok), ['ok', 'mode', 'errors', 'warnings', 'stats', 'pages', 'report', 'repoRoot', 'notes'])
  assert.equal(ok.ok, true)
  const usageError = cli(path.join(f.repo, 'no-such-wiki'), '--json')
  assert.equal(usageError.status, 2)
  assert.equal(JSON.parse(usageError.stdout).ok, false)
  const report = cli(f.wiki, '--repo', f.repo, '--report').stdout
  assert.match(report, /\| Section \| Pages \| Diagrams \| Cited files \|/)
  // Rows carry the section's catalogue name, not its folder name.
  assert.match(report, /\| Getting Started \| 3 \| 6 \| 5 \|/)
  assert.match(report, /\| Total \| 4 \| 6 \| 5 \|/)
})

test('--page prefers the wiki-relative path over the working directory', (t) => {
  const f = fixture(t, {}, { repoFiles: { 'index.md': 'not a wiki page, no frontmatter' } })
  const at = (page) => JSON.parse(spawnSync(process.execPath, [checker, 'wiki', '--repo', '.', '--page', page, '--json'], { cwd: f.repo, encoding: 'utf8' }).stdout)
  assert.equal(at('index.md').ok, true)
  assert.deepEqual(at('wiki/01-getting-started/setup.md').pages.map((p) => p.file), ['01-getting-started/setup.md'])
})

test('lib exports the shared helpers', (t) => {
  assert.deepEqual(lib.ONBOARDING_ORDER, ['index.md', 'contributor-guide.md', 'staff-engineer-guide.md', 'executive-guide.md', 'product-manager-guide.md'])
  const f = fixture(t, withState({ depth: 'crisp', branch: 'main' }))
  assert.deepEqual(lib.loadState(f.wiki), { depth: 'crisp', branch: 'main' })
  assert.deepEqual(lib.loadState(f.repo), {})
  fs.writeFileSync(path.join(f.wiki, '.deep-wiki.json'), '[1]')
  assert.deepEqual(lib.loadState(f.wiki), {})
  fs.writeFileSync(path.join(f.repo, 'bom.txt'), `${BOM}text`)
  assert.equal(lib.readText(path.join(f.repo, 'bom.txt')), 'text')
  for (const name of ['MARKER', 'parseFrontmatter', 'yamlString', 'loadCatalogue', 'walkCatalogue', 'resolveDir', 'listPages', 'posix']) assert.ok(lib[name], name)
})

// ---------------------------------------------------------------------------
// Round two: fences, frontmatter, catalogue, site resolution, thresholds
// ---------------------------------------------------------------------------
test('a fence indented inside a list item is still a fence', (t) => {
  const text = ['1. Add the workflow:', '', `    ${FENCE}yaml`, '    token: ${{ secrets.X }}', '    type: List<T>', '    [gone](./nope.md)', `    ${FENCE}`, '', '2. Done.'].join('\n')
  assert.deepEqual(run(fixture(t, usage(text))).errors, [])
  const scan = lib.createFenceScanner()
  const kinds = ['- item', `      ${FENCE}js`, 'code', `      ${FENCE}`, 'text', `${FENCE}npm test${FENCE} runs`, `        ${FENCE}js`].map((l) => scan(l).kind)
  assert.deepEqual(kinds, ['text', 'open', 'code', 'close', 'text', 'text', 'text'])
})

test('{{ }} is live in a fence whose language ends in -vue', (t) => {
  assert.deepEqual(rules(run(fixture(t, usage(`${FENCE}js-vue\nconst a = {{ value }}\n${FENCE}`)))), ['interpolation'])
  assert.deepEqual(run(fixture(t, usage(`${FENCE}js\nconst a = {{ value }}\n${FENCE}`))).errors, [])
})

test('quoted frontmatter is read as YAML reads it', (t) => {
  const issue = (title) => lib.parseFrontmatter(`---\ntitle: ${title}\ndescription: x\n---\n`).issues[0]?.problem ?? null
  assert.match(issue('"Path C:\\Users\\x"'), /invalid escape "\\U"/)
  assert.match(issue('"Matches \\d+ digits"'), /invalid escape "\\d"/)
  assert.match(issue('"He said "hi" there"'), /text after its closing quote/)
  assert.match(issue("'it's'"), /text after its closing quote/)
  assert.match(issue('"never closed'), /unbalanced quote/)
  for (const fine of ['"A" # a comment', '"Path C:\\\\Users\\\\x"', '"He said \\"hi\\""', "'it''s'", '"Tab\\there and \\u00e9"']) assert.equal(issue(fine), null, fine)
  const data = lib.parseFrontmatter(`---\ntitle: "A \\"b\\" \\\\ c" # note\ndescription: 'it''s'\n---\n`).data
  assert.deepEqual(data, { title: 'A "b" \\ c', description: "it's" })
  const page = goodPage('Usage').replace('title: Usage', 'title: "C:\\Users"')
  assert.deepEqual(rules(run(fixture(t, { '01-getting-started/usage.md': page }))), ['frontmatter'])
})

test('light fills in rgb() and hsl() notation are errors too', (t) => {
  const block = diagram('flowchart TD', '  A --> B', '  style A fill:rgb(255, 255, 255)', '  style B fill:hsl(210, 40%, 92%)', '  style A fill:rgb(45,51,59),stroke:hsl(0, 0%, 95%)')
  const result = run(fixture(t, usage(block)))
  assert.deepEqual(rules(result), ['mermaid', 'mermaid'])
  assert.match(messages(result), /fill:rgb\(255, 255, 255\) is a light-mode color/)
})

test('figure and its relatives are allowed HTML', (t) => {
  assert.deepEqual(run(fixture(t, usage('<figure>x<figcaption>cap</figcaption></figure> long<wbr>word'))).errors, [])
  assert.ok(lib.HTML_TAGS.has('tfoot') && lib.HTML_TAGS.has('caption'))
})

test('catalogue folders must be safe, unique, and inside the wiki', (t) => {
  const section = (dir, extra = {}) => ({ title: dir.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x', name: 'Sec', dir, children: [leaf('setup', { path: `${dir}/setup.md` })], ...extra })
  const only = (...items) => messages(run(fixture(t, {}, { catalogue: { project: 'D', summary: 's', items } }), { catalogueOnly: true }))
  assert.match(only(section('../outside')), /must stay inside the wiki/)
  assert.match(only(section('01-a/../../x')), /must stay inside the wiki/)
  assert.match(only(section('01-a/dist')), /folder "dist" is reserved/)
  assert.match(only(section('01-a/Scripts_Old')), /must be lowercase kebab-case/)
  assert.match(only(section('01-a'), { ...section('01-a'), title: 'again' }), /dir 01-a is used by two sections/)
  assert.match(only(section('01-a', { name: 'Core <Api>' })), /name must not contain <, >, \{\{ or \}\}/)
  assert.match(only(section('01-a', { description: 'Uses {{ x }}' })), /description must not contain/)
  assert.equal(only(section('01-a', { description: 'Fine.' }), section('02-b/deep-er')), '')
})

test('--site does not check the catalogue at all', (t) => {
  const broken = { project: 'D', summary: 's', items: [{ title: 'Bad Title', name: 'Core <Api>', dir: 'guide', children: [] }] }
  assert.deepEqual(run(fixture(t, {}, { catalogue: broken }), { site: true }).errors, [])
  assert.deepEqual(run(fixture(t, { 'catalogue.json': '{ not json' }), { site: true }).errors, [])
  assert.ok(run(fixture(t, {}, { catalogue: broken })).errors.length > 0)
})

test('--pending skips the llms checks, which only make sense once every page exists', (t) => {
  const f = fixture(t, { 'llms-full.txt': '# Demo\n<!-- generated by deep-wiki -->\n' })
  assert.deepEqual(rules(run(f)), ['llms'])
  assert.deepEqual(run(f, { pending: true }).errors, [])
})

test('the site config is authoritative for the repository URL, branch, and base', (t) => {
  const config = ["const BASE = '/from-config/'", "const REPO_URL = 'https://github.com/o/r'", 'const BRANCH = "main" // default branch', ''].join('\n')
  const f = fixture(t, { '.vitepress/config.mts': config, ...withState({ repoUrl: 'https://github.com/old/name', branch: 'old', base: '/old/', host: 'github' }) })
  assert.deepEqual(lib.resolveSite(f.wiki), { hasSite: true, base: '/from-config/', repoUrl: REPO_URL, branch: 'main', host: 'github' })
  // A constant someone turned into an expression falls back to the state file.
  fs.writeFileSync(path.join(f.wiki, '.vitepress/config.mts'), config.replace("const BASE = '/from-config/'", "const BASE = process.env.BASE ?? '/'"))
  assert.equal(lib.resolveSite(f.wiki).base, '/old/')
  // No config: no site, and the state file is all there is.
  fs.rmSync(path.join(f.wiki, '.vitepress'), { recursive: true })
  assert.deepEqual(lib.resolveSite(f.wiki), { hasSite: false, base: '/old/', repoUrl: 'https://github.com/old/name', branch: 'old', host: 'github' })
  assert.equal(lib.inferHost('https://bitbucket.org/a/b'), 'local')
})

test('the cited-file minimum never exceeds the number of source files', (t) => {
  const two = goodPage('Usage').replace(/ \(src\/[cde]\.ts:1-3\)/g, '')
  const pages = { '01-getting-started/usage.md': two, '01-getting-started/setup.md': null, 'index.md': `${frontmatter('Demo')}\n# Demo\n` }
  const f = fixture(t, pages, { catalogue: catalogueOf(leaf('usage')) })
  assert.match(messages(run(f)), /cites 2 distinct source file\(s\); a full page needs at least 5/)
  for (const n of ['c', 'd', 'e']) fs.rmSync(path.join(f.repo, `src/${n}.ts`))
  assert.deepEqual(run(f).errors, [])
  assert.equal(lib.countSourceFiles(f.repo, f.wiki), 2)
})

test('a page may declare crisp depth for itself in a full wiki', (t) => {
  const crisp = `---\ntitle: Usage\ndescription: A crisp page.\ndepth: crisp\n---\n\n# Usage\n\n(src/a.ts:1) (src/b.ts:1) (src/c.ts:1)\n\n${diagram('flowchart TD', '  A --> B')}`
  assert.deepEqual(run(fixture(t, { '01-getting-started/usage.md': crisp })).errors, [])
  assert.equal(rules(run(fixture(t, { '01-getting-started/usage.md': crisp.replace('depth: crisp\n', '') }))).filter((r) => r === 'threshold').length, 3)
})

test('only the four named guides get onboarding minimums', (t) => {
  const empty = `${frontmatter('Notes')}\n# Notes\n`
  const result = run(fixture(t, { 'onboarding/notes.md': empty, 'onboarding/deep/contributor-guide.md': empty }))
  assert.deepEqual(result.errors, [])
})

test('local wikis keep full paths in tables; one-dash delimiter rows are tables too', (t) => {
  const long = '(src/main/java/com/example/project/module/submodule/VeryLongServiceImplementationName.java:120-180)'
  const table = `| File | Source |\n|-|-|\n| Service | ${long} |`
  const wide = '| A | B | C | D | E | F |\n|:-|-|-:|-|-|-|\n| 1 | 2 | 3 | 4 | 5 | 6 |'
  const local = run(fixture(t, { ...usage(`${table}\n\n${wide}`), ...withState({ host: 'local' }) }), { source: false })
  assert.deepEqual(local.warnings.map((w) => w.message.slice(0, 9)), ['6 columns'])
  const hosted = run(fixture(t, { ...usage(table), ...withState({ host: 'github', repoUrl: REPO_URL, branch: 'main' }) }), { source: false })
  assert.match(messages(hosted, 'warnings'), /unbreakable 99-character cell text/)
})

test('the marker counts only where the generators put it', () => {
  assert.equal(lib.isMarked(`---\ntitle: a\n---\n\n# T\n${lib.MARKER}\n\nText.\n`), true)
  assert.equal(lib.isMarked(`# T\n${lib.MARKER}\n`), true)
  assert.equal(lib.isMarked(`# T\n\none\n\ntwo\n\nthree\n\nfour\n\nThis wiki writes \`${lib.MARKER}\` into files.\n\n${lib.MARKER}\n`), false)
})

test('command-line values: one wiki folder, no URL spelled three ways', () => {
  assert.throws(() => parseArgs(['wiki', 'other']), UsageError)
  assert.equal(parseArgs(['wiki', '--repo-url', '']).repoUrl, '')
  assert.equal(parseArgs(['wiki', '--repo-url', 'none']).repoUrl, '')
  assert.equal(parseArgs(['wiki', "--repo-url=''"]).repoUrl, '')
  assert.equal(parseArgs(['--repo-url', 'https://github.com/o/r.git/']).repoUrl, 'https://github.com/o/r')
  assert.throws(() => parseArgs(['--branch', '']), UsageError)
  assert.equal(parseArgs([]).wikiDir, '.')
  assert.equal(slugify('A &amp; B'), 'a-b')
})

test('the leftover check knows the llms input file and works when the wiki is the repository root', (t) => {
  const f = fixture(t)
  const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { stdio: 'ignore' })
  try {
    gitIn(f.wiki, 'init', '-q')
  } catch {
    return t.skip('git is not available')
  }
  const baseline = path.join(f.wiki, '.vitepress', 'cache', 'baseline.txt')
  assert.equal(cli(f.wiki, '--write-baseline', baseline).status, 0)
  fs.writeFileSync(path.join(f.wiki, '.deep-wiki-llms.json'), '{}')
  fs.writeFileSync(path.join(f.wiki, '01-getting-started/extra.md'), goodPage('Extra'))
  fs.writeFileSync(path.join(f.wiki, 'scratch.log'), 'x')
  const left = checkWiki({ wikiDir: f.wiki, repo: f.wiki, baseline, source: false }).warnings.filter((w) => w.rule === 'leftover')
  assert.deepEqual(left.map((w) => w.file), ['scratch.log'])
})

test('the leftover check works when --repo is a folder inside the git repository', (t) => {
  const f = fixture(t)
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-outer-'))
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }))
  const project = path.join(outer, 'proj')
  fs.cpSync(f.repo, project, { recursive: true })
  try {
    execFileSync('git', ['-C', outer, 'init', '-q'], { stdio: 'ignore' })
  } catch {
    return t.skip('git is not available')
  }
  const wiki = path.join(project, 'wiki')
  const baseline = path.join(wiki, '.vitepress', 'cache', 'baseline.txt')
  assert.equal(cli(wiki, '--repo', project, '--write-baseline', baseline).status, 0)
  fs.writeFileSync(path.join(wiki, '.deep-wiki-llms.json'), '{}')
  fs.writeFileSync(path.join(project, 'testResults.xml'), '<x/>')
  const left = checkWiki({ wikiDir: wiki, repo: project, baseline }).warnings.filter((w) => w.rule === 'leftover')
  assert.deepEqual(left.map((w) => w.file), ['proj/testResults.xml'])
})

// ---------------------------------------------------------------------------
// Round three: what Markdown really renders
// ---------------------------------------------------------------------------
test('a pipe inside inline code in a table row is an error: GFM splits the cell there', (t) => {
  const table = (cell) => ['| Name | Type |', '|------|------|', '| x | ' + cell + ' |'].join('\n')
  const generic = run(fixture(t, usage(table('`Array<Item> | null`'))))
  assert.deepEqual(rules(generic).sort(), ['bare-tag', 'table'])
  assert.match(messages(generic), /has a \| inside inline code in a table row.*escape it as \\\|/)
  const helm = fixture(t, usage(table('`{{ .Values.x | quote }}`')))
  assert.deepEqual(rules(run(helm)).sort(), ['interpolation', 'table'])
  // --site keeps what breaks the build (the exposed `{{ }}`) and drops the table rule itself.
  assert.deepEqual(rules(run(helm, { site: true })), ['interpolation'])
  assert.deepEqual(run(fixture(t, usage(table('`string | null`'))), { site: true }).errors, [])
  assert.deepEqual(rules(run(fixture(t, usage(table('`string | null`'))))), ['table'])
  // Escaped, the code span holds together and protects its content.
  assert.deepEqual(run(fixture(t, usage(table('`Array<Item> \\| null`')))).errors, [])
  // A pipe in code outside a table is ordinary code.
  assert.deepEqual(run(fixture(t, usage('Returns `Array<Item> | null`.'))).errors, [])
})

test('inside a raw HTML block backticks protect nothing', (t) => {
  const tight = ['<details>', '<summary>More</summary>', 'The token is `${{ secrets.T }}` and `List<T>`.', '</details>'].join('\n')
  const result = run(fixture(t, usage(tight)))
  assert.deepEqual(rules(result).sort(), ['bare-tag', 'interpolation'])
  assert.ok(result.errors.every((e) => /raw HTML block.*leave a blank line after the opening tag/.test(e.message)), messages(result))
  // With the blank line Markdown is back on and the code spans are real.
  const loose = ['<details>', '<summary>More</summary>', '', 'The token is `${{ secrets.T }}` and `List<T>`.', '', '</details>'].join('\n')
  assert.deepEqual(run(fixture(t, usage(loose))).errors, [])
})

test('reference-style, titled and angle-bracket links are checked like any other', (t) => {
  const broken = ["See [Setup][s] and [x](./nope.md 'title') and [y](<./no pe.md>) and [z](./gone.md (title)).", '', '[s]: ./missing.md'].join('\n')
  const result = run(fixture(t, usage(broken)))
  assert.deepEqual(rules(result), ['link', 'link', 'link', 'link'])
  for (const name of ['nope.md', 'no pe.md', 'gone.md', 'missing.md']) assert.match(messages(result), new RegExp('no 01-getting-started/' + name.replace('.', '\\.')))
  const fine = ["See [Setup][s] and [x](./setup.md 'title') and [y](<./setup.md>) and [cdn](//example.com/x.js).", '', '[s]: ./setup.md "Setup"', '[^1]: a footnote, not a link'].join('\n')
  const ok = run(fixture(t, usage(fine)))
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.warnings, [])
})

test('a reference-style citation counts and is verified', (t) => {
  const text = 'See [a.ts:2-9][src].\n\n[src]: ' + REPO_URL + '/blob/main/src/a.ts#L2-L9'
  const result = run(fixture(t, { ...usage(text), ...withState({ repoUrl: REPO_URL, branch: 'main' }) }))
  assert.match(messages(result), /cites line 9 but src\/a\.ts has 5 lines/)
})

test('site-root assets must be in public/, and a linked data file is not published', (t) => {
  const files = { '01-getting-started/shot.png': 'x', '01-getting-started/data.json': '{}', 'public/logo.svg': '<svg/>' }
  const root = run(fixture(t, { ...usage('![s](/01-getting-started/shot.png) ![gone](/nope.png) ![ok](/logo.svg)'), ...files }))
  assert.deepEqual(rules(root), ['link', 'link'])
  assert.match(messages(root), /site-root path, but the file is not in public\//)
  assert.match(messages(root), /no public\/nope\.png/)
  const data = run(fixture(t, { ...usage('[data](./data.json) and ![shot](./shot.png)'), ...files }))
  assert.deepEqual(data.errors, [])
  assert.deepEqual(rules(data, 'warnings'), ['link'])
  assert.match(messages(data, 'warnings'), /data\.json is a file the site does not publish/)
})

test('extensionless files are cited and verified like any other file', (t) => {
  const repoFiles = { Dockerfile: 'FROM node\n', 'build/Makefile': 'all:\n' }
  const bad = run(fixture(t, usage('See (Dockerfile:9999) and (src/Dockerfle:3) and (build/Makefile:7).'), { repoFiles }))
  assert.deepEqual(rules(bad), ['citation', 'citation', 'citation'])
  assert.match(messages(bad), /cites line 9999 but Dockerfile has 1 lines/)
  assert.match(messages(bad), /cited file not found in the repository: src\/Dockerfle:3/)
  assert.match(messages(bad), /cites line 7 but build\/Makefile has 1 lines/)
  // An image tag, a host and a port are not files: nothing to report, nothing counted.
  const ok = run(fixture(t, usage('Runs (library/postgres:16) on (db.internal:5432) at (port:8080); see (Dockerfile:1).'), { repoFiles }))
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.pages.find((p) => p.file.endsWith('usage.md')).citedFiles, 6)
  // Without the source, only names that are clearly files count.
  const blind = run(fixture(t, usage('(library/postgres:16) (port:8080) (Dockerfile:1)'), { repoFiles }), { source: false })
  assert.equal(blind.pages.find((p) => p.file.endsWith('usage.md')).citedFiles, 6)
})

test('line 0 is an error in every citation form', (t) => {
  const ado = 'https://dev.azure.com/o/p/_git/r'
  const adoLink = '[a.ts](' + ado + '?path=/src/a.ts&version=GBmain&line=0&lineEnd=0)'
  assert.match(messages(run(fixture(t, { ...usage(adoLink), ...withState({ repoUrl: ado, branch: 'main' }) }))), /line numbers start at 1/)
  const gh = '[a.ts:0](' + REPO_URL + '/blob/main/src/a.ts#L0)'
  assert.match(messages(run(fixture(t, { ...usage(gh), ...withState({ repoUrl: REPO_URL, branch: 'main' }) }))), /line numbers start at 1/)
  assert.match(messages(run(fixture(t, usage('(src/a.ts:0)')))), /line numbers start at 1/)
})

test('only a fence opened with exactly mermaid is a diagram', (t) => {
  const block = (info) => [FENCE + info, 'flowchart TD', '  A --> B', FENCE, '<!-- Sources: src/a.ts:1 -->', ''].join('\n')
  for (const info of ['Mermaid', 'mermaid title', 'mmd', 'mermaid{1}']) {
    // Swap one of the page's three diagrams for the mis-opened fence: it no longer counts.
    const page = goodPage('Usage').replace(FENCE + 'mermaid\nflowchart LR', FENCE + info + '\nflowchart LR')
    const result = run(fixture(t, { '01-getting-started/usage.md': page }))
    assert.deepEqual(rules(result), ['mermaid', 'threshold'], info)
    assert.match(result.errors[0].message, /is not rendered as a diagram; open it with exactly/)
    assert.match(result.errors[1].message, /2 Mermaid diagram\(s\)/)
  }
  assert.deepEqual(run(fixture(t, usage(block('mermaid')))).errors, [])
})

test('a light rect band in a sequence diagram is a light fill', (t) => {
  const seq = (band) => diagram('sequenceDiagram', '  autonumber', '  ' + band, '  A->>B: call', '  end')
  for (const band of ['rect rgb(255, 255, 255)', 'rect rgba(240,240,240,0.9)', 'rect #eeeeee', 'rect white']) {
    assert.match(messages(run(fixture(t, usage(seq(band))))), /is a light-mode color/, band)
  }
  for (const band of ['rect rgb(22, 27, 34)', 'rect rgba(255,255,255,0.05)', 'rect #161b22']) {
    assert.deepEqual(run(fixture(t, usage(seq(band)))).errors, [], band)
  }
})

test('catalogue page paths and text fields are validated like section folders', (t) => {
  const bad = (extra, section = {}) => {
    const catalogue = catalogueOf(leaf('setup'), leaf('usage', extra))
    Object.assign(catalogue.items[0], section)
    return messages(run(fixture(t, {}, { catalogue }), { catalogueOnly: true }))
  }
  assert.match(bad({ path: '01-getting-started/../../outside/p.md' }), /must stay inside the wiki/)
  assert.match(bad({ path: '01-getting-started/dist/q.md' }), /folder "dist" is reserved/)
  assert.match(bad({ path: '01-getting-started/Q Page.md' }), /file name "Q Page\.md" must be lowercase kebab-case/)
  assert.match(bad({ prompt: 'Read src/a.ts.\nThen src/b.ts.' }), /prompt must be a single line/)
  assert.match(bad({ name: 'Usage\nGuide' }), /name must be a single line/)
  assert.match(bad({}, { description: 'Line one.\nLine two.' }), /description must be a single line/)
  assert.equal(lib.pagePathProblem('01-getting-started/setup.md'), null)
  assert.equal(lib.pagePathProblem('01-a/sub-section/page-2.md'), null)
})

test('a line break in a catalogue description never reaches generated frontmatter', (t) => {
  const catalogue = catalogueOf(leaf('setup'), leaf('usage'))
  catalogue.items[0].description = 'Line one.\nLine   two.'
  const f = fixture(t, { '01-getting-started/index.md': null }, { catalogue })
  execFileSync(process.execPath, [genIndexes, f.wiki])
  const index = fs.readFileSync(path.join(f.wiki, '01-getting-started/index.md'), 'utf8')
  assert.match(index, /^description: "Line one\. Line two\."\r?$/m)
  // The catalogue itself is reported; the generated page is sound.
  const result = run(f, { pages: ['01-getting-started/index.md'] })
  assert.deepEqual(result.errors.map((e) => e.file), ['catalogue.json'])
})

test('frontmatter that YAML reads differently from this reader is an error', (t) => {
  const page = (head) => ({ '01-getting-started/usage.md': goodPage('Usage').replace(/^---\n[\s\S]*?\n---\n/, '---\n' + head + '\n---\n') })
  const problem = (head) => messages(run(fixture(t, page(head))))
  assert.match(problem('title: Usage\ndescription: This is long\n  continued here'), /description continues on the next line/)
  assert.match(problem('title: Usage\ntitle: Usage again\ndescription: Fine.'), /title appears twice/)
  assert.match(problem('title: yes\ndescription: Fine.'), /title is read by YAML as a boolean, number, date or null.*"yes"/)
  assert.match(problem('title: 2024-01-01\ndescription: Fine.'), /title is read by YAML as a boolean, number, date or null/)
  assert.match(problem('title: 42\ndescription: Fine.'), /title is read by YAML as/)
  assert.match(problem('title: Usage\ndescription: null'), /description is read by YAML as/)
  // Quoted, the same values are plain text; a quoted value may be followed by other keys.
  assert.deepEqual(run(fixture(t, page('title: "42"\ndescription: "yes"\noutline: deep'))).errors, [])
  assert.deepEqual(run(fixture(t, page('title: Version 2 notes\ndescription: Notes for 2024-01-01 and on.'))).errors, [])
})

test('one resolver finds the repository root: flag, recorded path, git, or none', (t) => {
  const f = fixture(t)
  assert.deepEqual(lib.resolveRepoRoot(f.wiki, { repo: f.repo }), { root: path.resolve(f.repo), source: 'flag' })
  const recorded = lib.resolveRepoRoot(f.wiki, { state: { wikiDir: 'wiki' } })
  assert.equal(recorded.source, 'state')
  assert.equal(lib.realPath(recorded.root), lib.realPath(f.repo))
  // A recorded path that does not match where the wiki really is cannot be trusted.
  assert.notEqual(lib.resolveRepoRoot(f.wiki, { state: { wikiDir: 'docs/wiki' } }).source, 'state')
  assert.notEqual(lib.resolveRepoRoot(f.wiki, { state: { wikiDir: '../wiki' } }).source, 'state')
  if (lib.gitTopLevel(f.repo)) return // the temp folder is inside a git repository: "none" cannot be shown here
  assert.deepEqual(lib.resolveRepoRoot(f.wiki, { state: {} }), { root: null, source: null })
  // With no root the checker falls back to the parent folder and says so.
  const guessed = checkWiki({ wikiDir: f.wiki })
  assert.deepEqual(guessed.errors, [])
  assert.match(guessed.notes.join('\n'), /no repository root is known.*citations were checked against/)
  assert.deepEqual(run(f).notes, [])
  // The recorded root is used when --repo is not given.
  fs.writeFileSync(path.join(f.wiki, '.deep-wiki.json'), JSON.stringify({ wikiDir: 'wiki' }))
  assert.deepEqual(checkWiki({ wikiDir: f.wiki }).notes, [])
})

test('a line that only looks like a link definition is prose', (t) => {
  const prose = ['[Note]: this is important for readers.', '', '[INFO]: Server started', '', '[^1]: A footnote about ./nope.md.', '', '- [x] done', '', 'See arr[0] and [bracketed] text (paren).'].join('\n')
  assert.deepEqual(run(fixture(t, usage(prose))).errors, [])
  assert.deepEqual(run(fixture(t, usage(prose)), { site: true }).errors, [])
})

test('reference definitions are checked, used or not, with any title form', (t) => {
  // Used: full, collapsed, and shortcut references; titles in double quotes, single quotes, and parentheses.
  const used = [
    'See [Setup][s], [Home][], and [usage].',
    '',
    "[s]: ./nope.md 'Setup'",
    '[home]: ./gone.md (Home)',
    '[usage]: <./missing.md> "Usage"',
    '[unused]: ./never.md',
  ].join('\n')
  const result = run(fixture(t, usage(used)))
  assert.deepEqual(rules(result), ['link', 'link', 'link', 'link'])
  assert.match(messages(result), /nope\.md/)
  assert.match(messages(result), /gone\.md/)
  assert.match(messages(result), /missing\.md/)
  assert.match(messages(result), /never\.md/)
  const ok = ['See [Setup][s] and [the same page](./setup.md \'Setup\') or [again](./setup.md (Setup)).', '', '[s]: ./setup.md "Setup"'].join('\n')
  assert.deepEqual(run(fixture(t, usage(ok))).errors, [])
})
