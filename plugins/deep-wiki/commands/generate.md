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

Run every command from the repository root, in the forms conventions section 10 gives.

## Step 0: Context, Write Mode, Tools

1. Check Node (conventions section 10). Below 22.12, stop and tell the user.
2. Resolve `REPO_URL`, `HOST`, and `BRANCH` (conventions section 1).
3. Decide the write mode:

   | Situation | Write mode |
   |-----------|------------|
   | The wiki has no pages (conventions' definition) and no `catalogue.json` | `fill-missing`, no question |
   | A focus argument was given | `fill-missing`, no question. The focus's pages are named targets (Steps 1 and 2); nothing else is written or deleted, and the recorded depth is kept |
   | Anything else | Ask once: **regenerate**, **fill missing**, or **stop** |

   In the question:
   - **Regenerate** replaces every page and the site scaffold (`config.mts`, theme, `package.json`, `.gitignore`, logo; the base path is kept). Sections missing from the new catalogue are listed for deletion later.
   - **Fill missing** keeps the existing catalogue and pages and writes what is absent.
   - If unmarked `AGENTS.md`, `CLAUDE.md`, or root `llms.txt` files exist, list them and ask whether regenerate should replace or keep them.
   - If `wiki/.deep-wiki.json` records depth `crisp`, say this is a crisp wiki and recommend regenerate: with fill missing, the crisp pages stay and are reported as under the full minimums.
4. Apply conventions section 8 for that write mode in every step. Do not restate or widen it.
5. Run the bootstrap command from conventions section 10, which says which flags to pass. First run: all four, with `--depth full`. When `wiki/.deep-wiki.json` exists: `--scripts-only --depth full`; with a focus, `--scripts-only` alone, so a crisp wiki stays crisp.
6. In a git repository, save the starting state: `node wiki/scripts/check-wiki.mjs wiki --write-baseline wiki/.vitepress/cache/deep-wiki-baseline.txt`.

## Step 1: Catalogue

1. Dispatch `deep-wiki:wiki-architect` (conventions section 11) when there is no `wiki/catalogue.json`, when the write mode is `regenerate`, or when a focus was given (the architect merges the focus into an existing catalogue and returns the pages it added or changed). In `fill-missing` with an existing catalogue and no focus, skip the architect.
2. Run `node wiki/scripts/check-wiki.mjs wiki --catalogue-only`. Fix errors in the file yourself. Re-dispatch the architect only if the file is missing or unparseable, and only once; if it fails again, stop and report. Use the counts the checker prints.
3. Show the user the section summary. Above 40 pages to write, confirm before continuing.

## Step 2: Pages

1. Dispatch `deep-wiki:wiki-writer` page tasks as conventions section 11 describes: the depth recorded in `wiki/.deep-wiki.json` (`full`, unless a focus run is extending a crisp wiki), output paths as `wiki/<path>`, the full sibling list, up to 3 pages of one section per writer, at most 5 writers at a time. Exactly one row applies:

   | Run | Pages |
   |-----|-------|
   | With a focus | Only the pages the architect added or changed, whether or not they exist. Other catalogue pages that were never written stay unwritten: list them in the report |
   | No focus, `regenerate` | Every catalogue page |
   | No focus, `fill-missing` | Catalogue pages that do not exist |

2. If a writer returns without having written a page, dispatch that page once more as a page task. If it is still missing, write it yourself.
3. `regenerate` only: run `node wiki/scripts/check-wiki.mjs wiki --pending` and collect the `catalogue-drift` warnings (stale folders, pages, and indexes). Show the exact paths and ask. Delete only what the user confirms. Pages the user keeps are reported, not fixed (conventions section 8).
4. Run `node wiki/scripts/gen-section-indexes.mjs wiki` (in `regenerate`: add `--force`, and `--prune` if the user confirmed the stale indexes).
5. Run `node wiki/scripts/check-wiki.mjs wiki --pending`. It skips the llms checks and accepts links to the landing page and onboarding pages, which do not exist yet.
6. For each page written in this run that has errors, dispatch one repair task (conventions section 11), once. Fix what remains yourself. Report errors in pages this run did not write. With a focus, a `catalogue-drift` error for a page outside the focus that was never written is expected: list it, do not write the page.

## Step 3: Onboarding

1. Dispatch one `deep-wiki:wiki-writer` per guide, in parallel, each with the onboarding task form (conventions section 11): load `deep-wiki:wiki-onboarding` and write `wiki/onboarding/<guide>.md`. The four guides are `contributor-guide.md`, `staff-engineer-guide.md`, `executive-guide.md`, and `product-manager-guide.md`. In `fill-missing`, only the missing ones. With a focus, write guides only when `wiki/onboarding/` holds no guide at all; otherwise skip this step and list any missing guides in the report.
2. Run `node wiki/scripts/gen-section-indexes.mjs wiki` again (with `--force` in `regenerate`). It writes `onboarding/index.md` and refreshes the section indexes after the Step 2 repairs. Never write the hub by hand.

## Step 4: Site

Follow `deep-wiki:wiki-vitepress` Steps 1 and 2 only:

1. Run `init-wiki.mjs`. Pass `--title` and `--description` only when `wiki/.vitepress/config.mts` does not exist or the write mode is `regenerate` (then also `--write-mode regenerate`).
2. Write `wiki/index.md` if section 8 allows. If it exists and is kept while this run added a section or page, note "landing page not updated" for the report.

## Step 5: AGENTS.md

Follow `deep-wiki:wiki-agents-md` for the repository root and `wiki/`. Step 6 will write the llms files, so its Documentation section may list them.

## Step 6: llms.txt

Follow `deep-wiki:wiki-llms-txt`. Every page, the hub, and the landing page exist by now.

## Step 7: Check, Leftovers, Build

1. Run `node wiki/scripts/check-wiki.mjs wiki --baseline wiki/.vitepress/cache/deep-wiki-baseline.txt` (omit `--baseline` outside git). Fix every error at its source in pages this run wrote, then rerun. Fix the warnings you can. Report errors in pages this run did not write, and the expected `catalogue-drift` errors of a focus run (Step 2).
2. If a fix changed any page, rerun `node wiki/scripts/gen-llms.mjs wiki`; if it changed a title or description, rerun the `gen-section-indexes` command from Step 3 first. Then rerun the check.
3. `leftover` warnings name files that appeared or changed in the repository during the run. List them and ask the user what to do. Delete nothing on your own.
4. Unless the arguments contain `--no-build`: `npm --prefix wiki install`, then `npm --prefix wiki run build`. Fix a build error at its source page and rebuild. If the failing page is one the user chose to keep or that existed before a `fill-missing` run, tell the user which page and stop. Confirm `wiki/.vitepress/dist/llms.txt` exists.

## Step 8: Report

1. The table from `node wiki/scripts/check-wiki.mjs wiki --report`.
2. The checker's summary line, and any findings left in place with the reason.
3. Files created, replaced, deleted, and skipped. With a focus: the catalogue pages outside it that are still unwritten, and "landing page not updated" when Step 4 noted it.
4. The build result, or "build skipped".
5. Next steps: `npm --prefix wiki run dev` to preview (check a few diagrams render). When `HOST` is `github` and the remote is on github.com, also `/deep-wiki:deploy` to publish to GitHub Pages.

## Arguments

- **Focus area** (optional): a subsystem or folder, such as `src/api`. Only that part of the catalogue and its pages are written, at the wiki's recorded depth, and nothing is deleted. A constraint such as "at most 10 pages" is not a focus: pass it to the architect as an instruction and run as if no focus was given.
- `--no-build` skips `npm install` and the build.

$ARGUMENTS
