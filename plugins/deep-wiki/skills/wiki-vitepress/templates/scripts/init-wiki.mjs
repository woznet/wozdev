#!/usr/bin/env node
// Sets up or refreshes the wiki scaffold, so nobody copies or edits template files by hand.
//
// Usage: node <templates>/scripts/init-wiki.mjs <wikiDir> [options]
//   --title <text>            site title (config.mts SITE_TITLE)
//   --description <text>      one-sentence site description (SITE_DESCRIPTION)
//   --repo-url <url|none>     repository web URL; `none` (or an empty string) for a local-only repository
//   --branch <name>           default branch
//   --host <name>             github | gitlab | azure-devops | local
//   --depth <name>            full | crisp (the thresholds the checker applies)
//   --base <name|root>        site base: a repository name such as `my-repo` (becomes /my-repo/), or
//                             `root` for '/'. Slashes are optional; leave them out in Git Bash on
//                             Windows, which rewrites "/my-repo/" into a file path.
//                             Default: the previous value, else '/'.
//   --package-name <name>     name for wiki/package.json (default: the repository folder name)
//   --write-mode <mode>       fill-missing (default) | regenerate
//   --repo <path>             repository root (default: the root an earlier run recorded, else the git top level)
//   --scripts-only            copy scripts/ and write the state file; write no other scaffold file
//   --json                    machine-readable output
//
// What it writes:
//   scripts/**                always replaced with the plugin's copies
//   other scaffold files      written when missing; replaced only with --write-mode regenerate
//   .deep-wiki.json           { depth, host, repoUrl, branch, base, wikiDir, version }, merged with the old file.
//                             wikiDir (the wiki's path below the repository root) is recorded only when
//                             --repo or git gives a real root; host follows a new --repo-url unless --host is given
// Values not given as flags come from the previous config.mts, then the state file, so a regenerate
// keeps a `base` that /deep-wiki:deploy set. `--depth` and `--host` change only when passed.
// A config.mts that is kept (fill-missing, or --scripts-only) has --base, --repo-url, and --branch
// patched into its constants when they are passed; its title and description stay as they are, and
// a constant that is no longer a plain string is reported as `kept (custom)`. The state file is then
// brought in line with config.mts, which the checker and gen-llms treat as authoritative.
//
// Run from the plugin's templates folder it copies the templates that sit next to it. Run from a
// wiki's own scripts/ folder there are no templates: it can only update config constants and state.
// It never deletes anything. Exit code 0 on success, 2 on a usage or I/O error.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { baseFromArg, configConstPattern, inferHost, loadCatalogue, loadState, posix, readConfigConst, readConfigLiteral, realPath, repoUrlFromArg, resolveRepoRoot, resolveSite } from './lib.mjs'

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
// The config.mts constant each value fills when the config is written from the template.
const CONFIG_CONSTS = { title: 'SITE_TITLE', description: 'SITE_DESCRIPTION', base: 'BASE', repoUrl: 'REPO_URL', branch: 'BRANCH' }
// The only constants patched into a config.mts that is kept: where the site lives and what it documents.
// The title and description of a kept config are the user's.
const PATCHABLE = ['base', 'repoUrl', 'branch']
// Recorded in the state file. Kept in step with the plugin version by the plugin's tests.
export const PLUGIN_VERSION = '2.2.0'

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    let inline
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
    if (VALUE_OPTIONS[a]) {
      const value = inline ?? argv[++i]
      // "--title --description x" is a forgotten value, not a title of "--description".
      if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new UsageError(`${a} needs a value`)
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

/**
 * Replace `const NAME = '...'` (a quoted literal) with a JSON string literal, which no value can
 * break. Returns null when the config has no such literal: someone made the constant an expression.
 */
function setConst(text, name, value) {
  const re = configConstPattern(name)
  return re.test(text) ? text.replace(re, (_, head) => head + JSON.stringify(value)) : null
}

export function initWiki(options) {
  if (!options.wikiDir) throw new UsageError('Usage: init-wiki.mjs <wikiDir> [options] (see the header of this script)')
  const wikiDir = path.resolve(options.wikiDir)
  const writeMode = options.writeMode ?? 'fill-missing'
  oneOf('--write-mode', writeMode, WRITE_MODES)
  if (options.host !== undefined) oneOf('--host', options.host, HOSTS)
  if (options.depth !== undefined) oneOf('--depth', options.depth, DEPTHS)
  // Everything is validated before the first write, so a bad flag never leaves a half-updated wiki.
  let baseArg
  try {
    baseArg = options.base === undefined ? undefined : baseFromArg(options.base)
  } catch (e) {
    throw new UsageError(e.message)
  }
  const repoUrlArg = options.repoUrl === undefined ? undefined : repoUrlFromArg(options.repoUrl)

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
  const templates = options.templates ? path.resolve(options.templates) : path.resolve(scriptsDir, '..')
  const hasTemplates =
    templates !== wikiDir && fs.existsSync(path.join(templates, 'gitignore')) && fs.existsSync(path.join(templates, '.vitepress', 'config.mts'))

  // ---- previous values -------------------------------------------------------
  const wikiExists = fs.existsSync(wikiDir)
  const prevState = wikiExists ? loadState(wikiDir) : {}
  // An existing config.mts is authoritative for its own constants; the state file fills the gaps.
  const prevSite = wikiExists ? resolveSite(wikiDir, prevState) : { hasSite: false, base: '/', repoUrl: '', branch: '', host: 'local' }
  const prev = (name) => (wikiExists ? readConfigConst(wikiDir, name) : '')
  let catalogue = null
  try {
    catalogue = wikiExists ? loadCatalogue(wikiDir) : null
  } catch {
    // An unreadable catalogue is the checker's problem, not this script's.
  }
  const first = (...values) => values.find((v) => typeof v === 'string' && v !== '')

  // --repo, else the root an earlier run recorded, else the git top level; null when there is none.
  const found = resolveRepoRoot(wikiDir, { repo: options.repo, state: prevState }).root
  const top = found ? realPath(found) : null
  const below = top ? path.relative(top, wikiExists ? realPath(wikiDir) : path.join(realPath(path.dirname(wikiDir)), path.basename(wikiDir))) : null
  const insideTop = below !== null && !below.startsWith('..') && !path.isAbsolute(below)
  const repoUrl = repoUrlArg ?? prevSite.repoUrl
  const values = {
    title: first(options.title, prev('SITE_TITLE'), catalogue?.project),
    description: first(options.description, prev('SITE_DESCRIPTION'), catalogue?.summary),
    repoUrl,
    branch: first(options.branch, prevSite.branch) ?? '',
    // A new --repo-url without --host changes what the host is: "none" is local, a GitHub URL is github.
    host: first(options.host, repoUrlArg === undefined ? prevState.host : undefined) ?? inferHost(repoUrl),
    depth: first(options.depth, prevState.depth) ?? 'full',
    base: baseArg ?? prevSite.base,
    // The wiki's path below the repository root. Without a root there is nothing true to record.
    wikiDir: insideTop ? posix(below) || '.' : undefined,
  }
  // WIKI_DIR in config.mts only feeds "Edit this page" links; it keeps its value or falls back to the folder name.
  const configWikiDir = values.wikiDir ?? first(prev('WIKI_DIR')) ?? path.basename(wikiDir)
  const packageName = kebab(options.packageName ?? path.basename(top ?? path.dirname(wikiDir)))

  const configPath = path.join(wikiDir, '.vitepress', 'config.mts')
  const configExists = fs.existsSync(configPath)
  const writesConfig = hasTemplates && !options.scriptsOnly && (writeMode === 'regenerate' || !configExists)
  if (writesConfig) {
    const missing = ['title', 'description'].filter((k) => !values[k]).map((k) => `--${k}`)
    if (missing.length) throw new UsageError(`${missing.join(' and ')} required to write the site scaffold`)
  }

  // ---- files -----------------------------------------------------------------
  const files = []
  const notes = []
  const put = (rel, content) => {
    const dest = path.join(wikiDir, rel)
    const existed = fs.existsSync(dest)
    if (existed && Buffer.compare(fs.readFileSync(dest), Buffer.from(content)) === 0) return files.push({ path: rel, action: 'kept' })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
    files.push({ path: rel, action: existed ? 'replaced' : 'wrote' })
  }
  /** The template config with every constant filled. The template always holds plain literals. */
  const fillConfig = (text) => {
    let out = text
    for (const [key, name] of [...Object.entries(CONFIG_CONSTS), ['wikiDir', 'WIKI_DIR']]) {
      const next = setConst(out, name, key === 'wikiDir' ? configWikiDir : (values[key] ?? ''))
      if (next === null) throw new UsageError(`the config.mts template has no "const ${name} = '...'" line to fill`)
      out = next
    }
    return out
  }

  // Build everything that can fail before writing anything.
  const planned = []
  if (hasTemplates) {
    for (const rel of filesUnder(templates)) {
      const destRel = rel === 'gitignore' ? '.gitignore' : rel
      const isScript = rel.startsWith('scripts/')
      if (!isScript) {
        if (options.scriptsOnly) continue
        if (writeMode !== 'regenerate' && fs.existsSync(path.join(wikiDir, destRel))) {
          planned.push({ path: destRel, keep: true })
          continue
        }
      }
      const source = path.join(templates, rel)
      if (rel === '.vitepress/config.mts') planned.push({ path: destRel, content: fillConfig(fs.readFileSync(source, 'utf8')) })
      else if (rel === 'package.json') planned.push({ path: destRel, content: fs.readFileSync(source, 'utf8').replace('__PACKAGE_NAME__', packageName) })
      else planned.push({ path: destRel, content: fs.readFileSync(source) })
    }
  } else {
    notes.push('no templates next to this script (it is running from a wiki): only config constants and the state file are updated')
  }

  // A kept config.mts takes only the values that say where the site lives and what it documents,
  // and only when they were passed (a new --base from /deep-wiki:deploy, say). Its title and
  // description are the user's. A constant someone turned into an expression is left alone.
  let patchedConfig = null
  const custom = []
  if (!writesConfig && configExists) {
    const before = fs.readFileSync(configPath, 'utf8')
    let after = before
    const passed = { base: baseArg, repoUrl: repoUrlArg, branch: options.branch }
    for (const key of PATCHABLE) {
      if (passed[key] === undefined) continue
      const next = setConst(after, CONFIG_CONSTS[key], values[key])
      if (next === null) custom.push(CONFIG_CONSTS[key])
      else after = next
    }
    if (after !== before) patchedConfig = after
    const ignored = ['title', 'description'].filter((k) => options[k] !== undefined && options[k] !== prev(CONFIG_CONSTS[k]))
    if (ignored.length && !options.scriptsOnly) {
      notes.push(`kept the ${ignored.join(' and ')} already in .vitepress/config.mts (edit the file to change ${ignored.length > 1 ? 'them' : 'it'}, or use --write-mode regenerate)`)
    }
  }

  for (const item of planned) {
    if (item.keep) files.push({ path: item.path, action: 'kept' })
    else put(item.path, item.content)
  }
  if (patchedConfig !== null) {
    fs.writeFileSync(configPath, patchedConfig)
    const entry = files.find((f) => f.path === '.vitepress/config.mts')
    if (entry) entry.action = 'updated'
    else files.push({ path: '.vitepress/config.mts', action: 'updated' })
  }
  for (const name of custom) {
    files.push({ path: `.vitepress/config.mts (${name})`, action: 'kept (custom)' })
    notes.push(`${name} in .vitepress/config.mts is not a plain string, so it was left as it is; change it there by hand`)
  }

  // ---- state -----------------------------------------------------------------
  // The state file mirrors the site config: whatever config.mts now says wins over what was asked.
  const now = fs.existsSync(configPath) ? resolveSite(wikiDir, {}) : null
  const literal = (name) => (now ? readConfigLiteral(wikiDir, name) : undefined)
  const state = {
    ...prevState,
    depth: values.depth,
    host: values.host,
    repoUrl: literal('REPO_URL') !== undefined ? now.repoUrl : values.repoUrl,
    branch: literal('BRANCH') ?? values.branch,
    base: literal('BASE') !== undefined ? now.base : values.base,
    version: PLUGIN_VERSION,
  }
  // Recorded only when a real root (--repo or git) says where the wiki sits; otherwise left out,
  // so no later script mistakes a guess for the repository root.
  if (values.wikiDir !== undefined) state.wikiDir = values.wikiDir
  else delete state.wikiDir
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
