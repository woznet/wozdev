---
description: Generate a fast, concise wiki for the current repository - 5 to 7 dense pages, one onboarding guide, and a VitePress site scaffold, with minimal tool calls and no npm build
argument-hint: "[focus area]"
---

# Deep Wiki: Crisp (Fast Wiki Generation)

Generate a concise, high-signal wiki in `wiki/` quickly: fewer, denser pages at `crisp` depth, no catalogue, and no `npm install` or build. For full coverage use `/deep-wiki:generate`.

Load `deep-wiki:wiki-conventions`, `deep-wiki:wiki-page-writer`, and `deep-wiki:wiki-vitepress`. Run every command from the repository root, in the forms conventions section 10 gives. The source repository is read-only.

## Phase 1: Context and Scan

1. Check Node (conventions section 10). Below 22.12, stop and tell the user.
2. If the wiki has pages (conventions' definition) or a `wiki/catalogue.json`, crisp never extends it:
   - **With a focus argument:** stop. Suggest `/deep-wiki:generate <focus>` or `/deep-wiki:page <topic>`, which add to an existing wiki without deleting anything.
   - **Without one:** ask: replace the wiki with a crisp one, or stop. If the user chooses replace:
     - The write mode is `regenerate`; on a fresh repository it is `fill-missing`.
     - List by exact path: every page under `wiki/NN-*/`, `wiki/catalogue.json`, `wiki/index.md`, and the onboarding guides other than `contributor-guide.md` (this run rewrites that one). `wiki/research/` and `wiki/changelog.md` are kept. Ask to delete the listed paths. If the user declines, stop.
     - Delete `wiki/catalogue.json` now, so the page checks in Phase 2 treat unwritten siblings as pending. Delete the rest after Phase 2, skipping any path this run wrote.
3. Resolve `REPO_URL`, `HOST`, and `BRANCH`, then run the bootstrap command from conventions section 10, which says which flags to pass. Crisp always records depth `crisp`: with no `wiki/.deep-wiki.json`, pass all four flags with `--depth crisp`; when the file exists (replacing a wiki, or a wiki that so far holds only guides, research, or a changelog), pass `--scripts-only --depth crisp`.
4. Scan once. List the tree to depth 3 (skip `node_modules/`, `.git/`, `dist/`, `wiki/`), then read the README, the manifests, and at most 10–15 key source files (entry points, main config, 2–3 core modules). Batch the reads and don't re-read files.

## Phase 2: Pages and Onboarding (parallel)

Write the pages that apply; skip the rest. Five pages is fine for a small project. With a focus (fresh repository only), write Architecture for the focus and only the other rows the focus has something for.

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

1. Run `init-wiki.mjs`. Pass `--title` and `--description` only when `wiki/.vitepress/config.mts` does not exist or the user chose replace (then also `--write-mode regenerate`).
2. Write `wiki/index.md`. A crisp wiki has no section indexes, so the landing page links each section's page directly.
3. Run `node wiki/scripts/gen-section-indexes.mjs wiki`; with no catalogue it writes only the onboarding hub.
4. Run `node wiki/scripts/check-wiki.mjs wiki --pending` and fix every error in the pages this run wrote. Report errors in pages it kept (`research/`, `changelog.md`); do not edit them. The llms files do not exist yet.

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

An optional focus area (a subsystem or folder). On a fresh repository it narrows the scan and the page list to what the focus has. On a wiki that already has pages, crisp stops (Phase 1).

$ARGUMENTS
