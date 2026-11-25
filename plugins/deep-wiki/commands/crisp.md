---
description: Generate a fast, concise wiki for the current repository - 5 to 7 dense pages, one onboarding guide, and a VitePress site scaffold, with minimal tool calls and no npm build
argument-hint: "[focus area]"
---

# Deep Wiki: Crisp (Fast Wiki Generation)

Generate a concise, high-signal wiki in `wiki/` quickly. This is the speed-optimized alternative to `/deep-wiki:generate`: fewer, denser pages, crisp-mode thresholds, and no `npm install` or build.

Load the `deep-wiki:wiki-conventions` skill first. Use its **crisp** thresholds throughout (1–2 diagrams and at least 3 cited files per page).

## Phase 1: Context and Scan (sequential)

1. Resolve `REPO_URL`, `HOST`, and `BRANCH` as the conventions describe.
2. Scan once, read-only: do not run the project's tests, builds, or scripts. List the tree to depth 3 (skip `node_modules/`, `.git/`, `dist/`, `wiki/`), then read the README, the manifests, and at most 10–15 key source files (entry points, main config, 2–3 core modules). Batch the reads and don't re-read files.

## Phase 2: Pages and Onboarding (parallel)

Write the pages that apply; skip the rest. Five pages is fine for a small project.

| Page | File | Content |
|------|------|---------|
| Architecture | `wiki/01-architecture/overview.md` | One system diagram, a component table, key design decisions |
| Getting Started | `wiki/02-getting-started/setup.md` | Prerequisites, install, run, test: real commands only |
| Core Modules | `wiki/03-core/modules.md` | Module table (purpose, key file, source) and one relationship diagram |
| API / Interface | `wiki/04-api/endpoints.md` | Routes, APIs, CLI commands, or events. Skip if there are none |
| Data | `wiki/05-data/models.md` | Models, storage, schema. Skip if there is no storage |
| Configuration | `wiki/06-config/settings.md` | Config options and environment variables. Merge into another page if small |
| Contributing | `wiki/07-contributing/guide.md` | Dev loop, tests, PR process |

Also write the contributor guide in crisp form (`wiki/onboarding/contributor-guide.md`, 500–800 lines) and `wiki/onboarding/index.md`, as the `deep-wiki:wiki-onboarding` skill describes.

Each page follows the `deep-wiki:wiki-page-writer` structure scaled to crisp mode. You may write the pages yourself from the Phase 1 reads or dispatch `deep-wiki:wiki-writer` subagents in parallel with mode `crisp`.

## Phase 3: Site Scaffold (after Phase 2)

Follow the `deep-wiki:wiki-vitepress` skill with the build step skipped: copy the templates, fill in the placeholders, and write `wiki/index.md`. Then run `node wiki/scripts/check-wiki.mjs wiki --mode crisp` and fix every error it reports (it needs only Node, not `npm install`). Crisp creates no section `index.md` files, so the landing page's Documentation Map links each section's page directly (for example `./01-architecture/overview.md`), never a bare folder route.

## Phase 4: Agent Files, llms.txt, and Deploy (after Phase 3)

1. The `deep-wiki:wiki-agents-md` skill for the repo root and `wiki/` only, where missing. Keep the content proportional to the wiki.
2. The `deep-wiki:wiki-llms-txt` skill (root, `wiki/`, `wiki/public/`).
3. The `deep-wiki:wiki-deploy` skill, only if `HOST` is `github` and no Pages workflow exists, using the **no-lockfile** variant (`npm install`, no cache lines), because crisp does not run npm.

## Report

```markdown
## Crisp Wiki Generated

### Pages
| Page | Diagrams | Cited files |
|------|----------|-------------|

### Infrastructure
- Created / skipped files (site scaffold, AGENTS.md, CLAUDE.md, llms files, workflow)

### Next steps
1. Preview: `cd wiki && npm install && npm run dev`
2. Commit: `git add wiki/ llms.txt AGENTS.md CLAUDE.md .github/workflows/deploy-wiki.yml` (only the files that were created)
3. GitHub Pages: Settings → Pages → Source → GitHub Actions (one-time)
4. For deeper coverage and all four onboarding guides, run `/deep-wiki:generate`.
```

## Arguments

An optional focus area that narrows the scan and the pages.

$ARGUMENTS
