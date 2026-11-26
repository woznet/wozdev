---
description: Generate a complete wiki for the current repository - catalogue, all pages, onboarding guides, VitePress site, AGENTS.md, and llms.txt
argument-hint: "[focus area] [--no-build]"
---

# Deep Wiki: Full Generation

Generate a complete, evidence-based wiki in `wiki/`, packaged as a dark-only VitePress site. You orchestrate; subagents do the heavy reading and writing so no single context has to hold the whole repo.

Load `deep-wiki:wiki-conventions` and `deep-wiki:wiki-vitepress` first. The conventions govern every step; the vitepress skill's base directory is where the scripts come from. Three rules shape this workflow:

- **Scripts decide.** Counts, thresholds, links, and titles are what `check-wiki.mjs` reports. Scaffold files, section indexes, the onboarding hub, and the llms files are written by scripts, never by hand.
- **The source repository is read-only** (conventions section 9).
- **Nothing is deleted without showing the paths and getting a yes.**

Run every command from the repository root.

## Step 0: Context, Write Mode, Tools

1. Run `node --version`. Below 22.12, stop and tell the user.
2. Resolve `REPO_URL`, `HOST`, and `BRANCH` (conventions section 1).
3. Decide the write mode:
   - `wiki/` has no pages and no `catalogue.json`: `fill-missing`, no question. Existing `AGENTS.md`, `CLAUDE.md`, and root `llms.txt` files are kept.
   - Otherwise ask once: **regenerate**, **fill missing** (keeps the existing catalogue and pages, writes what is absent), or **stop**. In the regenerate option, say that pages and the site scaffold (config, theme) are replaced with the base path kept, and that sections missing from the new catalogue will be listed for deletion later. If unmarked `AGENTS.md` / `CLAUDE.md` files exist, list them in the same question and ask whether to replace or keep them.
4. Apply conventions section 8 for that write mode in every step. Do not restate or widen it.
5. Install the scripts and record the run state:

   ```bash
   node <vitepress skill dir>/templates/scripts/init-wiki.mjs wiki --scripts-only --depth full --host <HOST> --repo-url "<REPO_URL or ''>" --branch "<BRANCH>"
   ```

6. In a git repository, save the starting state: `node wiki/scripts/check-wiki.mjs wiki --write-baseline wiki/.vitepress/cache/deep-wiki-baseline.txt`.

## Step 1: Catalogue

1. Dispatch `deep-wiki:wiki-architect` (conventions section 11) with any focus from the arguments. In `fill-missing`, if `wiki/catalogue.json` exists, skip the architect and use that file.
2. Run `node wiki/scripts/check-wiki.mjs wiki --catalogue-only`. Fix errors in the file yourself; re-dispatch the architect only if the file is missing or unparseable. Use the counts the checker prints.
3. Show the user the section summary. Above 40 pages, confirm before continuing.

## Step 2: Pages

1. Dispatch `deep-wiki:wiki-writer` subagents for the catalogue pages, as conventions section 11 describes: depth `full`, output paths as `wiki/<path>`, the full sibling list, up to 3 pages of one section per writer, at most 5 writers at a time. In `fill-missing`, only for pages that do not exist.
2. `regenerate` without a focus argument only: run `node wiki/scripts/check-wiki.mjs wiki --pending` and collect the `catalogue-drift` warnings (stale folders, pages, and indexes). Show the exact paths and ask. Delete only what the user confirms. With a focus argument, delete nothing.
3. Run `node wiki/scripts/gen-section-indexes.mjs wiki` (in `regenerate`: add `--force`, and `--prune` if the user confirmed the stale indexes).
4. Run `node wiki/scripts/check-wiki.mjs wiki --pending`.
5. For each catalogue page with errors, dispatch one repair task (conventions section 11), once. In `fill-missing`, repair only pages written in this run and report the rest. Fix what remains yourself.
6. Rerun step 3 if any page's title or description changed.

## Step 3: Onboarding

Dispatch one `deep-wiki:wiki-writer` per guide, in parallel, each with the onboarding task form (conventions section 11): load `deep-wiki:wiki-onboarding` and write `wiki/onboarding/<guide>.md`. The four guides are `contributor-guide.md`, `staff-engineer-guide.md`, `executive-guide.md`, and `product-manager-guide.md`. In `fill-missing`, only the missing ones. Do not write `onboarding/index.md`; Step 7 generates it.

## Step 4: Site

Follow `deep-wiki:wiki-vitepress` Steps 1 and 2 only: run `init-wiki.mjs` with the title and description (add `--write-mode regenerate` in that write mode), then write `wiki/index.md` if section 8 allows.

## Step 5: AGENTS.md

Follow `deep-wiki:wiki-agents-md` for the repository root and `wiki/`.

## Step 6: llms.txt

Follow `deep-wiki:wiki-llms-txt`. It runs after every page exists and before the build.

## Step 7: Check, Leftovers, Build

1. Run `node wiki/scripts/gen-section-indexes.mjs wiki` (with `--force` in `regenerate`).
2. Run `node wiki/scripts/check-wiki.mjs wiki --baseline wiki/.vitepress/cache/deep-wiki-baseline.txt` (omit `--baseline` outside git). Fix every error at its source and rerun. Fix the warnings you can. In `fill-missing`, errors in pages that existed before the run are reported, not fixed.
3. `leftover` warnings name files that appeared or changed in the repository during the run. List them and ask the user what to do. Delete nothing on your own.
4. Unless the arguments contain `--no-build`: `npm --prefix wiki install`, then `npm --prefix wiki run build`. Fix any build error at its source page and rebuild. Confirm `wiki/.vitepress/dist/llms.txt` exists.

## Step 8: Report

1. The table from `node wiki/scripts/check-wiki.mjs wiki --report`.
2. The checker's summary line, and any warnings left in place with the reason.
3. Files created, replaced, deleted, and skipped.
4. The build result, or "build skipped".
5. Next steps: `npm --prefix wiki run dev` to preview (check a few diagrams render), and `/deep-wiki:deploy` to publish to GitHub Pages.

## Arguments

An optional focus area (a subsystem or folder) passed to the architect. `--no-build` skips `npm install` and the build.

$ARGUMENTS
