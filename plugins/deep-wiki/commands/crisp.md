---
description: Generate a fast, concise wiki for the current repository - 5 to 7 dense pages, one onboarding guide, and a VitePress site scaffold, with minimal tool calls and no npm build
argument-hint: "[focus area]"
---

# Deep Wiki: Crisp (Fast Wiki Generation)

Generate a concise, high-signal wiki in `wiki/` quickly: fewer, denser pages at `crisp` depth, no catalogue, and no `npm install` or build. For full coverage use `/deep-wiki:generate`.

Load `deep-wiki:wiki-conventions`, `deep-wiki:wiki-page-writer`, and `deep-wiki:wiki-vitepress`. Run every command from the repository root. The source repository is read-only.

## Phase 1: Context and Scan

1. Run `node --version`; below 22.12, stop and tell the user.
2. If `wiki/` already has pages, ask: replace them with a crisp wiki, or stop. Never mix crisp pages into a full-depth wiki silently.
3. Resolve `REPO_URL`, `HOST`, and `BRANCH`, then install the scripts and record the depth:

   ```bash
   node <vitepress skill dir>/templates/scripts/init-wiki.mjs wiki --scripts-only --depth crisp --host <HOST> --repo-url "<REPO_URL or ''>" --branch "<BRANCH>"
   ```

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

Also produce `wiki/onboarding/contributor-guide.md` at crisp depth by dispatching one `deep-wiki:wiki-writer` with the onboarding task form (conventions section 11).

Write the pages yourself from the Phase 1 reads, or dispatch `deep-wiki:wiki-writer` subagents in parallel at depth `crisp`. Check each page with `node wiki/scripts/check-wiki.mjs wiki --page <path>`.

## Phase 3: Site Scaffold

Follow `deep-wiki:wiki-vitepress` Steps 1–3 and skip the build: run `init-wiki.mjs` with the title and description, write `wiki/index.md`, run `gen-section-indexes.mjs` (it writes the onboarding hub; a crisp wiki has no section indexes, so the landing page links each section's page directly), then run `node wiki/scripts/check-wiki.mjs wiki` and fix every error.

## Phase 4: Agent Files and llms.txt

1. `deep-wiki:wiki-agents-md` for the repository root and `wiki/` only. Keep the content proportional to the wiki.
2. `deep-wiki:wiki-llms-txt` (it runs `gen-llms.mjs`).

## Report

1. The table from `node wiki/scripts/check-wiki.mjs wiki --report`, and the checker's summary line.
2. Files created, replaced, and skipped (site scaffold, `AGENTS.md`, `CLAUDE.md`, llms files).
3. Next steps:
   - Preview: `npm --prefix wiki install`, then `npm --prefix wiki run dev`
   - Publish to GitHub Pages: `/deep-wiki:deploy`
   - Deeper coverage and all four onboarding guides: `/deep-wiki:generate`

## Arguments

An optional focus area that narrows the scan and the pages.

$ARGUMENTS
