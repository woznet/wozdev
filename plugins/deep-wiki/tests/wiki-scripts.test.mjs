// Run with: node --test plugins/deep-wiki/tests
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/wiki-vitepress/templates/scripts')
const { checkWiki, slugify } = await import(pathToFileURL(path.join(scripts, 'check-wiki.mjs')).href)
const genIndexes = path.join(scripts, 'gen-section-indexes.mjs')

const FENCE = '```'
const SOURCES = ['a', 'b', 'c', 'd', 'e'].map((n) => `src/${n}.ts`)

function goodPage(title, extra = '') {
  return [
    '---',
    `title: ${title}`,
    'description: A page used by the tests.',
    '---',
    '',
    `# ${title}`,
    '',
    `Facts: ${SOURCES.map((s) => `(${s}:1-3)`).join(' ')}.`,
    '',
    `${FENCE}mermaid`,
    'flowchart TD',
    '  A --> B',
    FENCE,
    '<!-- Sources: src/a.ts:1 -->',
    '',
    `${FENCE}mermaid`,
    'sequenceDiagram',
    '  autonumber',
    '  A->>B: call',
    FENCE,
    '<!-- Sources: src/b.ts:1 -->',
    '',
    `${FENCE}mermaid`,
    'flowchart LR',
    '  C --> D',
    FENCE,
    '<!-- Sources: src/c.ts:1 -->',
    '',
    extra,
    '',
  ].join('\n')
}

const CATALOGUE = {
  project: 'Demo',
  summary: 'Demo project.',
  items: [
    {
      title: 'getting-started',
      name: 'Getting Started',
      dir: '01-getting-started',
      description: 'How to install and run the demo.',
      children: [
        { title: 'setup', name: 'Setup', path: '01-getting-started/setup.md', prompt: 'Read src/a.ts and src/b.ts.', children: [] },
        { title: 'usage', name: 'Usage', path: '01-getting-started/usage.md', prompt: 'Read src/c.ts and src/d.ts.', children: [] },
      ],
    },
  ],
}

/** A small repository with a valid wiki. `pages` overrides or adds wiki files; null removes one. */
function fixture(pages = {}, catalogue = CATALOGUE) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-test-'))
  process.on('exit', () => fs.rmSync(repo, { recursive: true, force: true }))
  const wiki = path.join(repo, 'wiki')
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  for (const s of SOURCES) fs.writeFileSync(path.join(repo, s), 'one\ntwo\nthree\nfour\nfive\n')
  const files = {
    'catalogue.json': JSON.stringify(catalogue),
    '01-getting-started/index.md': '---\ntitle: Getting Started\ndescription: Section.\n---\n\n# Getting Started\n',
    '01-getting-started/setup.md': goodPage('Setup', 'See [Usage](./usage.md).'),
    '01-getting-started/usage.md': goodPage('Usage'),
    ...pages,
  }
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue
    fs.mkdirSync(path.dirname(path.join(wiki, rel)), { recursive: true })
    fs.writeFileSync(path.join(wiki, rel), text)
  }
  return { repo, wiki }
}

const run = (f, opts = {}) => checkWiki({ wikiDir: f.wiki, repo: f.repo, ...opts })
const rules = (result, level = 'errors') => result[level].map((x) => x.rule)
const usage = (extra) => ({ '01-getting-started/usage.md': goodPage('Usage', extra) })

test('section indexes take their title from the catalogue', () => {
  const f = fixture({ '01-getting-started/index.md': null })
  execFileSync(process.execPath, [genIndexes, f.wiki])
  const index = fs.readFileSync(path.join(f.wiki, '01-getting-started/index.md'), 'utf8')
  assert.match(index, /^---\ntitle: "Getting Started"\ndescription: "How to install and run the demo\."\n---/)
  assert.match(index, /\| \[Setup\]\(\.\/setup\.md\) \| A page used by the tests\. \|/)
  assert.doesNotMatch(index, /undefined/)
  assert.deepEqual(run(f).errors, [])
})

test('a hand-written index without the marker is kept unless --force', () => {
  const f = fixture()
  const file = path.join(f.wiki, '01-getting-started/index.md')
  execFileSync(process.execPath, [genIndexes, f.wiki])
  assert.match(fs.readFileSync(file, 'utf8'), /title: Getting Started\n/)
  execFileSync(process.execPath, [genIndexes, f.wiki, '--force'])
  assert.match(fs.readFileSync(file, 'utf8'), /title: "Getting Started"/)
})

test('a clean wiki passes and reports real counts', () => {
  const result = run(fixture())
  assert.deepEqual(result.errors, [])
  assert.equal(result.stats.leaves, 2)
  assert.equal(result.stats.sections, 1)
  assert.equal(result.stats.diagrams, 6)
})

test('a sentence-long title ending in undefined is an error', () => {
  const title = `${'How the thing works in great detail, '.repeat(4)}with a quick reference.undefined`
  const f = fixture({ '01-getting-started/index.md': `---\ntitle: ${title}\ndescription: Section.\n---\n\n# Getting Started\n` })
  assert.deepEqual(rules(run(f)), ['frontmatter', 'title-length'])
})

test('{{ }} is an error in prose but not in code', () => {
  const ok = fixture(usage(`Use \`\${{ github.ref }}\`.\n\n${FENCE}yaml\nref: \${{ github.ref }}\n${FENCE}`))
  assert.deepEqual(run(ok).errors, [])
  assert.deepEqual(rules(run(fixture(usage('Use ${{ github.ref }} here.')))), ['interpolation'])
})

test('bare generics are an error, allowed HTML is not', () => {
  const result = run(fixture(usage('Returns List<T> and <span>fine</span>.')))
  assert.deepEqual(rules(result), ['bare-tag'])
  assert.match(result.errors[0].message, /<T>/)
})

test('broken links fail; links to unwritten catalogue pages pass in --page mode', () => {
  const bad = fixture({ '01-getting-started/setup.md': goodPage('Setup', 'See [Nope](./nope.md).') })
  assert.deepEqual(rules(run(bad)), ['link'])
  const pending = fixture({ '01-getting-started/usage.md': null })
  assert.deepEqual(run(pending, { pages: ['01-getting-started/setup.md'] }).errors, [])
  assert.deepEqual(rules(run(pending)), ['link', 'catalogue-drift'])
})

test('citations must point at real files and lines', () => {
  assert.match(run(fixture(usage('Also (src/a.ts:40-58).'))).errors[0].message, /cites line 58 but src\/a\.ts has 5 lines/)
  const missing = fixture(usage('Also (src/zzz.ts:1).'))
  assert.match(run(missing).errors[0].message, /not found in the repository/)
  assert.deepEqual(run(missing, { source: false }).errors, [])
})

test('host citation links are resolved against the repository', () => {
  const f = fixture(usage('See [a.ts:2-9](https://github.com/o/r/blob/main/src/a.ts#L2-L9).'))
  assert.match(run(f).errors[0].message, /cites line 9 but src\/a\.ts has 5 lines/)
})

test('thresholds and Mermaid rules are enforced', () => {
  const thin = `---\ntitle: Usage\ndescription: Thin.\n---\n\n# Usage\n\n(src/a.ts:1)\n\n${FENCE}mermaid\nsequenceDiagram\n  A->>B: hi<br/>there\n${FENCE}\n`
  const pages = { '01-getting-started/usage.md': thin }
  const found = rules(run(fixture(pages)))
  assert.equal(found.filter((r) => r === 'threshold').length, 3)
  assert.equal(found.filter((r) => r === 'mermaid').length, 2)
  assert.deepEqual(rules(run(fixture(pages), { site: true })), ['mermaid', 'mermaid'])
})

test('catalogue schema problems are errors', () => {
  const f = fixture({}, { project: 'Demo', summary: 's', items: [{ title: 'Bad Title', name: 'X', dir: 'guide', children: [] }] })
  const messages = run(f, { catalogueOnly: true }).errors.map((e) => e.message).join('\n')
  assert.match(messages, /kebab-case/)
  assert.match(messages, /NN-slug/)
  assert.match(messages, /no pages/)
})

test('wide tables and malformed llms.txt lines are reported', () => {
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
  const result = run(fixture({ ...usage(table), 'llms.txt': llms }))
  assert.deepEqual(rules(result), ['llms', 'llms'])
  assert.ok(rules(result, 'warnings').includes('table'))
})

test('heading slugs match VitePress', () => {
  assert.equal(slugify('7. Performance SLAs'), '_7-performance-slas')
  assert.equal(slugify('Token `refresh()` & retry'), 'token-refresh-retry')
})
