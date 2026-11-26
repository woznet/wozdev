---
description: Generate a fast, concise wiki for the current repository - 5 to 7 dense pages, one onboarding guide, and a VitePress site scaffold, with minimal tool calls and no npm build
argument-hint: "[focus area]"
---

# Deep Wiki: Crisp (Fast Wiki Generation)

Generate a concise, high-signal wiki in `wiki/` quickly: fewer, denser pages at `crisp` depth, no catalogue, and no `npm install` or build. For full coverage use `/deep-wiki:generate`.

Load `deep-wiki:wiki-conventions`, `deep-wiki:wiki-page-writer`, and `deep-wiki:wiki-vitepress`. Run every command from the repository root, in the forms conventions section 10 gives. The source repository is read-only.

## Phase 1: Context and Scan

1. Check Node (conventions section 10). Below 22.12, stop and tell the user.
2. If `wiki/` already has pages or a `catalogue.json`, ask: replace the wiki with a crisp one, or stop. Never mix crisp pages into an existing wiki. If the user chooses replace:
   - The write mode is `regenerate`; otherwise it is `fill-missing`.
   - List the existing `wiki/NN-*/` pages and `wiki/catalogue.json` by exact path and ask to delete them. If the user declines, stop.
   - Delete the confirmed paths after Phase 2, skipping any path this run wrote.
3. Resolve `REPO_URL`, `HOST`, and `BRANCH`, then run the bootstrap command from conventions section 10 with `--depth crisp`, `--host`, `--repo-url`, and `--branch`.
4. Scan once. List the tree to depth 3 (skip `node_modules/`, `.git/`, `dist/`, `wiki/`), then read the README, the manifests, and at most 10–15 key source files (entry points, main config, 2–3 core modules). Batch the reads and don't re-read files.

## Phase 2: Pages and Onboarding (parallel)

Write the pages that apply; skip the rest. Five pages is fine for a small project.

| Page | File | Content |
|------|------|---------|
| Architecture | `wiki/01-architecture/overview.md` | One system diagram, a component table, key design decisions |
| Getting Started | `wiki/02-getting-started/setup.md` | Prerequisites, install, run, test: commands from the repo's files only |
| Core Modules | `wiki/03-core/modules.md` | Module table (purpose, key file, source) and one relationship diagram |
| API / Interface | `wiki/04-api/endpoints.md` | Routes, APIs, CLI commands, or events. Skip if there are none |
| Data | `wiki/05-data/models.md` | Models, storage, schema. Skip if there is no storage |
| Configuration | `wiki/06-config/settings.md` | Config options and environment variables. Merge into another page if small |
| Contributing | `wiki/07-contributing/guide.md` | Dev loop, tests, PR process |

Also produce `wiki/onboarding/contributor-guide.md` at crisp depth by dispatching one `deep-wiki:wiki-writer` with the onboarding task form (conventions section 11). It is the only guide a crisp run writes.

Write the pages yourself from the Phase 1 reads, or dispatch `deep-wiki:wiki-writer` subagents in parallel at depth `crisp`. Check each page with `node wiki/scripts/check-wiki.mjs wiki --page <path>`.

## Phase 3: Site Scaffold

Follow `deep-wiki:wiki-vitepress` Steps 1–3 and skip the build:

1. Run `init-wiki.mjs` with the title and description (add `--write-mode regenerate` if the user chose replace).
2. Write `wiki/index.md`. A crisp wiki has no section indexes, so the landing page links each section's page directly.
3. Run `node wiki/scripts/gen-section-indexes.mjs wiki`; with no catalogue it writes only the onboarding hub.
4. Run `node wiki/scripts/check-wiki.mjs wiki --pending` and fix every error. The llms files do not exist yet.

## Phase 4: Agent Files and llms.txt

1. `deep-wiki:wiki-agents-md` for the repository root and `wiki/` only. Keep the content proportional to the wiki.
2. `deep-wiki:wiki-llms-txt` (it runs `gen-llms.mjs` and the full check).

## Report

1. The table from `node wiki/scripts/check-wiki.mjs wiki --report`, and the checker's summary line.
2. Files created, replaced, deleted, and skipped (site scaffold, `AGENTS.md`, `CLAUDE.md`, llms files).
3. Next steps:
   - Preview: `npm --prefix wiki install`, then `npm --prefix wiki run dev`
   - Publish to GitHub Pages, only when `HOST` is `github` and the remote is on github.com: `/deep-wiki:deploy`
   - Deeper coverage and all four onboarding guides: `/deep-wiki:generate` (choose regenerate there)

## Arguments

An optional focus area (a subsystem or folder) that narrows the scan and the pages.

$ARGUMENTS
