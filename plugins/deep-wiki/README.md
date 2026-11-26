# Deep Wiki

A Claude Code plugin that generates structured, Mermaid-rich, source-cited documentation for any code repository. It produces a dark-only VitePress site, audience-tailored onboarding guides, deep research reports, `AGENTS.md` files, and `llms.txt`.

This is a fork of [deep-wiki from microsoft/skills](https://github.com/microsoft/skills/tree/main/.github/plugins/deep-wiki) (MIT). See [Changes in This Fork](#changes-in-this-fork).

## Installation

The plugin ships in the [woznet/wozdev](https://github.com/woznet/wozdev) marketplace. In Claude Code, add the marketplace, then install the plugin:

```text
/plugin marketplace add woznet/wozdev
/plugin install deep-wiki@wozdev
```

To try it from a clone without installing it:

```bash
git clone https://github.com/woznet/wozdev.git
claude --plugin-dir wozdev/plugins/deep-wiki
```

To check the plugin structure and run its script tests from the repository root:

```bash
claude plugin validate plugins/deep-wiki
node --test "plugins/deep-wiki/tests/*.test.mjs"
```

Claude Code caches the plugin by the `version` in `plugins/deep-wiki/.claude-plugin/plugin.json`, so every release raises it. Each skill's `metadata.version` is the plugin version it last shipped in. To pick up a release, run `claude plugin marketplace update wozdev`, then `claude plugin update deep-wiki@wozdev`, and restart Claude Code.

## Quick Start

### 1. Prerequisites

- Claude Code with the plugin [installed](#installation), started from the root of the repository you want to document.
- Node.js 22.12 or later. Generation itself needs it, not only the site build: the bundled scripts run during every pipeline.
- A git remote is optional. With one, citations become links for GitHub, GitLab, and Azure DevOps remotes. Other hosts and repositories without a remote get plain `(path:line)` citations.

### 2. Generate a Wiki

Pick one of the two pipelines:

```text
/deep-wiki:crisp
/deep-wiki:generate
```

| | `/deep-wiki:crisp` | `/deep-wiki:generate` |
|---|---|---|
| Pages | 5–7 dense pages in fixed sections, no catalogue | A catalogue first, then one page per catalogue leaf, written by parallel subagents |
| Onboarding | Contributor guide | Contributor, staff engineer, executive, and product manager guides |
| Site | Scaffold only, no `npm install` or build | Scaffold, `npm install`, and build (skip with `--no-build`) |
| Also writes | `AGENTS.md`/`CLAUDE.md` (root and `wiki/`), llms files | The same |

Neither pipeline creates a deploy workflow. Add a focus area to narrow either one (`/deep-wiki:generate src/api`).

Running `generate` on an existing wiki asks whether to regenerate, fill in what is missing, or stop; see [Write Modes](#write-modes). `/deep-wiki:catalogue` followed by `/deep-wiki:generate` with "fill missing" keeps the catalogue you reviewed.

### 3. Preview the Site

```bash
npm --prefix wiki install
npm --prefix wiki run dev
```

After `generate`, the dependencies are already installed.

### 4. Publish

Run `/deep-wiki:deploy` to add `.github/workflows/deploy-wiki.yml` and set the site's base path, then set **Settings → Pages → Source** to **GitHub Actions** once.

Commit `wiki/` (including `scripts/`, `catalogue.json`, `.deep-wiki.json`, and `.deep-wiki-llms.json`; the deployed build needs them) and any generated root files (`llms.txt`, `AGENTS.md`, `CLAUDE.md`) before you push.

### 5. Beyond the Wiki

| I want to… | Run |
|------------|-----|
| Ask a question about the code | `/deep-wiki:ask How is authentication handled?` |
| Investigate a topic in depth | `/deep-wiki:research request lifecycle --write` |
| Write or redo one page | `/deep-wiki:page caching src/cache/` |
| Get onboarding for one audience | `/deep-wiki:onboard staff` |
| Produce release notes | `/deep-wiki:changelog --since 2026-10-01 --write` |
| Give coding agents instructions | `/deep-wiki:agents-md` and `/deep-wiki:llms` |

Plain requests work too: "what changed this month?" triggers the changelog skill.

## Commands

| Command | Description |
|---------|-------------|
| `/deep-wiki:generate [focus] [--no-build]` | Full pipeline: catalogue → pages (parallel writer subagents) → onboarding → VitePress site → `AGENTS.md` → llms files → check and build |
| `/deep-wiki:crisp [focus]` | Fast wiki: 5–7 dense pages, a contributor guide, site scaffold, agent files, llms files; no npm build |
| `/deep-wiki:catalogue [focus]` | Writes only `wiki/catalogue.json` |
| `/deep-wiki:page <topic> [files] [--crisp]` | One page with diagrams and citations; registers it in the catalogue when there is one |
| `/deep-wiki:onboard [contributor\|staff\|executive\|pm ...]` | Onboarding guides in `wiki/onboarding/` |
| `/deep-wiki:research <topic> [--write]` | Five-iteration, evidence-first investigation; `--write` saves it to `wiki/research/` |
| `/deep-wiki:ask <question>` | Q&A grounded in source files |
| `/deep-wiki:changelog [range \| --since date] [--write]` | Categorized changelog from git history; `--write` saves `wiki/changelog.md` |
| `/deep-wiki:build [--no-build]` | Scaffold the VitePress site, generate the index pages, run the site checks, then build |
| `/deep-wiki:deploy` | GitHub Pages workflow (`.github/workflows/deploy-wiki.yml`) and base path |
| `/deep-wiki:agents-md [folder ...]` | `AGENTS.md` + `CLAUDE.md` for the root, `wiki/`, and package roots, where missing |
| `/deep-wiki:llms` | `llms.txt` (root, `wiki/`, `wiki/public/`) and `llms-full.txt` (`wiki/`, `wiki/public/`) |

Naming a target (`page <topic>`, `onboard <guide>`, `catalogue`) is a request to replace it. `generate` and `crisp` hold their own orchestration; the other commands load the matching skill, which holds the procedure.

## Skills

| Skill | Role |
|-------|------|
| `wiki-conventions` | **Single source of truth**: repo resolution, citation formats per host, the dark palette, VitePress-safe Markdown, the `wiki/` layout, thresholds, ownership and write modes, the scripts and checker findings, and subagent dispatch. Every other skill and agent loads it. |
| `wiki-architect` | Catalogue (`wiki/catalogue.json`) and its schema |
| `wiki-page-writer` | One documentation page |
| `wiki-onboarding` | Contributor, staff engineer, executive, and product manager guides |
| `wiki-researcher` | Multi-iteration deep research |
| `wiki-qa` | Grounded Q&A, scaled to the question |
| `wiki-changelog` | Git-history changelog |
| `wiki-vitepress` | Site scaffold from `templates/` (config, theme, CSS, logo) and the five bundled scripts |
| `wiki-deploy` | GitHub Pages workflow and base path |
| `wiki-agents-md` | `AGENTS.md` / `CLAUDE.md` generation |
| `wiki-llms-txt` | Input for the llms generator and its quality rules |

Skills also trigger on their own when a request matches their description.

## Agents

| Agent | Preloaded skills | Used by |
|-------|------------------|---------|
| `deep-wiki:wiki-architect` | conventions, architect | `generate` step 1 |
| `deep-wiki:wiki-writer` | conventions, page-writer (loads onboarding for a guide) | `generate` pages, onboarding guides, repairs; optionally `crisp` and `onboard` |
| `deep-wiki:wiki-researcher` | conventions, researcher | Delegated research. Read-only (`Read`, `Grep`, `Glob`): it returns its report and the dispatcher saves it |

Agents never ask the user questions. The dispatcher passes `REPO_URL`, `HOST`, `BRANCH`, and what each agent needs: depth, write mode, output paths, and the sibling page list for writers; the focus for the architect.

## Output Layout

```text
wiki/
├── .deep-wiki.json        # Run state: depth, host, repoUrl, branch, base, wikiDir, version
├── .deep-wiki-llms.json   # Input for gen-llms.mjs (summary, descriptions); kept and committed
├── catalogue.json         # Table of contents (generate only)
├── index.md               # Developer landing page
├── onboarding/            # Guides, plus a generated index.md hub
├── NN-section/*.md        # Pages, plus a generated index.md per section
├── changelog.md           # Optional (--write)
├── research/*.md          # Optional (--write)
├── llms.txt, llms-full.txt
├── public/                # logo.svg, llms copies (served at the site root)
├── AGENTS.md, CLAUDE.md
├── package.json
├── scripts/               # init-wiki, check-wiki, gen-section-indexes, gen-llms, lib (.mjs)
└── .vitepress/            # config.mts, theme/
llms.txt                   # Root discovery copy (links into wiki/)
```

Section and onboarding `index.md` files and all llms files are script output. Do not edit them by hand; edit the catalogue, the pages' frontmatter, or `.deep-wiki-llms.json` and rerun the script.

## Write Modes

A first run writes everything that is missing and asks nothing; existing `AGENTS.md`, `CLAUDE.md`, and root `llms.txt` files are kept. On an existing wiki, `generate` asks for one of two write modes:

| | `fill-missing` | `regenerate` |
|---|---|---|
| Catalogue, pages, guides, landing page | Written only if missing | Replaced |
| Site scaffold (`package.json`, `.vitepress/`) | Written only if missing | Replaced; the base path is kept |
| Generated indexes, wiki llms files, `scripts/` | Refreshed | Refreshed |
| Root `llms.txt` | Replaced only if it carries the marker | Same |
| `AGENTS.md` / `CLAUDE.md` | Written only if missing | Replaced if marked; unmarked ones are asked about |
| Sections and pages no longer in the catalogue | Left | Deleted, after the paths are listed and you confirm |

Generated files outside page content carry `<!-- generated by deep-wiki -->`. Nothing is deleted without a list and a yes, a run narrowed by a focus never deletes, and `fill-missing` reports problems in existing pages instead of rewriting them.

## Scripts

`wiki/scripts/` holds five zero-dependency Node scripts. They need no `npm install`. Run them from the repository root:

```bash
node wiki/scripts/check-wiki.mjs wiki                 # check everything; exit 1 on errors, 2 on a bad command
node wiki/scripts/check-wiki.mjs wiki --page 02-architecture/overview.md
node wiki/scripts/check-wiki.mjs wiki --report        # Section | Pages | Diagrams | Cited files
node wiki/scripts/gen-section-indexes.mjs wiki        # section index.md files and the onboarding hub
node wiki/scripts/gen-llms.mjs wiki --input wiki/.deep-wiki-llms.json
node wiki/scripts/init-wiki.mjs wiki --base /my-repo/ # change a recorded value such as the base path
```

`init-wiki.mjs` also creates the scaffold: the pipelines run it from the plugin's `templates/scripts/` folder, where it copies the templates and fills their placeholders. `lib.mjs` is shared code. The same checks are available as `npm --prefix wiki run check`, `run indexes`, and `run llms`; `npm --prefix wiki run build` runs the site-affecting checks (`--site`) and then `vitepress build`.

The checker reads the depth (full or crisp), repository URL, and branch from `wiki/.deep-wiki.json`. It verifies citations against the repository that contains `wiki/`; pass `--repo <path>` if the source is elsewhere, or `--no-source` when it is not on disk.

- **Errors**: missing, YAML-unsafe, or over-long frontmatter titles; `{{ }}` and tag-shaped text outside code; Mermaid rule breaks (`<br/>`, no `autonumber`, light fills); broken relative links and links that leave the wiki; cited files or line ranges that do not exist; pages under the diagram and citation minimums; catalogue schema problems and pages never written; unfilled placeholders; malformed or incomplete llms files.
- **Warnings**: wide tables, dead `#anchor` links, diagrams without a `Sources` comment, pages missing from the catalogue, an `llms.txt` over 5 KB, and files that appeared or changed in the repository during a run.

It does not parse Mermaid syntax; preview the site to verify diagrams.

## Design Principles

1. **Evidence first**: every claim cites `file:line`, linked for GitHub, GitLab, and Azure DevOps remotes and plain otherwise.
2. **Structure first**: `generate` writes the catalogue before any page.
3. **Diagram-rich**: full-depth pages carry at least 3 Mermaid diagrams of at least 2 types, each followed by a `<!-- Sources -->` comment.
4. **Tables over prose** for anything structured, with a `Source` column.
5. **Never invent**: facts the repo can't support are marked as unknown, not filled in.
6. **Dark-only**: one palette shared by the theme, CSS, and inline styles.
7. **Non-destructive**: the user's own `AGENTS.md`, `CLAUDE.md`, and `llms.txt` are never replaced without asking, and nothing is deleted without confirmation.
8. **Scripted and checked, not self-reported**: the scaffold, index pages, and llms files are written by scripts; counts, links, citations, and thresholds are what the checker reports; the site build fails on broken links.
9. **Read-only source**: generation never runs the project's tests, builds, or scripts.

## Changes in This Fork

Compared with upstream 2.0.0:

- **Deduplicated rules.** Repo resolution, citations, palette, and layout live only in `wiki-conventions`; agents preload skills. Upstream copies had drifted: two palettes, `wiki-site/` vs `wiki/`, and a missing `docs:build` script.
- **Repo resolution** auto-detects the remote (SSH remotes converted to https), uses the default branch, and has host-specific citation formats. It asks only when there is no remote, and subagents never ask.
- **VitePress**: templates ship as real files. Fixes: `appearance: 'force-dark'`; static assets in `wiki/public/`; a zoom modal that doesn't leak document listeners; a dynamic sidebar.
- **Dependencies**: Mermaid 12 (with an npm `overrides` entry so `vitepress-plugin-mermaid` installs cleanly), diagrams pinned to the classic dagre layout and look, and Node 22.12+ required.
- **Deploy**: default branch trigger, Node 24, current action majors, a fixed owner/repo parse, and a no-lockfile variant.
- **Pipelines**: `generate` writes `wiki/catalogue.json` and dispatches parallel writer subagents; onboarding writes to `wiki/onboarding/` and marks facts the repo can't provide (owners, SLAs, metrics) as unknown.
- **llms.txt** uses a generated-file marker and writes `wiki/public/` copies. **Changelog** takes ranges or `--since` and can write `wiki/changelog.md`.
- The generated `CLAUDE.md` uses an `@AGENTS.md` import so Claude Code loads the instructions.

Added in 2.2.0, from reviews of a generated wiki and of the plugin itself:

- **Bundled scripts**: `check-wiki.mjs` replaces the prose checklists; `init-wiki.mjs` writes the scaffold and fills placeholders safely; `gen-section-indexes.mjs` writes section indexes and the onboarding hub (hand-written ones had produced sentence-long sidebar titles ending in `undefined`); `gen-llms.mjs` writes all five llms files within the 5 KB budget. Run state lives in `wiki/.deep-wiki.json`.
- **Sidebar**: labels and order come from `catalogue.json`; the index is the group heading's link; `research/`, `changelog.md`, and other root pages are listed.
- **Layout**: tables scroll inside the text column instead of spilling into the outline, long paths wrap inside cells, the text column is wider, and focus mode and diagram zoom were reworked.
- **Build safety**: a broken link between pages fails the build, and inline code is `v-pre` so `${{ github.ref }}` and similar text cannot break it.
- **Write modes** have defined semantics: what is replaced, what is asked about, and what is deleted only after confirmation.
- **Subagents** treat the source repo as read-only, take line numbers only from files they opened, check their own page, and write onboarding guides with the onboarding skill loaded.
- **Crisp** no longer creates a deploy workflow.
- **Renamed**: `/deep-wiki:agents` is now `/deep-wiki:agents-md`.
- **Removed**: the Azure DevOps wiki export (`/deep-wiki:ado`, `wiki-ado-convert`). Azure DevOps remotes are still supported for citation links.

## License

MIT. [LICENSE](LICENSE) keeps the upstream notice from [microsoft/skills](https://github.com/microsoft/skills/blob/main/LICENSE) and adds the copyright for this fork's changes.
