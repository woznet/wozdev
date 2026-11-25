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
| `wiki-conventions` | **Single source of truth**: repo resolution, citation formats per host, the dark palette, VitePress-safe Markdown, the `wiki/` layout, thresholds, and the generated-file marker. Every other skill and agent loads it. |
| `wiki-architect` | Catalogue (`wiki/catalogue.json`) |
| `wiki-page-writer` | One documentation page |
| `wiki-onboarding` | Contributor, Staff Engineer, Executive, and PM guides |
| `wiki-researcher` | Multi-iteration deep research |
| `wiki-qa` | Grounded Q&A |
| `wiki-changelog` | Git-history changelog |
| `wiki-vitepress` | Site scaffold from `templates/` (config, theme, CSS, logo) |
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
├── NN-section/*.md        # Pages
├── changelog.md           # Optional (--write)
├── research/*.md          # Optional (--write)
├── llms.txt, llms-full.txt
├── public/                # logo.svg, llms copies (served at the site root)
├── AGENTS.md, CLAUDE.md   # Only if missing
├── package.json
├── scripts/               # build-ado-wiki.mjs (after /deep-wiki:ado)
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
7. **Non-destructive**: never overwrite hand-written `AGENTS.md`, `CLAUDE.md`, or `llms.txt`; the marker `<!-- generated by deep-wiki -->` identifies generated files.

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

## License

MIT. [LICENSE](LICENSE) keeps the upstream notice from [microsoft/skills](https://github.com/microsoft/skills/blob/main/LICENSE) and adds the copyright for this fork's changes.
