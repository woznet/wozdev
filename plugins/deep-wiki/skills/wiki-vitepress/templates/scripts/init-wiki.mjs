#!/usr/bin/env node
// Sets up or refreshes the wiki scaffold, so nobody copies or edits template files by hand.
//
// Usage: node <templates>/scripts/init-wiki.mjs <wikiDir> [options]
//   --title <text>            site title (config.mts SITE_TITLE)
//   --description <text>      one-sentence site description (SITE_DESCRIPTION)
//   --repo-url <url|''>       repository web URL, or '' for a local-only repository
//   --branch <name>           default branch
//   --host <name>             github | gitlab | azure-devops | local
//   --depth <name>            full | crisp (the thresholds the checker applies)
//   --base <path>             site base: '/' or '/<repo>/' (default: the previous value, else '/')
//   --package-name <name>     name for wiki/package.json (default: the repository folder name)
//   --write-mode <mode>       fill-missing (default) | regenerate
//   --repo <path>             repository root (default: the git top level, else the wiki's parent folder)
//   --scripts-only            copy scripts/ and write the state file; leave the site scaffold alone
//   --json                    machine-readable output
//
// What it writes:
//   scripts/**                always replaced with the plugin's copies
//   other scaffold files      written when missing; replaced only with --write-mode regenerate
//   .deep-wiki.json           { depth, host, repoUrl, branch, base, wikiDir, version }, merged with the old file
// Values not given as flags come from the previous config.mts and state file, so a regenerate keeps
// a `base` that /deep-wiki:deploy set. When config.mts is kept, flags given explicitly are patched
// into its constants in place (this is how `--base` is changed later).
//
// Run from the plugin's templates folder it copies the templates that sit next to it. Run from a
// wiki's own scripts/ folder there are no templates: it can only update config constants and state.
// It never deletes anything. Exit code 0 on success, 2 on a usage or I/O error.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitTopLevel, loadCatalogue, loadState, normalizeBase, posix, readConfigConst, readText } from './lib.mjs'

const HOSTS = ['github', 'gitlab', 'azure-devops', 'local']
const DEPTHS = ['full', 'crisp']
const WRITE_MODES = ['fill-missing', 'regenerate']
const VALUE_OPTIONS = {
  '--title': 'title',
  '--description': 'description',
  '--repo-url': 'repoUrl',
  '--branch': 'branch',
  '--host': 'host',
  '--depth': 'depth',
  '--base': 'base',
  '--package-name': 'packageName',
  '--write-mode': 'writeMode',
  '--repo': 'repo',
}
const FLAG_OPTIONS = { '--scripts-only': 'scriptsOnly', '--json': 'json' }
// config.mts constant for each flag that can be patched into an existing config.
const CONFIG_CONSTS = { title: 'SITE_TITLE', description: 'SITE_DESCRIPTION', base: 'BASE', repoUrl: 'REPO_URL', branch: 'BRANCH' }

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    let inline
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
    if (VALUE_OPTIONS[a]) {
      const value = inline ?? argv[++i]
      if (value === undefined) throw new UsageError(`${a} needs a value`)
      opts[VALUE_OPTIONS[a]] = value
    } else if (FLAG_OPTIONS[a]) {
      if (inline !== undefined) throw new UsageError(`${a} takes no value`)
      opts[FLAG_OPTIONS[a]] = true
    } else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`)
    else if (opts.wikiDir === undefined) opts.wikiDir = a
    else throw new UsageError(`Unexpected argument ${a}`)
  }
  return opts
}

const oneOf = (name, value, allowed) => {
  if (!allowed.includes(value)) throw new UsageError(`${name} must be one of ${allowed.join(', ')}; got ${value}`)
}

function inferHost(repoUrl) {
  let hostname = ''
  try {
    hostname = new URL(repoUrl).hostname.toLowerCase()
  } catch {
    return 'local'
  }
  if (hostname === 'github.com' || hostname.startsWith('github.')) return 'github'
  if (hostname.includes('gitlab')) return 'gitlab'
  if (hostname === 'dev.azure.com' || hostname.endsWith('.visualstudio.com')) return 'azure-devops'
  return 'local'
}

const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'

/** Every file under `dir`, as paths relative to it (forward slashes). */
function filesUnder(dir, rel = '') {
  const out = []
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...filesUnder(dir, child))
    } else out.push(child)
  }
  return out.sort()
}

/** Replace `const NAME = '...'` (any quoted literal) with a JSON string literal, which no value can break. */
function setConst(text, name, value) {
  const literal = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`
  const re = new RegExp(`(const ${name}${String.raw`\s*=\s*`})${literal}`)
  if (!re.test(text)) throw new UsageError(`config.mts has no "const ${name} = '...'" line to fill`)
  return text.replace(re, (_, head) => head + JSON.stringify(value))
}

export function initWiki(options) {
  if (!options.wikiDir) throw new UsageError('Usage: init-wiki.mjs <wikiDir> [options] (see the header of this script)')
  const wikiDir = path.resolve(options.wikiDir)
  const writeMode = options.writeMode ?? 'fill-missing'
  oneOf('--write-mode', writeMode, WRITE_MODES)
  if (options.host !== undefined) oneOf('--host', options.host, HOSTS)
  if (options.depth !== undefined) oneOf('--depth', options.depth, DEPTHS)

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
  const templates = options.templates ? path.resolve(options.templates) : path.resolve(scriptsDir, '..')
  const hasTemplates =
    templates !== wikiDir && fs.existsSync(path.join(templates, 'gitignore')) && fs.existsSync(path.join(templates, '.vitepress', 'config.mts'))

  // ---- previous values -------------------------------------------------------
  const prevState = fs.existsSync(wikiDir) ? loadState(wikiDir) : {}
  const prev = (name) => (fs.existsSync(wikiDir) ? readConfigConst(wikiDir, name) : '')
  let catalogue = null
  try {
    catalogue = fs.existsSync(wikiDir) ? loadCatalogue(wikiDir) : null
  } catch {
    // An unreadable catalogue is the checker's problem, not this script's.
  }
  const first = (...values) => values.find((v) => typeof v === 'string' && v !== '')

  const top = options.repo ? path.resolve(options.repo) : gitTopLevel(fs.existsSync(wikiDir) ? wikiDir : path.dirname(wikiDir))
  const repoUrl = (options.repoUrl ?? first(prevState.repoUrl, prev('REPO_URL')) ?? '').trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const values = {
    title: first(options.title, prev('SITE_TITLE'), catalogue?.project),
    description: first(options.description, prev('SITE_DESCRIPTION'), catalogue?.summary),
    repoUrl,
    branch: first(options.branch, prevState.branch, prev('BRANCH')) ?? '',
    host: first(options.host, prevState.host) ?? inferHost(repoUrl),
    depth: first(options.depth, prevState.depth) ?? 'full',
    base: normalizeBase(first(options.base, prev('BASE'), prevState.base) ?? '/'),
    wikiDir: top ? posix(path.relative(top, wikiDir)) || '.' : (first(prev('WIKI_DIR'), prevState.wikiDir) ?? path.basename(wikiDir)),
  }
  const packageName = kebab(options.packageName ?? path.basename(top ?? path.dirname(wikiDir)))

  const configPath = path.join(wikiDir, '.vitepress', 'config.mts')
  const writesConfig = hasTemplates && !options.scriptsOnly && (writeMode === 'regenerate' || !fs.existsSync(configPath))
  if (writesConfig) {
    const missing = ['title', 'description'].filter((k) => !values[k]).map((k) => `--${k}`)
    if (missing.length) throw new UsageError(`${missing.join(' and ')} required to write the site scaffold`)
  }

  // ---- files -----------------------------------------------------------------
  const files = []
  const put = (rel, content) => {
    const dest = path.join(wikiDir, rel)
    const existed = fs.existsSync(dest)
    if (existed && Buffer.compare(fs.readFileSync(dest), Buffer.from(content)) === 0) return files.push({ path: rel, action: 'kept' })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
    files.push({ path: rel, action: existed ? 'replaced' : 'wrote' })
  }
  const fillConfig = (text) => {
    let out = text
    for (const [key, name] of Object.entries(CONFIG_CONSTS)) out = setConst(out, name, values[key] ?? '')
    return setConst(out, 'WIKI_DIR', values.wikiDir)
  }

  const notes = []
  if (hasTemplates) {
    for (const rel of filesUnder(templates)) {
      const destRel = rel === 'gitignore' ? '.gitignore' : rel
      const isScript = rel.startsWith('scripts/')
      if (!isScript) {
        if (options.scriptsOnly) continue
        if (writeMode !== 'regenerate' && fs.existsSync(path.join(wikiDir, destRel))) {
          files.push({ path: destRel, action: 'kept' })
          continue
        }
      }
      const source = path.join(templates, rel)
      if (rel === '.vitepress/config.mts') put(destRel, fillConfig(fs.readFileSync(source, 'utf8')))
      else if (rel === 'package.json') put(destRel, fs.readFileSync(source, 'utf8').replace('__PACKAGE_NAME__', packageName))
      else put(destRel, fs.readFileSync(source))
    }
  } else {
    notes.push('no templates next to this script (it is running from a wiki): only config constants and the state file are updated')
  }

  // A kept config.mts still takes the values passed explicitly, e.g. a new --base from /deep-wiki:deploy.
  if (!writesConfig && !options.scriptsOnly && fs.existsSync(configPath)) {
    const before = fs.readFileSync(configPath, 'utf8')
    let after = before
    for (const [key, name] of Object.entries(CONFIG_CONSTS)) if (options[key] !== undefined) after = setConst(after, name, values[key] ?? '')
    if (after !== before) {
      fs.writeFileSync(configPath, after)
      const entry = files.find((f) => f.path === '.vitepress/config.mts')
      if (entry) entry.action = 'updated'
      else files.push({ path: '.vitepress/config.mts', action: 'updated' })
    }
  }

  // ---- state -----------------------------------------------------------------
  let version = prevState.version
  try {
    version = JSON.parse(readText(path.join(templates, '..', '..', '..', '.claude-plugin', 'plugin.json'))).version ?? version
  } catch {
    // Not running from the plugin: keep the recorded version.
  }
  const state = {
    ...prevState,
    depth: values.depth,
    host: values.host,
    repoUrl: values.repoUrl,
    branch: values.branch,
    base: values.base,
    wikiDir: values.wikiDir,
    ...(version ? { version } : {}),
  }
  put('.deep-wiki.json', `${JSON.stringify(state, null, 2)}\n`)

  return { ok: true, wikiDir: posix(wikiDir), files, state, notes }
}

function main() {
  const argv = process.argv.slice(2)
  const wantsJson = argv.includes('--json')
  try {
    const result = initWiki(parseArgs(argv))
    if (wantsJson) console.log(JSON.stringify(result, null, 2))
    else {
      for (const f of result.files) console.log(`${f.action.padEnd(8)} ${f.path}`)
      for (const n of result.notes) console.log(`note: ${n}`)
      const count = (a) => result.files.filter((f) => f.action === a).length
      console.log(`${count('wrote')} written, ${count('replaced')} replaced, ${count('updated')} updated, ${count('kept')} kept in ${result.wikiDir}`)
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
