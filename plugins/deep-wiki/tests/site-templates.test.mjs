// Tests for the hub-page generator. Run with: node --test "plugins/deep-wiki/tests/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/wiki-vitepress/templates/scripts')
const generator = path.join(scripts, 'gen-section-indexes.mjs')
const { checkWiki } = await import(pathToFileURL(path.join(scripts, 'check-wiki.mjs')).href)
const { MARKER } = await import(pathToFileURL(path.join(scripts, 'lib.mjs')).href)

const page = (title, description) => `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n# Page\n\nBody.\n`
const leaf = (slug, dir) => ({ title: slug, name: slug, path: `${dir}/${slug}.md`, prompt: 'Read src/a.ts and src/b.ts.', children: [] })

/** A wiki folder in the OS temp dir, removed when the test ends. `files` maps relative path to text. */
function wiki(t, files, catalogue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-site-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const all = catalogue ? { 'catalogue.json': JSON.stringify(catalogue), ...files } : files
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

function generate(dir, ...flags) {
  const result = spawnSync(process.execPath, [generator, dir, ...flags], { encoding: 'utf8' })
  return { code: result.status, out: result.stdout + result.stderr }
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel))

const SECTION = {
  title: 'core',
  name: 'Core',
  dir: '01-core',
  description: 'The core services.',
  children: [leaf('cache', '01-core'), leaf('auth', '01-core')],
}

test('frontmatter text is made safe for page prose', (t) => {
  const dir = wiki(
    t,
    {
      '01-core/cache.md': page('Repository<T> | Cache', 'How Repository<T> caches {{ entity }} rows | and `Map<K, V>` stays.'),
      '01-core/auth.md': page('Auth [v2]', 'Plain text.'),
    },
    { project: 'Demo', summary: 's', items: [{ ...SECTION, name: 'Core <Api>', description: 'Uses ${{ github.ref }} and Task<string>.' }] },
  )
  assert.equal(generate(dir).code, 0)
  const index = read(dir, '01-core/index.md')

  // Frontmatter keeps the raw text; the body does not.
  assert.match(index, /^---\ntitle: "Core <Api>"\n/)
  assert.match(index, /\n# Core &lt;Api>\n/)
  assert.ok(index.includes('Uses $`{{ github.ref }}` and Task&lt;string>.'))
  assert.ok(index.includes('| [Repository&lt;T> \\| Cache](./cache.md) | How Repository&lt;T> caches `{{ entity }}` rows \\| and `Map<K, V>` stays. |'))
  assert.ok(index.includes('| [Auth \\[v2\\]](./auth.md) | Plain text. |'))

  // The checker agrees: nothing in the generated body reads as a tag or an interpolation.
  // (It reports the raw frontmatter separately, on line 1; that text came from the catalogue.)
  const findings = checkWiki({ wikiDir: dir, repo: dir, source: false, site: true })
  const bad = [...findings.errors, ...findings.warnings].filter((f) => f.file === '01-core/index.md' && f.line > 4 && ['bare-tag', 'interpolation'].includes(f.rule))
  assert.deepEqual(bad, [])
})

test('rows follow catalogue order and the marker sits under the H1', (t) => {
  const dir = wiki(t, { '01-core/cache.md': page('Cache', 'C.'), '01-core/auth.md': page('Auth', 'A.') }, { project: 'Demo', summary: 's', items: [SECTION] })
  generate(dir)
  const index = read(dir, '01-core/index.md')
  assert.ok(index.includes(`# Core\n${MARKER}\n\nThe core services.\n`))
  assert.ok(index.indexOf('[Cache]') < index.indexOf('[Auth]'))
})

test('nested sections get their own index and a link from the parent', (t) => {
  const nested = { title: 'storage', name: 'Storage', dir: 'storage', description: 'Persistence.', children: [leaf('disk', '01-core/storage')] }
  const dir = wiki(
    t,
    { '01-core/cache.md': page('Cache', 'C.'), '01-core/storage/disk.md': page('Disk', 'D.') },
    { project: 'Demo', summary: 's', items: [{ ...SECTION, children: [leaf('cache', '01-core'), nested] }] },
  )
  assert.equal(generate(dir).code, 0)
  assert.ok(read(dir, '01-core/index.md').includes('| [Storage](./storage/index.md) | Persistence. |'))
  const sub = read(dir, '01-core/storage/index.md')
  assert.match(sub, /^---\ntitle: "Storage"\n/)
  assert.ok(sub.includes('| [Disk](./disk.md) | D. |'))
})

test('the onboarding hub lists only the guides that exist, in reading order', (t) => {
  const dir = wiki(
    t,
    {
      'onboarding/executive-guide.md': page('Executive Guide', 'For leaders.'),
      'onboarding/contributor-guide.md': page('Contributor Guide', 'Uses List<T>.'),
      'onboarding/zz-extra.md': page('Extra', 'Other.'),
      '01-core/cache.md': page('Cache', 'C.'),
      '01-core/auth.md': page('Auth', 'A.'),
    },
    { project: 'Demo', summary: 's', items: [SECTION] },
  )
  assert.equal(generate(dir).code, 0)
  const hub = read(dir, 'onboarding/index.md')
  assert.match(hub, /^---\ntitle: "Onboarding"\n/)
  assert.ok(hub.includes(MARKER))
  assert.ok(hub.includes('| Guide | Audience | What it covers |'))
  assert.ok(hub.includes('| [Contributor Guide](./contributor-guide.md) | New contributors | Uses List&lt;T>. |'))
  assert.ok(hub.indexOf('contributor-guide.md') < hub.indexOf('executive-guide.md'))
  assert.ok(hub.indexOf('executive-guide.md') < hub.indexOf('zz-extra.md'))
  assert.ok(!hub.includes('staff-engineer-guide'))
})

test('a wiki without a catalogue gets the onboarding hub only', (t) => {
  const dir = wiki(t, { 'onboarding/contributor-guide.md': page('Contributor Guide', 'Start here.'), '01-architecture/overview.md': page('Overview', 'O.') })
  const run = generate(dir)
  assert.equal(run.code, 0)
  assert.match(run.out, /no catalogue\.json/)
  assert.ok(exists(dir, 'onboarding/index.md'))
  assert.ok(!exists(dir, '01-architecture/index.md'))
})

test('a wiki without onboarding guides says the hub was not written', (t) => {
  const dir = wiki(t, { '01-architecture/overview.md': page('Overview', 'O.') })
  const run = generate(dir)
  assert.equal(run.code, 0)
  assert.match(run.out, /no onboarding guides; hub not written/)
  assert.ok(!exists(dir, 'onboarding/index.md'))
})

test('hand-written hubs are kept unless --force', (t) => {
  const mine = '---\ntitle: Mine\ndescription: Mine.\n---\n\n# Mine\n'
  const dir = wiki(
    t,
    { '01-core/index.md': mine, 'onboarding/index.md': mine, 'onboarding/contributor-guide.md': page('Contributor Guide', 'G.'), '01-core/cache.md': page('Cache', 'C.'), '01-core/auth.md': page('Auth', 'A.') },
    { project: 'Demo', summary: 's', items: [SECTION] },
  )
  assert.match(generate(dir).out, /skipped  01-core\/index\.md/)
  assert.equal(read(dir, '01-core/index.md'), mine)
  assert.equal(read(dir, 'onboarding/index.md'), mine)
  generate(dir, '--force')
  assert.match(read(dir, '01-core/index.md'), /title: "Core"/)
  assert.match(read(dir, 'onboarding/index.md'), /title: "Onboarding"/)
})

test('--prune removes generated indexes of folders that left the catalogue, and nothing else', (t) => {
  const generated = `---\ntitle: "Old"\ndescription: "Old."\n---\n\n# Old\n${MARKER}\n`
  const dir = wiki(
    t,
    {
      '01-core/cache.md': page('Cache', 'C.'),
      '01-core/auth.md': page('Auth', 'A.'),
      '01-core/old-sub/index.md': generated,
      '02-gone/index.md': generated,
      '02-gone/page.md': page('Page', 'P.'),
      '03-kept/index.md': '---\ntitle: Mine\ndescription: Mine.\n---\n\n# Mine\n',
    },
    { project: 'Demo', summary: 's', items: [SECTION] },
  )
  generate(dir)
  assert.ok(exists(dir, '02-gone/index.md'), 'without --prune nothing is removed')

  const run = generate(dir, '--prune')
  assert.equal(run.code, 0)
  assert.match(run.out, /removed  02-gone\/index\.md/)
  assert.ok(!exists(dir, '02-gone/index.md'))
  assert.ok(exists(dir, '02-gone/page.md'), 'pages are never pruned')
  assert.ok(!exists(dir, '01-core/old-sub'), 'an emptied folder is removed')
  assert.ok(exists(dir, '03-kept/index.md'), 'an unmarked index is not ours to delete')
  assert.ok(exists(dir, '01-core/index.md'))
})

test('bad input exits 2 without writing', (t) => {
  const dir = wiki(t, { 'catalogue.json': '{ not json' })
  assert.equal(generate(dir).code, 2)
  assert.equal(generate(path.join(dir, 'missing')).code, 2)
  assert.equal(generate(dir, '--frce').code, 2)
})
