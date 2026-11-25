---
description: Generate a complete wiki for the current repository - catalogue, all pages, onboarding guides, VitePress site, AGENTS.md, and llms.txt
argument-hint: "[focus area] [--no-build]"
---

# Deep Wiki: Full Generation

Generate a complete, evidence-based wiki in `wiki/`, packaged as a dark-only VitePress site. You orchestrate; the plugin's subagents do the heavy reading and writing so no single context has to hold the whole repo.

Load the `deep-wiki:wiki-conventions` skill first. Every step below follows it. Two of its rules shape this workflow:

- **Scripts decide, not self-reports.** Page counts, thresholds, links, and titles are whatever `wiki/scripts/check-wiki.mjs` says they are. Section `index.md` files come from `wiki/scripts/gen-section-indexes.mjs`. Do not write a replacement for either script.
- **The source repository is read-only.** Nobody in this run executes the project's tests, builds, or scripts.

## Step 0: Repository Context and Write Mode

Resolve `REPO_URL`, `HOST`, and `BRANCH` once, as the conventions describe (detect; ask only if there is no remote). Every subagent prompt in later steps includes these three values.

If `wiki/` already has pages, ask the user whether to regenerate everything, fill only the missing pages from the catalogue, or stop. Record the answer as `MODE_WRITE` (`regenerate` or `fill-missing`). A fresh run is `regenerate`. Conventions section 8 says what each mode may replace; apply it in every step below.

In `regenerate` mode, in the same question, list any existing `AGENTS.md` / `CLAUDE.md` files and a root `llms.txt` without the deep-wiki marker, and ask whether to replace or keep them. Tell the user that section folders and pages missing from the new catalogue will be deleted.

In `fill-missing` mode, never overwrite an existing output file. Before each write or dispatch, check whether the target exists and skip it if it does. Add each skipped path to the report.

Then prepare the tools:

1. Copy the scripts from the `deep-wiki:wiki-vitepress` skill's `templates/scripts/` folder to `wiki/scripts/` (replace older copies).
2. Save the starting state of the working tree so leftovers can be found later: `git status --porcelain --untracked-files=all > wiki/.vitepress/cache/deep-wiki-baseline.txt` (create the folder; skip this when the repo is not a git repository).

## Step 1: Catalogue

Dispatch the `deep-wiki:wiki-architect` subagent with the repository context, mode `full`, and any focus from the arguments. It writes `wiki/catalogue.json`. In `fill-missing` mode, if `wiki/catalogue.json` already exists, skip the architect and use that file.

Run `node wiki/scripts/check-wiki.mjs wiki --catalogue-only`. If it reports errors, send them back to the architect once; fix what remains yourself. Use the section and page counts the checker prints, not the architect's summary. Read the file and show the user the section summary.

In `regenerate` mode, delete every `wiki/NN-*/` folder that is not a top-level `dir` in the new catalogue, and list the deleted folders in the report.

## Step 2: Pages

For every leaf in the catalogue, dispatch a `deep-wiki:wiki-writer` subagent. In `fill-missing` mode, dispatch writers only for leaves whose `wiki/<path>` does not exist yet. Each prompt contains:

- `REPO_URL`, `HOST`, `BRANCH`, and mode `full`
- the leaf's `path` (under `wiki/`), `name` (the page's frontmatter `title`), and `prompt`
- the sibling list: every leaf path and name, each section's `<dir>/index.md`, and the onboarding pages (`onboarding/index.md`, `contributor-guide.md`, `staff-engineer-guide.md`, `executive-guide.md`, `product-manager-guide.md`)

Run at most 5 writers at a time and wait for each batch.

When all batches finish:

1. Run `node wiki/scripts/gen-section-indexes.mjs wiki` (add `--force` in `regenerate` mode). Never write a section `index.md` by hand.
2. Run `node wiki/scripts/check-wiki.mjs wiki`. Onboarding and the landing page do not exist yet, so ignore findings about them here.
3. Re-dispatch each catalogue page that has errors, once, giving the writer the checker's lines for that page. Fix whatever is left yourself.
4. In `regenerate` mode, delete pages the checker reports as "not in the catalogue".

## Step 3: Onboarding

Follow the `deep-wiki:wiki-onboarding` skill to write the four guides and the hub in `wiki/onboarding/`. Dispatch one `deep-wiki:wiki-writer` per guide, in parallel, giving each guide's required sections as its task and the same sibling list as Step 2. Write `wiki/onboarding/index.md` yourself. In `fill-missing` mode, dispatch only the guides that are missing, and write the hub only if it is missing.

## Step 4: Site

Follow the `deep-wiki:wiki-vitepress` skill without its build step: copy the templates, fill in the placeholders, and write `wiki/index.md`. In `fill-missing` mode, copy only the template files that are missing and write `wiki/index.md` only if it is missing.

## Step 5: AGENTS.md

Follow the `deep-wiki:wiki-agents-md` skill for the repo root, `wiki/`, and other pertinent folders. Existing files are skipped unless the user chose "replace" in Step 0.

## Step 6: llms.txt

Follow the `deep-wiki:wiki-llms-txt` skill. It runs after every page exists (it inlines them) and before the build, so the build publishes the current `wiki/public/llms*.txt`.

## Step 7: Check, Clean Up, Build

1. Run `node wiki/scripts/check-wiki.mjs wiki --baseline wiki/.vitepress/cache/deep-wiki-baseline.txt`. Fix every error at its source and rerun until there are none. Fix the warnings you can (wide tables, long cell text, dead anchors, oversized `llms.txt`).
2. For each `leftover` warning, the file appeared during this run and is not a wiki output (for example test results). Delete it and list it in the report. If you cannot tell whether the run created it, leave it and say so.
3. Unless the arguments contain `--no-build`, run `cd wiki && npm install && npm run build`. The build runs the checker's site checks first and fails on a broken link between pages. Fix any build error at its source page and rebuild. Confirm `wiki/.vitepress/dist/llms.txt` exists.

## Step 8: Report

Output:

1. A table with `Section | Pages | Diagrams | Cited files`, plus the totals, taken from `node wiki/scripts/check-wiki.mjs wiki --json` (`stats` and `pages`).
2. The checker's final summary line, and any warnings left in place with the reason.
3. The files created, replaced, deleted, and skipped because they already existed.
4. The build result, or "build skipped".
5. Next steps: `cd wiki && npm run dev` to preview, and `/deep-wiki:deploy` (GitHub Pages) or `/deep-wiki:ado` (Azure DevOps) to publish.

## Arguments

An optional focus area (for example a subsystem or folder) passed to the architect. `--no-build` skips `npm install` and the build.

$ARGUMENTS
