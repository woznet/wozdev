// Tests for init-wiki.mjs and gen-llms.mjs. Run with: node --test "plugins/deep-wiki/tests/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/wiki-vitepress/templates/scripts')
const { checkWiki } = await import(pathToFileURL(path.join(scripts, 'check-wiki.mjs')).href)
const { initWiki } = await import(pathToFileURL(path.join(scripts, 'init-wiki.mjs')).href)
const { genLlms } = await import(pathToFileURL(path.join(scripts, 'gen-llms.mjs')).href)
const { MARKER, readConfigConst } = await import(pathToFileURL(path.join(scripts, 'lib.mjs')).href)

/** A throwaway repository folder, removed when the test ends. `files` maps repo-relative path to text. */
function repo(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-new-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel))
const page = (title, description, body = 'Body.') => `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${title}\n\n${body}\n`
const FLAGS = { title: 'Demo', description: 'A demo project.', repoUrl: 'https://github.com/o/r', branch: 'main', host: 'github', depth: 'full' }
const init = (dir, extra = {}) => initWiki({ wikiDir: path.join(dir, 'wiki'), repo: dir, ...FLAGS, ...extra })
const action = (result, rel) => result.files.find((f) => f.path === rel)?.action

const CATALOGUE = {
  project: 'Demo',
  summary: 'Demo project that does one thing well.',
  items: [
    {
      title: 'core',
      name: 'Core',
      dir: '01-core',
      description: 'The core.',
      children: [
        { title: 'alpha', name: 'Alpha', path: '01-core/alpha.md', prompt: 'Read src/a.ts and src/b.ts.', children: [] },
        { title: 'beta', name: 'Beta', path: '01-core/beta.md', prompt: 'Read src/a.ts and src/b.ts.', children: [] },
      ],
    },
  ],
}
/** A small wiki with a nested link, a link to a repo file, and an onboarding hub. */
function wikiFiles() {
  return {
    'src/a.ts': 'one\n',
    'wiki/catalogue.json': JSON.stringify(CATALOGUE),
    'wiki/index.md': page('Demo Docs', 'Landing page.', 'Start with [Alpha](./01-core/alpha.md).'),
    'wiki/01-core/index.md': page('Core', 'The core.'),
    'wiki/01-core/alpha.md': page(
      'Alpha [v2]',
      'What alpha does.',
      'See [Beta](./beta.md#usage), [the guide](../onboarding/contributor-guide.md), [source](../../src/a.ts), and `[not a link](./nope.md)`.\n\n```md\n[also not](./nope.md)\n```',
    ),
    'wiki/01-core/beta.md': page('Beta', 'What beta does.', '## Usage\n\nBack to [the section](./).'),
    'wiki/onboarding/index.md': page('Onboarding', 'Guides.'),
    'wiki/onboarding/contributor-guide.md': page('Contributor Guide', 'How to contribute.'),
  }
}
const llmsFindings = (result) => [...result.errors, ...result.warnings].filter((f) => f.rule === 'llms')

test('init writes the whole scaffold with placeholders filled', (t) => {
  const dir = repo(t)
  const result = init(dir)
  for (const rel of ['package.json', '.gitignore', '.vitepress/config.mts', '.vitepress/theme/custom.css', '.vitepress/theme/index.ts', 'public/logo.svg', 'scripts/lib.mjs', 'scripts/check-wiki.mjs', 'scripts/gen-llms.mjs']) {
    assert.equal(action(result, rel), 'wrote', rel)
  }
  const wiki = path.join(dir, 'wiki')
  assert.doesNotMatch(read(wiki, '.vitepress/config.mts'), /__[A-Z_]+__/)
  assert.doesNotMatch(read(wiki, 'package.json'), /__PACKAGE_NAME__/)
  assert.equal(readConfigConst(wiki, 'SITE_TITLE'), 'Demo')
  assert.equal(readConfigConst(wiki, 'BASE'), '/')
  assert.equal(readConfigConst(wiki, 'WIKI_DIR'), 'wiki')
  assert.deepEqual(JSON.parse(read(wiki, '.deep-wiki.json')), {
    depth: 'full',
    host: 'github',
    repoUrl: 'https://github.com/o/r',
    branch: 'main',
    base: '/',
    wikiDir: 'wiki',
    version: JSON.parse(fs.readFileSync(path.resolve(scripts, '../../../../.claude-plugin/plugin.json'), 'utf8')).version,
  })
  assert.deepEqual(checkWiki({ wikiDir: wiki, repo: dir, site: true, pending: true }).errors.filter((f) => f.rule === 'placeholder'), [])
})

test('init fills values that would break a quoted literal', (t) => {
  const dir = repo(t)
  const description = `The project's "API" uses C:\\temp\nand more`
  init(dir, { description })
  const config = read(path.join(dir, 'wiki'), '.vitepress/config.mts')
  const literal = config.match(/const SITE_DESCRIPTION = (.*)\r?\n/)[1]
  assert.equal(JSON.parse(literal), description)
  assert.equal(new Function(`return ${literal}`)(), description)
  assert.equal(readConfigConst(path.join(dir, 'wiki'), 'SITE_DESCRIPTION'), description)
})

test('--scripts-only copies the scripts and the state file, nothing else', (t) => {
  const dir = repo(t)
  const result = initWiki({ wikiDir: path.join(dir, 'wiki'), repo: dir, scriptsOnly: true, depth: 'crisp', host: 'local', repoUrl: '' })
  const wiki = path.join(dir, 'wiki')
  assert.ok(exists(wiki, 'scripts/check-wiki.mjs'))
  assert.ok(!exists(wiki, '.vitepress') && !exists(wiki, 'package.json'))
  assert.equal(result.state.depth, 'crisp')
  assert.equal(checkWiki({ wikiDir: wiki, repo: dir, catalogueOnly: false, pending: true }).mode, 'crisp')
})

test('fill-missing keeps edited files, regenerate replaces them but keeps the base', (t) => {
  const dir = repo(t)
  const wiki = path.join(dir, 'wiki')
  init(dir)
  fs.writeFileSync(path.join(wiki, '.vitepress/theme/custom.css'), '/* mine */')
  fs.writeFileSync(path.join(wiki, 'scripts/lib.mjs'), '// stale')
  // What /deep-wiki:deploy does: a new base, patched into the kept config and the state file.
  const deploy = init(dir, { base: '/r/', title: undefined, description: undefined })
  assert.equal(action(deploy, '.vitepress/config.mts'), 'updated')
  assert.equal(action(deploy, '.vitepress/theme/custom.css'), 'kept')
  assert.equal(action(deploy, 'scripts/lib.mjs'), 'replaced')
  assert.equal(read(wiki, '.vitepress/theme/custom.css'), '/* mine */')
  assert.equal(readConfigConst(wiki, 'BASE'), '/r/')
  assert.equal(readConfigConst(wiki, 'SITE_TITLE'), 'Demo')

  const regen = initWiki({ wikiDir: wiki, repo: dir, writeMode: 'regenerate', title: 'Demo 2' })
  assert.equal(action(regen, '.vitepress/theme/custom.css'), 'replaced')
  assert.notEqual(read(wiki, '.vitepress/theme/custom.css'), '/* mine */')
  assert.equal(readConfigConst(wiki, 'BASE'), '/r/')
  assert.equal(readConfigConst(wiki, 'SITE_TITLE'), 'Demo 2')
  assert.equal(readConfigConst(wiki, 'SITE_DESCRIPTION'), 'A demo project.')
  assert.equal(regen.state.base, '/r/')
  assert.equal(regen.state.branch, 'main')
})

test('init rejects bad input with exit code 2 and deletes nothing', (t) => {
  const dir = repo(t, { 'wiki/keep.md': 'mine' })
  const run = (...args) => spawnSync(process.execPath, [path.join(scripts, 'init-wiki.mjs'), ...args], { encoding: 'utf8' })
  assert.equal(run().status, 2)
  assert.equal(run(path.join(dir, 'wiki'), '--depth', 'huge').status, 2)
  assert.match(run(path.join(dir, 'wiki'), '--repo', dir).stderr, /--title and --description required/)
  const ok = run(path.join(dir, 'wiki'), '--repo', dir, '--title', 'T', '--description', 'D', '--repo-url', '', '--json')
  assert.equal(ok.status, 0)
  assert.equal(JSON.parse(ok.stdout).state.host, 'local')
  assert.equal(read(dir, 'wiki/keep.md'), 'mine')
})

test('a copy inside the wiki can still change the base', (t) => {
  const dir = repo(t)
  const wiki = path.join(dir, 'wiki')
  init(dir)
  const out = spawnSync(process.execPath, [path.join(wiki, 'scripts/init-wiki.mjs'), wiki, '--repo', dir, '--base', 'docs'], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /no templates next to this script/)
  assert.equal(readConfigConst(wiki, 'BASE'), '/docs/')
  assert.equal(JSON.parse(read(wiki, '.deep-wiki.json')).base, '/docs/')
})

test('gen-llms writes five files that pass the checker', (t) => {
  const dir = repo(t, wikiFiles())
  const wiki = path.join(dir, 'wiki')
  init(dir, { base: '/r/' })
  const result = genLlms({ wikiDir: wiki, repo: dir })
  assert.deepEqual(result.files.map((f) => `${f.action} ${f.path}`), [
    'wrote llms.txt',
    'wrote wiki/llms.txt',
    'wrote wiki/llms-full.txt',
    'wrote wiki/public/llms.txt',
    'wrote wiki/public/llms-full.txt',
  ])
  for (const rel of ['llms.txt', 'wiki/llms.txt', 'wiki/llms-full.txt', 'wiki/public/llms.txt', 'wiki/public/llms-full.txt']) {
    assert.equal(read(dir, rel).split('\n')[1], MARKER, rel)
  }
  assert.deepEqual(llmsFindings(checkWiki({ wikiDir: wiki, repo: dir, source: false })), [])

  const index = read(wiki, 'llms.txt')
  assert.match(index, /^# Demo\n.*\n\n> Demo project that does one thing well\.\n/)
  // Onboarding first, then catalogue sections in catalogue order, then other pages.
  assert.deepEqual([...index.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ['Onboarding', 'Core', 'More'])
  assert.match(index, /- \[Alpha v2\]\(\.\/01-core\/alpha\.md\): What alpha does\./)
  assert.match(read(dir, 'llms.txt'), /- \[Alpha v2\]\(\.\/wiki\/01-core\/alpha\.md\): What alpha does\./)
})

test('llms-full rebases links from a nested page and leaves code alone', (t) => {
  const dir = repo(t, wikiFiles())
  const wiki = path.join(dir, 'wiki')
  init(dir, { base: '/r/' })
  genLlms({ wikiDir: wiki, repo: dir })
  const full = read(wiki, 'llms-full.txt')
  assert.match(full, /<doc title="Alpha v2" path="01-core\/alpha\.md">\n# Alpha \[v2\]/)
  assert.doesNotMatch(full, /^---$/m)
  assert.match(full, /\[Beta\]\(\.\/01-core\/beta\.md#usage\)/)
  assert.match(full, /\[the guide\]\(\.\/onboarding\/contributor-guide\.md\)/)
  assert.match(full, /\[source\]\(\.\.\/src\/a\.ts\)/)
  assert.match(full, /`\[not a link\]\(\.\/nope\.md\)`/)
  assert.match(full, /\n\[also not\]\(\.\/nope\.md\)\n/)

  const site = read(wiki, 'public/llms-full.txt')
  assert.match(site, /\[Beta\]\(\/r\/01-core\/beta#usage\)/)
  assert.match(site, /\[the guide\]\(\/r\/onboarding\/contributor-guide\)/)
  assert.match(site, /\[the section\]\(\/r\/01-core\/\)/)
  assert.match(site, /\[source\]\(https:\/\/github\.com\/o\/r\/blob\/main\/src\/a\.ts\)/)
  assert.match(site, /`\[not a link\]\(\.\/nope\.md\)`/)
  const routes = read(wiki, 'public/llms.txt')
  assert.match(routes, /- \[Onboarding\]\(\/r\/onboarding\/\): Guides\./)
  assert.match(routes, /- \[Demo Docs\]\(\/r\/\): Landing page\./)
  assert.doesNotMatch(routes, /\.md\)/)
})

test('a link to a repo file loses its link in the deployed copy when the host is unknown', (t) => {
  const dir = repo(t, wikiFiles())
  const wiki = path.join(dir, 'wiki')
  init(dir, { repoUrl: '', host: 'local', branch: '' })
  genLlms({ wikiDir: wiki, repo: dir })
  assert.match(read(wiki, 'public/llms-full.txt'), /\), source, and `/)
  assert.deepEqual(llmsFindings(checkWiki({ wikiDir: wiki, repo: dir, source: false })), [])
})

test('--input supplies the summary, descriptions, and Optional entries', (t) => {
  const dir = repo(t, { ...wikiFiles(), 'CONTRIBUTING.md': '# Contributing\n' })
  const wiki = path.join(dir, 'wiki')
  init(dir)
  const input = path.join(dir, 'llms-input.json')
  fs.writeFileSync(
    input,
    JSON.stringify({ summary: 'A sharper summary.', context: ['Runs on Node only.'], optional: ['01-core/beta.md', 'CONTRIBUTING.md', 'nope.md'], descriptions: { '01-core/alpha.md': 'Alpha, explained.' } }),
  )
  const result = genLlms({ wikiDir: wiki, repo: dir, input })
  assert.ok(result.notes.some((n) => /nope\.md is neither/.test(n)))
  const index = read(wiki, 'llms.txt')
  assert.match(index, /\n> A sharper summary\.\n\nRuns on Node only\.\n/)
  assert.match(index, /- \[Alpha v2\]\(\.\/01-core\/alpha\.md\): Alpha, explained\./)
  assert.match(index, /## Optional\n\n- \[Beta\]\(\.\/01-core\/beta\.md\): What beta does\.\n- \[CONTRIBUTING\.md\]\(\.\.\/CONTRIBUTING\.md\)\n/)
  assert.match(read(dir, 'llms.txt'), /- \[CONTRIBUTING\.md\]\(\.\/CONTRIBUTING\.md\)/)
  assert.match(read(wiki, 'public/llms.txt'), /- \[CONTRIBUTING\.md\]\(https:\/\/github\.com\/o\/r\/blob\/main\/CONTRIBUTING\.md\)/)
  assert.match(read(wiki, 'llms-full.txt'), /## Optional\n\n<doc title="Beta" path="01-core\/beta\.md">/)
  assert.deepEqual(llmsFindings(checkWiki({ wikiDir: wiki, repo: dir, source: false })), [])

  fs.writeFileSync(input, '{"summary": 5}')
  const bad = spawnSync(process.execPath, [path.join(scripts, 'gen-llms.mjs'), wiki, '--repo', dir, '--input', input], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /"summary" must be a string/)
})

test('an unmarked root llms.txt is kept unless --force', (t) => {
  const dir = repo(t, { ...wikiFiles(), 'llms.txt': '# Mine\n' })
  const wiki = path.join(dir, 'wiki')
  const first = genLlms({ wikiDir: wiki, repo: dir })
  assert.equal(first.files[0].action, 'skipped')
  assert.equal(read(dir, 'llms.txt'), '# Mine\n')
  assert.ok(first.notes.some((n) => /--force/.test(n)))
  assert.equal(genLlms({ wikiDir: wiki, repo: dir, force: true }).files[0].action, 'replaced')
  assert.match(read(dir, 'llms.txt'), /generated by deep-wiki/)
  assert.equal(genLlms({ wikiDir: wiki, repo: dir }).files[0].action, 'replaced')
})

test('without a site only the root and wiki files are written', (t) => {
  const dir = repo(t, wikiFiles())
  const result = genLlms({ wikiDir: path.join(dir, 'wiki'), repo: dir })
  assert.deepEqual(result.files.map((f) => f.path), ['llms.txt', 'wiki/llms.txt', 'wiki/llms-full.txt'])
  assert.ok(!exists(dir, 'wiki/public'))
  assert.ok(result.notes.some((n) => /public\/ copies were not written/.test(n)))
})

test('an over-budget wiki stays under 5 KB and keeps every page in llms-full', (t) => {
  const files = wikiFiles()
  const long = 'This page explains the subsystem in considerable detail. '.repeat(4).trim()
  const children = []
  for (let i = 0; i < 60; i++) {
    const slug = `page-${String(i).padStart(2, '0')}`
    children.push({ title: slug, name: `Page ${i}`, path: `02-big/${slug}.md`, prompt: 'Read src/a.ts and src/b.ts.', children: [] })
    files[`wiki/02-big/${slug}.md`] = page(`Page number ${i} with a long title`, long)
  }
  files['wiki/02-big/index.md'] = page('Big', 'A big section.')
  // Eight children per node is the catalogue limit; this test only cares about size, not that rule.
  files['wiki/catalogue.json'] = JSON.stringify({ ...CATALOGUE, items: [...CATALOGUE.items, { title: 'big', name: 'Big', dir: '02-big', children }] })
  const dir = repo(t, files)
  const wiki = path.join(dir, 'wiki')
  init(dir, { base: '/a-long-repository-name/' })
  const result = genLlms({ wikiDir: wiki, repo: dir })
  for (const rel of ['llms.txt', 'wiki/llms.txt', 'wiki/public/llms.txt']) {
    assert.ok(Buffer.byteLength(read(dir, rel)) <= 5 * 1024, `${rel} is over budget`)
    for (const line of read(dir, rel).split('\n')) assert.ok(!line.startsWith('- ') || /^- \[[^\]]+\]\([^)\s]+\)(: \S.*)?$/.test(line), line)
  }
  assert.ok(result.notes.some((n) => /over 5 KB: .*Big/.test(n)))
  assert.match(read(wiki, 'llms.txt'), /## Big\n\n- \[Big\]\(\.\/02-big\/index\.md\)/)
  assert.equal((read(wiki, 'llms-full.txt').match(/^<doc /gm) ?? []).length, 67)
  assert.deepEqual(llmsFindings(checkWiki({ wikiDir: wiki, repo: dir, source: false })).filter((f) => f.level === 'error'), [])
})

test('the checker catches stale and hand-written llms copies', (t) => {
  const dir = repo(t, wikiFiles())
  const wiki = path.join(dir, 'wiki')
  init(dir, { base: '/r/' })
  genLlms({ wikiDir: wiki, repo: dir })
  fs.writeFileSync(path.join(wiki, '01-core/gamma.md'), page('Gamma', 'New page.'))
  fs.appendFileSync(path.join(wiki, 'public/llms.txt'), '- [Alpha](./01-core/alpha.md): Relative.\n- [Gone](/r/01-core/gone): Missing.\n- [Raw](/r/01-core/alpha.md): Not clean.\n- [Else](/other/x): Wrong base.\n')
  fs.appendFileSync(path.join(wiki, 'llms-full.txt'), '\nSee [gone](./01-core/gone.md).\n')
  const messages = llmsFindings(checkWiki({ wikiDir: wiki, repo: dir, source: false })).map((f) => `${f.file}: ${f.message}`)
  const has = (re) => assert.ok(messages.some((m) => re.test(m)), `${re} not in\n${messages.join('\n')}`)
  has(/^llms-full\.txt: 1 page\(s\) have no <doc> block \(01-core\/gamma\.md\)/)
  has(/^public\/llms-full\.txt: 1 page\(s\) have no <doc> block/)
  has(/^llms-full\.txt: links to \.\/01-core\/gone\.md, which does not exist/)
  has(/^public\/llms\.txt: \.\/01-core\/alpha\.md is a relative link/)
  has(/^public\/llms\.txt: \/r\/01-core\/gone has no page/)
  has(/^public\/llms\.txt: \/r\/01-core\/alpha\.md must be a clean route/)
  has(/^public\/llms\.txt: \/other\/x is outside the site base \/r\//)
  assert.deepEqual(llmsFindings(checkWiki({ wikiDir: wiki, repo: dir, source: false, site: true })), [])
})
