---
description: Generate a complete wiki for the current repository - catalogue, all pages, onboarding guides, VitePress site, AGENTS.md, and llms.txt
argument-hint: "[focus area] [--no-build]"
---

# Deep Wiki: Full Generation

Generate a complete, evidence-based wiki in `wiki/`, packaged as a dark-only VitePress site. You orchestrate; the plugin's subagents do the heavy reading and writing so no single context has to hold the whole repo.

Load the `deep-wiki:wiki-conventions` skill first. Every step below follows it.

## Step 0: Repository Context

Resolve `REPO_URL`, `HOST`, and `BRANCH` once, as the conventions describe (detect; ask only if there is no remote). Every subagent prompt in later steps includes these three values.

If `wiki/` already has pages, ask the user whether to regenerate everything, fill only the missing pages from the catalogue, or stop. Record the answer as `MODE_WRITE` (`regenerate` or `fill-missing`) and apply it in every writing step below.

In `fill-missing` mode, never overwrite an existing output file. Before each write or dispatch, check whether the target path exists, and skip it if it does. Add each skipped path to the report's "skipped because they already existed" list. This covers `wiki/catalogue.json` (reuse it rather than re-dispatching the architect), each catalogue leaf, each section `index.md`, each onboarding guide and `wiki/onboarding/index.md`, `wiki/index.md`, and the files that Step 4 copies from the templates. Step 4's post-processing touches only pages written in this run.

## Step 1: Catalogue

Dispatch the `deep-wiki:wiki-architect` subagent with the repository context, mode `full`, and any focus from the arguments. It writes `wiki/catalogue.json`. In `fill-missing` mode, if `wiki/catalogue.json` already exists, skip the architect and use that file. Read the file and show the user the section summary.

## Step 2: Pages

For every leaf in the catalogue, dispatch a `deep-wiki:wiki-writer` subagent. In `fill-missing` mode, dispatch writers only for leaves whose `wiki/<path>` does not exist yet. Each prompt contains:

- `REPO_URL`, `HOST`, `BRANCH`, and mode `full`
- the leaf's `path` (under `wiki/`), `name`, and `prompt`
- the full list of leaf paths and names, so cross-links resolve

Run at most 5 writers at a time and wait for each batch. Collect each writer's report. When all batches finish, re-dispatch any page that failed its thresholds, once.

For each section `dir` without its own page, write a short `wiki/<dir>/index.md` that introduces the section and links its pages.

## Step 3: Onboarding

Follow the `deep-wiki:wiki-onboarding` skill to write the four guides and the hub in `wiki/onboarding/`. Dispatch one `deep-wiki:wiki-writer` per guide, in parallel, giving each guide's required sections as its task. Write `wiki/onboarding/index.md` yourself. In `fill-missing` mode, dispatch only the guides that are missing, and write the hub only if it is missing.

## Step 4: Site

Follow the `deep-wiki:wiki-vitepress` skill without its build step: copy the templates, fill in the placeholders, write `wiki/index.md`, and post-process every page. In `fill-missing` mode, copy only the template files that are missing, write `wiki/index.md` only if it is missing, and post-process only the pages written in this run.

## Step 5: AGENTS.md

Follow the `deep-wiki:wiki-agents-md` skill for the repo root, `wiki/`, and other pertinent folders, only where the files are missing.

## Step 6: llms.txt

Follow the `deep-wiki:wiki-llms-txt` skill. It runs after every page exists (it inlines them) and before the build, so the build publishes the current `wiki/public/llms*.txt`.

## Step 7: Build

Unless the arguments contain `--no-build`, run `cd wiki && npm install && npm run build`. Fix any build error at its source page and rebuild. Confirm `wiki/.vitepress/dist/llms.txt` exists.

## Step 8: Report

Output:

1. A table with `Section | Pages | Diagrams | Cited files`, plus the totals.
2. The files created, and the files skipped because they already existed.
3. The build result, or "build skipped".
4. Next steps: `cd wiki && npm run dev` to preview, and `/deep-wiki:deploy` (GitHub Pages) or `/deep-wiki:ado` (Azure DevOps) to publish.

## Arguments

An optional focus area (for example a subsystem or folder) passed to the architect. `--no-build` skips `npm install` and the build.

$ARGUMENTS
