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

To check the plugin structure from the repository root:

```bash
claude plugin validate plugins/deep-wiki
```

Claude Code caches the plugin by the `version` in `plugins/deep-wiki/.claude-plugin/plugin.json`, so every release raises it. To pick up a release, run `claude plugin marketplace update wozdev`, then `claude plugin update deep-wiki@wozdev`, and restart Claude Code.

## Quick Start

### 1. Prerequisites

- Claude Code with the plugin [installed](#installation), started from the root of the repository you want to document.
- A git remote is optional. With one, citations become links for GitHub, GitLab, and Azure DevOps. Without one, the plugin asks for the repository context once.
- Node.js 22.12 or later, only for building or previewing the site.

### 2. Generate a Wiki

Pick one of the two pipelines:

```text
/deep-wiki:crisp
/deep-wiki:generate
```

- `/deep-wiki:crisp` is the fast path: 5–8 dense pages, a contributor guide, and a site scaffold, with no npm build. Use it for a first run or a small project.
- `/deep-wiki:generate` is the full pipeline: catalogue, pages written by parallel subagents, four onboarding guides, the VitePress site, `AGENTS.md`, `llms.txt`, and a build. Add a focus area to narrow it (`/deep-wiki:generate src/api`) or `--no-build` to skip npm.

Running `generate` again on an existing `wiki/` asks whether to regenerate everything or only fill in the missing pages.

### 3. Preview the Site

```bash
cd wiki && npm install && npm run dev
```

After `generate`, the dependencies are already installed, so `npm run dev` is enough.

### 4. Publish

- **GitHub Pages**: run `/deep-wiki:deploy` to add `.github/workflows/deploy-wiki.yml`, then set **Settings → Pages → Source** to **GitHub Actions** once.
- **Azure DevOps Wiki**: run `/deep-wiki:ado` to export a compatible copy to `wiki/dist/ado-wiki/`.

Commit `wiki/` and any generated root files (`llms.txt`, `AGENTS.md`, `CLAUDE.md`) before you push.

### 5. Beyond the Wiki

| I want to… | Run |
|------------|-----|
| Ask a question about the code | `/deep-wiki:ask How is authentication handled?` |
| Investigate a topic in depth | `/deep-wiki:research request lifecycle --write` |
| Write or redo one page | `/deep-wiki:page caching src/cache/` |
| Get onboarding for one audience | `/deep-wiki:onboard staff` |
| Produce release notes | `/deep-wiki:changelog --since 2026-10-01 --write` |
| Give coding agents instructions | `/deep-wiki:agents` and `/deep-wiki:llms` |

Plain requests work too: "what changed this month?" triggers the changelog skill. [Commands](#commands) lists every command and its arguments.

## Commands

| Command | Description |
|---------|-------------|
| `/deep-wiki:generate [focus] [--no-build]` | Full pipeline: catalogue → pages (parallel writer subagents) → onboarding → VitePress site → AGENTS.md → llms.txt |
| `/deep-wiki:crisp [focus]` | Fast wiki: 5–8 dense pages, one onboarding guide, site scaffold, no npm build |
| `/deep-wiki:catalogue [focus]` | Writes only `wiki/catalogue.json` |
| `/deep-wiki:page <topic> [files] [--crisp]` | One page with diagrams and citations |
| `/deep-wiki:onboard [contributor\|staff\|executive\|pm]` | Onboarding guides in `wiki/onboarding/` |
| `/deep-wiki:research <topic> [--write]` | Five-iteration, evidence-first investigation |
| `/deep-wiki:ask <question>` | Q&A grounded in source files |
| `/deep-wiki:changelog [range \| --since date] [--write]` | Categorized changelog from git history |
| `/deep-wiki:build [--no-build]` | Scaffold the VitePress site from the shipped templates, then build |
| `/deep-wiki:deploy` | GitHub Pages workflow (`.github/workflows/deploy-wiki.yml`) |
| `/deep-wiki:ado [wiki-dir]` | Azure DevOps Wiki export to `wiki/dist/ado-wiki/` |
| `/deep-wiki:agents [folders]` | `AGENTS.md` + `CLAUDE.md` where missing |
| `/deep-wiki:llms` | `llms.txt` and `llms-full.txt` (root, `wiki/`, `wiki/public/`) |

Commands are thin wrappers: each loads the matching skill, which holds the procedure.

## Skills

| Skill | Role |
|-------|------|
| `wiki-conventions` | **Single source of truth**: repo resolution, citation formats per host, the dark palette, VitePress-safe Markdown, the `wiki/` layout, thresholds, the checker, and the overwrite and regenerate rules. Every other skill and agent loads it. |
| `wiki-architect` | Catalogue (`wiki/catalogue.json`) |
| `wiki-page-writer` | One documentation page |
| `wiki-onboarding` | Contributor, Staff Engineer, Executive, and PM guides |
| `wiki-researcher` | Multi-iteration deep research |
| `wiki-qa` | Grounded Q&A |
| `wiki-changelog` | Git-history changelog |
| `wiki-vitepress` | Site scaffold from `templates/` (config, theme, CSS, logo) and the bundled scripts: `check-wiki.mjs` (checker) and `gen-section-indexes.mjs` |
| `wiki-deploy` | GitHub Pages workflow and base path |
| `wiki-ado-convert` | Ships `scripts/build-ado-wiki.mjs` (zero dependencies, tested) |
| `wiki-agents-md` | `AGENTS.md` / `CLAUDE.md` generation |
| `wiki-llms-txt` | `llms.txt` / `llms-full.txt` |

Skills also trigger on their own when a request matches their description (for example, "what changed this month?" triggers `wiki-changelog`).

## Agents

| Agent | Preloaded skills | Used by |
|-------|------------------|---------|
| `deep-wiki:wiki-architect` | conventions, architect | `generate` step 1 |
| `deep-wiki:wiki-writer` | conventions, page-writer | `generate` pages and onboarding, optionally `crisp` and `onboard` |
| `deep-wiki:wiki-researcher` | conventions, researcher | Delegated research |

Agents never ask the user questions. The dispatcher passes `REPO_URL`, `HOST`, `BRANCH`, the mode, and the output paths.

## Output Layout

```text
wiki/
├── catalogue.json         # Table of contents
├── index.md               # Developer landing page
├── onboarding/            # Guides + hub
├── NN-section/*.md        # Pages, plus a generated index.md per section
├── changelog.md           # Optional (--write)
├── research/*.md          # Optional (--write)
├── llms.txt, llms-full.txt
├── public/                # logo.svg, llms copies (served at the site root)
├── AGENTS.md, CLAUDE.md   # Only if missing
├── package.json
├── scripts/               # check-wiki.mjs, gen-section-indexes.mjs, lib.mjs; build-ado-wiki.mjs after /deep-wiki:ado
└── .vitepress/            # config.mts, theme/
llms.txt                   # Root discovery copy (links into wiki/)
```

## Design Principles

1. **Evidence first**: every claim cites `file:line`, linked for GitHub, GitLab, and Azure DevOps remotes and plain for local repos.
2. **Structure first**: the catalogue comes before any page.
3. **Diagram-rich**: full-mode pages carry at least 3 Mermaid diagrams of at least 2 types, each followed by a `<!-- Sources -->` comment.
4. **Tables over prose** for anything structured, with a `Source` column.
5. **Never invent**: facts the repo can't support are marked as unknown, not filled in.
6. **Dark-only**: one palette shared by the theme, CSS, and inline styles.
7. **Non-destructive**: never overwrite hand-written `AGENTS.md`, `CLAUDE.md`, or `llms.txt` without asking; the marker `<!-- generated by deep-wiki -->` identifies generated files. A `regenerate` run replaces what deep-wiki owns, removes sections that left the catalogue, and asks once about the rest.
8. **Checked, not self-reported**: a zero-dependency checker validates titles, links, citations, thresholds, Mermaid rules, and the catalogue, and the site build fails on broken links.
9. **Read-only source**: generation never runs the project's tests, builds, or scripts.

## Checking a Wiki

The scaffold copies two Node scripts into `wiki/scripts/`. Neither needs `npm install`.

```bash
cd wiki
node scripts/check-wiki.mjs .               # everything; exit code 1 on errors
node scripts/check-wiki.mjs . --mode crisp  # crisp thresholds
node scripts/check-wiki.mjs . --page 02-architecture/overview.md
node scripts/gen-section-indexes.mjs .      # rewrite each section's index.md from catalogue.json
```

`npm run build` runs the site-affecting checks (`--site`) before `vitepress build`, and `npm run check` runs them all. Errors cover frontmatter and title length, `{{ }}` and tag-shaped text outside code, Mermaid rules, broken relative links, cited files and line ranges that do not exist, per-page diagram and citation thresholds, and catalogue pages that were never written. Warnings cover wide tables, dead `#anchor` links, pages missing from the catalogue, an `llms.txt` over 5 KB, and files left behind in the repository.

## Changes in This Fork

Compared with upstream 2.0.0:

- **Deduplicated rules.** Repo resolution, citations, palette, and layout now live only in `wiki-conventions`. Commands are thin wrappers and agents preload skills. Upstream copies had drifted: two palettes, `wiki-site/` vs `wiki/`, and a missing `docs:build` script.
- **Repo resolution** auto-detects the remote (SSH remotes converted to https), uses the default branch, and has host-specific citation formats. It asks only when there is no remote, and subagents never ask.
- **VitePress**: templates ship as real files. Fixes: `appearance: 'force-dark'`; static assets in `wiki/public/` (not `.vitepress/public/`, which isn't served); a zoom modal that doesn't leak document listeners; a dynamic sidebar; CSS overrides that keep Mermaid accent colors.
- **Dependencies**: Mermaid 12 (with an npm `overrides` entry so `vitepress-plugin-mermaid`, whose peer range stops at 11, installs cleanly), diagrams pinned to the classic dagre layout and look, and Node 22.12+ required.
- **Deploy**: default branch trigger, Node 24, current action majors, a fixed owner/repo parse, and a no-lockfile variant without the `setup-node` cache lines that broke crisp deploys.
- **ADO export**: a tested script that keeps cross-page wiki links (upstream flattened every `../` link) and lives in `wiki/scripts/` with a working `npm run build:ado`.
- **Pipelines**: `generate` writes `wiki/catalogue.json` and dispatches parallel writer subagents; crisp phases respect dependencies (llms.txt runs last); onboarding writes to `wiki/onboarding/`.
- **Onboarding** marks facts the repo can't provide (owners, SLAs, metrics) as unknown instead of inventing them.
- **llms.txt** uses a generated-file marker for safe overwrites and writes `wiki/public/` copies. **Changelog** takes ranges or `--since` and can write `wiki/changelog.md`.
- The generated `CLAUDE.md` uses an `@AGENTS.md` import so Claude Code loads the instructions.

Added in 2.2.0, from a review of a generated wiki:

- **Sidebar**: section labels come from `catalogue.json`, section `index.md` files are generated by a script instead of written by hand (hand-written ones produced sentence-long titles ending in `undefined`), and the index is the group heading's link, not a duplicate child.
- **Layout**: tables scroll inside the text column instead of spilling into the outline, long paths wrap inside cells, and the text column is wider.
- **Build safety**: a broken link between pages fails the build (`ignoreDeadLinks` is no longer `true`), and inline code is `v-pre` so `${{ github.ref }}` and similar text cannot break it.
- **Checker**: `check-wiki.mjs` replaces the prose checklists; writers run it on their own page and `generate` runs it before the build.
- **Regenerate** has defined semantics: what is replaced, what is deleted, and what the user is asked about.
- **Writers and the architect** treat the source repo as read-only, take line numbers only from files they opened, and report counts from the files they wrote.

## License

MIT. [LICENSE](LICENSE) keeps the upstream notice from [microsoft/skills](https://github.com/microsoft/skills/blob/main/LICENSE) and adds the copyright for this fork's changes.
