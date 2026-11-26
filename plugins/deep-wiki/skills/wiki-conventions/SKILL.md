---
name: wiki-conventions
description: Use when running any deep-wiki skill, command, or agent and you need the shared rules - resolving the source repository and branch, citation link formats per git host, the dark-mode Mermaid palette, VitePress-safe Markdown, the wiki output layout, page quality thresholds, the bundled scripts and checker, and the overwrite and regenerate rules. Loaded by the other deep-wiki skills; not a user-facing task on its own.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Deep Wiki Conventions

The single source of truth for rules every deep-wiki skill, command, and agent shares. Other deep-wiki files reference this skill instead of restating these rules. When a task-specific skill disagrees with this file, this file wins.

Three terms are used throughout:

- **Depth**: `full` (default) or `crisp`. It sets the thresholds in section 7 and is recorded in `wiki/.deep-wiki.json`.
- **Write mode**: `fill-missing` (default) or `regenerate`. It sets what may be replaced (section 8).
- **Has pages**: a wiki has pages when `wiki/index.md` exists or any `.md` file exists under a `wiki/NN-*/` folder. Onboarding guides, `research/`, and `changelog.md` on their own do not count.

## 1. Repository Context (resolve once, before any analysis)

Resolve these values once per run and pass them to every subagent you dispatch:

| Value | How to resolve |
|-------|----------------|
| `REPO_URL` | `git remote get-url origin`. Normalize Azure DevOps SSH remotes first: `git@ssh.dev.azure.com:v3/<org>/<project>/<repo>` → `https://dev.azure.com/<org>/<project>/_git/<repo>`, and `<org>@vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>` → `https://<org>.visualstudio.com/<project>/_git/<repo>`. Then the generic SSH form: `git@host:org/repo(.git)` → `https://host/org/repo`; strip a trailing `.git`; strip credentials (`https://user@host/...` → `https://host/...`). |
| `HOST` | `github` (github.com or a GitHub Enterprise server), `gitlab` (gitlab.com or a self-hosted GitLab), `azure-devops` (`dev.azure.com` or `*.visualstudio.com`), otherwise `local`. Bitbucket, Gitea, any other host, and a repo with no remote are all `local`. |
| `BRANCH` | Default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (strip the `origin/` prefix). If that is unset, take the "HEAD branch" line of `git remote show origin`. If neither works, ask (main session); never use the current feature branch silently. With no remote and no URL given, or outside git, there is no branch: leave it empty and omit `--branch`. |

Rules:

- **Remote found** → use it. Do not ask the user to confirm.
- **No remote** → if you are the main session, ask once whether there is a source URL; otherwise treat the repo as `local`.
- **You are a subagent** → never ask the user. Use the values given in your prompt. If none were given, read `wiki/.deep-wiki.json`, then resolve them yourself with the commands above, and use `local` if that fails.
- An explicit URL or branch in the user's arguments overrides detection.
- Once a wiki exists, recorded values win over detection: the constants in `wiki/.vitepress/config.mts` when that file exists, otherwise `wiki/.deep-wiki.json` (section 10).
- The repository root is the git top level. Citation paths and the commands in this plugin are relative to it. The wiki folder is `wiki/` there; if the user keeps it elsewhere, substitute that folder in every command.

## 2. Citation Formats

Every non-trivial claim cites `file_path:line` (path relative to the repository root, forward slashes, exact upper and lower case).

| `HOST` | Single line | Line range |
|--------|-------------|------------|
| `github` | `[src/a.ts:42](REPO_URL/blob/BRANCH/src/a.ts#L42)` | `[src/a.ts:42-58](REPO_URL/blob/BRANCH/src/a.ts#L42-L58)` |
| `gitlab` | `[src/a.ts:42](REPO_URL/-/blob/BRANCH/src/a.ts#L42)` | `[src/a.ts:42-58](REPO_URL/-/blob/BRANCH/src/a.ts#L42-58)` |
| `azure-devops` | `[src/a.ts:42](REPO_URL?path=/src/a.ts&version=GBBRANCH&line=42&lineEnd=42&lineStartColumn=1&lineEndColumn=1)` | same, with `lineEnd=58` |
| `local` | `(src/a.ts:42)` | `(src/a.ts:42-58)` |

Special forms:

- **Files without an extension** (`Dockerfile`, `Makefile`) are cited the same way, `(Dockerfile:12)`, and verified the same way.
- **Approximate location**: `(src/a.ts:~ClassName)`, or the linked form without a line anchor.
- **Missing evidence**: `(Unknown – verify in path/to/check)`.
- **After every Mermaid diagram**: `<!-- Sources: src/a.ts:42, src/b.ts:10 -->` on one line. These are checked like any other citation.
- **Above a quoted code snippet**: `<!-- Source: src/a.ts:42-58 -->`.
- **Tables listing code artifacts** (components, APIs, config keys) include a `Source` column.
- **Inside a table**, a linked citation shows the file name and lines only, with the full path in the URL: `[a.ts:42-58](REPO_URL/blob/BRANCH/src/deep/path/a.ts#L42-L58)`. A full path in a cell is one unbreakable word. `local` citations have no URL, so they keep the full path everywhere; the long-cell warning does not apply to them.
- **Line numbers come from a file you opened**, never from a search hit or memory. A line past the end of the file is a checker error.
- **Never link to a source file with a relative path** (`../../src/a.ts`). Any relative link that leaves `wiki/` is a checker error in every mode.
- **Never link `README.md`, `AGENTS.md`, or `CLAUDE.md`**, inside or outside the wiki. They are not pages of the site, so the link would be dead; the checker reports it. Cite them like any other source file.
- **Commit links** (changelogs): `REPO_URL/commit/SHA`; `local`: plain short SHA.

## 3. Evidence Standard

- Trace actual code paths. If A calls B calls C, read all three. Do not infer behavior from names.
- Mark inference explicitly: "I read this" vs "inferred from structure".
- Never write "this likely handles…". Read the code, or say what you have not traced.
- Every file path, class, and function you name must exist. Check before finishing.

## 4. Dark-Mode Mermaid

The wiki is dark-only. Use this palette everywhere (theme variables, CSS, and inline `style`):

| Role | Fill | Stroke | Text |
|------|------|--------|------|
| Page background | `#0d1117` | — | `#e6edf3` |
| Subgraph / cluster | `#161b22` | `#30363d` | `#e6edf3` |
| Node (default) | `#2d333b` | `#6d5dfc` | `#e6edf3` |
| Secondary surface / edge label | `#1c2333` | `#6d5dfc` | `#e6edf3` |
| Lines, arrows, muted text | — | `#8b949e` | `#8b949e` |
| Accent: success | `#1a3a2a` | `#3fb950` | `#e6edf3` |
| Accent: warning | `#3a3020` | `#d29922` | `#e6edf3` |
| Accent: danger | `#3a1d1d` | `#f85149` | `#e6edf3` |

Inline style example: `style Api fill:#2d333b,stroke:#6d5dfc,color:#e6edf3`. Use accent fills only to carry meaning (healthy/degraded/failing, new/deprecated).

Syntax rules:

- Open every diagram with exactly ```` ```mermaid ````: lowercase, nothing after it. Any other opening (`Mermaid`, `mermaid title`, `mmd`) is not a diagram to the checker or the site.
- `<br>` in labels, never `<br/>` or `<br />`.
- `autonumber` in every `sequenceDiagram`.
- Hex colors are 3 or 6 digits only. No light fills (light hex values or names such as `white`): use the table above.
- No per-diagram `%%{init: ...}%%` line. The site applies the theme to every diagram.
- Keep diagrams readable at page width: at most 6 participants in a `sequenceDiagram`, at most 8 nodes in one `LR` row (switch to `TD` or split the diagram).
- Pick the type by content: structure → `graph`/`flowchart`; behavior → `sequenceDiagram` or `stateDiagram-v2`; data → `erDiagram`; types → `classDiagram`; decisions → `flowchart`.
- Only draw what the code has. A repo without persistent data gets no `erDiagram`.

Diagrams render in the browser. Neither the checker nor the build parses Mermaid syntax, so a syntax error shows only in `npm --prefix wiki run dev` or the built site. Balance every bracket and quote, and quote labels that contain punctuation.

## 5. VitePress-Safe Markdown

- Every page starts with frontmatter containing `title` and `description`, each on one line in double quotes: `title: "CLI: Commands"`. The quoted value must be valid YAML: write `\\` for a backslash and `\"` for a quote, or use single quotes when the text has backslashes. Quote any other frontmatter value that YAML would not read as text (`yes`, a date, a number). Add `outline: deep` for long pages.
- A page written at crisp depth inside a full-depth wiki carries `depth: crisp` in its frontmatter, so the checker applies the crisp minimums to that page.
- `title` is a name of at most 60 characters ("Dispatch Engine"), never a sentence. It becomes the sidebar label and the browser tab title. The sentence goes in `description`.
- Wrap generics and anything shaped like an HTML tag in backticks wherever it is not in a code fence, frontmatter included: `` `List<T>` ``, `` `Task<string>` ``.
- `{{` and `}}` (GitHub Actions expressions, Jinja, Helm, Vue, Handlebars) appear only inside backticks or a code fence. Vue evaluates them anywhere else and the build fails.
- Backticks protect text only where Markdown runs. Inside a raw HTML block (`<details>`, `<div>`), leave a blank line after the opening tag; without it the backticks are literal and `{{ }}` or `<T>` inside them breaks the build.
- Tables have at most 5 columns. Split a wider table, or fold two columns into one.
- In a table row, write a `|` inside inline code as `\|` (`` `string \| null` ``). An unescaped one splits the cell, the code span never forms, and what it protected breaks the build.
- Standard Markdown only; VitePress containers (`::: tip`) are allowed, custom shortcodes are not.
- Cross-page links are relative `.md` links to a file: `[Auth](../02-architecture/auth.md#token-refresh)`, `[Architecture](./02-architecture/index.md)`. Never link a folder (`./02-architecture`, `..`): link its `index.md`. A folder link without a trailing slash is a checker error. Reference-style links (`[Auth][auth]` with `[auth]: ./auth.md`) follow the same rules and are checked the same way.
- A link to a numbered heading uses the VitePress slug, which prefixes a leading digit with `_`: `## 7. Limits` is `#_7-limits`.
- Catalogue pages end with a `## Related Pages` table (`Page`, `Relationship`).

## 6. Output Layout

All generated documentation lives under `wiki/` at the repository root (the VitePress `srcDir`):

```text
wiki/
├── .deep-wiki.json           # Run state: depth, host, repoUrl, branch, base, wikiDir, version
├── .deep-wiki-llms.json      # Input for gen-llms.mjs (summary, descriptions); yours to edit, committed
├── catalogue.json            # Table of contents from wiki-architect (full depth)
├── index.md                  # Developer-focused landing page (no hero)
├── onboarding/               # Generated index.md + audience guides
├── NN-section-name/          # Numbered sections, e.g. 01-getting-started/
│   ├── index.md              # Generated by scripts/gen-section-indexes.mjs, never by hand
│   └── page-name.md
├── research/                 # Optional, from wiki-researcher
├── changelog.md              # Optional, from wiki-changelog
├── llms.txt / llms-full.txt  # Generated by scripts/gen-llms.mjs (plus a root ./llms.txt)
├── public/                   # Static assets served at the site root (logo.svg, llms*.txt)
├── AGENTS.md / CLAUDE.md     # From wiki-agents-md
├── package.json
├── scripts/                  # init-wiki, check-wiki, gen-section-indexes, gen-llms, lib (.mjs); not part of the site
└── .vitepress/               # config.mts, theme/
```

Static files go in `wiki/public/`, never `wiki/.vitepress/public/`. No folder inside the wiki is named `dist` or `node_modules`: the site never builds pages under those names.

## 7. Quality Thresholds

The checker enforces these minimums per page:

| Page kind | Depth | Mermaid diagrams | Diagram types | Distinct source files cited |
|-----------|-------|------------------|---------------|-----------------------------|
| Catalogue page, or any page in an `NN-*/` folder | full | 3 | 2 | 5 (or the leaf's `minFiles`) |
| | crisp | 1 | 1 | 3 |
| Contributor and staff engineer guides | full | 5 | 2 | 5 |
| | crisp | 2 | 1 | 3 |
| Executive and product manager guides | full | 3 | 2 | none |
| | crisp | 1 | 1 | none |

Section indexes, the landing page, `research/`, `changelog.md`, and any other file in `onboarding/` have no minimums. Two adjustments apply:

- A page with `depth: crisp` in its frontmatter is held to the crisp row whatever the wiki's depth.
- The cited-file minimum is never higher than the number of source files in the repository, so a tiny repository can still pass.

Size a full-depth catalogue page by the number of source files it covers. The checker enforces only the row above; the larger budgets are yours to meet.

| Scope | Relevant files | Words | Diagrams |
|-------|----------------|-------|----------|
| Small | ≤ 50 | 2,000–3,000 | 3 |
| Medium | 50–300 | 3,000–5,000 | 4 |
| Large | > 300 (sample entry points, domain models, data access, integration edges) | 5,000–8,000 | 5–8 |

A crisp page is 600–1,500 words with 1–2 diagrams.

## 8. Ownership and Write Modes

Files deep-wiki generates outside page content (`llms.txt`, `llms-full.txt`, `AGENTS.md`, `CLAUDE.md`, section `index.md`, `onboarding/index.md`, `changelog.md`, `research/*.md`) carry `<!-- generated by deep-wiki -->` on the line after the H1 (or as the first line if there is no H1). A file is "marked" only when the marker is there, within the first lines after the H1. Quoting the marker deeper in a file does not make it generated.

| Path | `fill-missing` | `regenerate` |
|------|----------------|--------------|
| `wiki/scripts/**`, `wiki/.deep-wiki.json` | Always refreshed | Always refreshed |
| `wiki/catalogue.json`, catalogue pages, onboarding guides, `wiki/index.md` | Write only if missing | Replace |
| Section `index.md`, `onboarding/index.md` | Write if missing or marked | Replace |
| `wiki/llms*.txt`, `wiki/public/llms*.txt` (the `public/` copies exist only when the wiki has a site) | Replace | Replace |
| `wiki/.deep-wiki-llms.json` | Create if missing; otherwise update stale entries only, never rewrite it wholesale | Same |
| Scaffold: `wiki/package.json`, `wiki/.vitepress/**`, `wiki/.gitignore`, `wiki/public/logo.svg` | Write only if missing. In an existing `config.mts`, `init-wiki` changes only the `--base`, `--repo-url`, and `--branch` you pass | Replace all four (`base` and other recorded values are kept) |
| `wiki/changelog.md`, `wiki/research/*.md` | Write if missing or marked | Same; a generate or crisp run never touches them |
| Root `llms.txt` | Replace if marked; unmarked: see below | Same |
| `AGENTS.md` / `CLAUDE.md` | Write only if missing | Replace if marked; unmarked: see below |
| `NN-*/` folders and pages no longer in the catalogue | Leave | Delete after confirmation |

Rules:

- **A named target is a request to replace it.** `/deep-wiki:page <topic>`, `/deep-wiki:onboard <guide>`, and `/deep-wiki:catalogue` replace the page, guide, or catalogue they name, in any write mode. Everything else those commands touch follows `fill-missing`.
- **A dispatched output path is a named target.** A subagent writes the path(s) it was given even if they exist. The write mode decides what the orchestrator dispatches, not whether a subagent writes.
- **Unmarked `AGENTS.md`, `CLAUDE.md`, and root `llms.txt` are the user's.** Keep them. Replace one only when the user chose `regenerate` on an existing wiki and, in that same question, chose to replace the files listed there, or when the user's own message for this run asks to replace that file.
- **Deleting needs a list and a yes.** Before deleting anything, show the exact paths and ask. Delete stale sections and pages only after their replacements are written. A run narrowed by a focus argument never deletes.
- **Pages the run did not write are reported, not fixed.** That covers pages that existed before a `fill-missing` run, stale pages the user chose to keep, pages outside a focus, and `research/` and `changelog.md` in a generate or crisp run. If one of them breaks the build, tell the user which page and stop.
- Report every skipped, replaced, and deleted file in the run summary.

## 9. Read-Only Source Repository

Generating documentation never changes or runs the project it documents.

- Do not run the project's tests, builds, installers, linters, or scripts. Take commands and expected output from the repository's files (README, manifests, CI workflows, test sources).
- Create no file outside `wiki/` and the documented outputs (root `llms.txt`, `AGENTS.md`, `CLAUDE.md`, the deploy workflow). No scratch files, logs, or test results.
- A subagent writes only the file(s) it was assigned.

## 10. Scripts and the Checker

The scripts need only Node 22.12 or newer, no `npm install`. Before the first script in any command, run `node --version`; if Node is missing or older than 22.12, stop and tell the user. `init-wiki.mjs` copies the scripts from the `deep-wiki:wiki-vitepress` skill's `templates/scripts/` folder (`<vitepress skill dir>` is that skill's base directory) into `wiki/scripts/`.

Command rules:

- Run every command from the repository root, on one line, in the forms below. Do not `cd` into `wiki/`. Quote the skill directory path.
- Never pass a value that starts with `/`: Git Bash on Windows rewrites it into a file path. The base is `--base <repo-name>` or `--base root`; the script adds the slashes.
- A repository with no web URL, or on a host that maps to `local`, is `--repo-url none`. With no branch (section 1), omit `--branch`. When you pass `--repo-url` without `--host`, the script works the host out from the URL again.
- Never redirect command output into a file the scripts will read; use the flags below.
- When `wiki/.vitepress/config.mts` exists, its constants are authoritative for the base, repository URL, and branch; otherwise `wiki/.deep-wiki.json` is. A wiki "has a site" only when `config.mts` exists.

**Bootstrap** (installs or refreshes `wiki/scripts/` and writes `wiki/.deep-wiki.json`). Every command that uses the scripts runs it first, every time, so `wiki/scripts/` always matches the installed plugin:

```bash
node "<vitepress skill dir>/templates/scripts/init-wiki.mjs" wiki --scripts-only --depth <full|crisp> --host <HOST> --repo-url <REPO_URL|none> --branch <BRANCH>
```

| Situation | Flags |
|-----------|-------|
| No `wiki/.deep-wiki.json` yet (first run) | All four (leave out `--branch` when there is none). Depth is `crisp` only for `/deep-wiki:crisp` and `/deep-wiki:page --crisp`; `full` for every other command |
| `wiki/.deep-wiki.json` exists | `--scripts-only` alone, plus only the flags whose value you mean to change. The recorded depth changes in two cases only: `/deep-wiki:generate` without a focus passes `--depth full`, and `/deep-wiki:crisp` replacing a wiki passes `--depth crisp`. Every other command, and `generate` with a focus, leaves it alone |

| Command | Use |
|---------|-----|
| `node "<vitepress skill dir>/templates/scripts/init-wiki.mjs" wiki --title "<name>" --description "<sentence>" [--write-mode regenerate]` | Write the site scaffold with every placeholder filled (see `deep-wiki:wiki-vitepress`) |
| `node wiki/scripts/init-wiki.mjs wiki --base <repo-name\|root>` | Change a recorded value later, with just that flag |
| `node wiki/scripts/gen-section-indexes.mjs wiki [--force] [--prune]` | Write every section `index.md` and `onboarding/index.md`. `--force` replaces unmarked ones; `--prune` deletes marked indexes whose folder left the catalogue |
| `node wiki/scripts/gen-llms.mjs wiki [--force]` | Write the llms files; reads `wiki/.deep-wiki-llms.json` when it exists (see `deep-wiki:wiki-llms-txt`). `--force` replaces an unmarked root `llms.txt`, only under the section 8 rule. Outside git, with no `--repo <path>`, it writes no root `llms.txt` |
| `node wiki/scripts/check-wiki.mjs wiki` | Check the whole wiki at the recorded depth |
| `npm --prefix wiki install`, `npm --prefix wiki run build` | Install and build the site; the build runs `check-wiki --site` first |

Checker options:

| Option | Effect |
|--------|--------|
| `--page <path>` | Check one page (repeatable; path relative to `wiki/`). Links to pages the run has not written yet (catalogue pages, section indexes, landing page, onboarding) are accepted |
| `--pending` | Whole-wiki run before the wiki is complete: accepts links to the landing page and onboarding pages before they exist, does not require the landing page, and skips the llms checks |
| `--catalogue-only` | Validate `catalogue.json` alone and print the real section and page counts |
| `--site` | Only what affects the rendered site: frontmatter, `{{ }}`, tags, Mermaid rules, links, placeholders, and the landing page. No catalogue, citation, threshold, or llms checks |
| `--report` | Print a `Section \| Pages \| Diagrams \| Cited files` table |
| `--json` | Machine-readable output (`errors`, `warnings`, `stats`, `pages`, `report`) |
| `--write-baseline <file>` / `--baseline <file>` | Save `git status` before a run; afterwards report files that appeared or changed |
| `--mode full\|crisp` | Override the recorded depth for one run. For one crisp page in a full wiki, use `depth: crisp` in that page's frontmatter instead |
| `--repo <path>`, `--repo-url <url>`, `--branch <name>` | Override the source root and citation link parsing |
| `--no-source` | Skip file and line verification when the source repository is not on disk |

Exit code 0 means no errors, 1 means errors, 2 means a bad command line or an unreadable input.

| Finding | Level | Meaning |
|---------|-------|---------|
| `frontmatter`, `title-length` | error | Missing, empty, unquoted-with-YAML-syntax, invalid-YAML-in-quotes, or multi-line `title`/`description`; a script artefact; title over 60 characters |
| `interpolation`, `bare-tag` | error | `{{ }}` or tag-shaped text outside code, in prose or frontmatter |
| `mermaid` | error | `<br/>`, `sequenceDiagram` without `autonumber`, bad hex length, light fill, empty diagram |
| `mermaid` | warn | `%%{init}%%`, more than 6 sequence participants |
| `mermaid-sources` | warn | Diagram not followed by `<!-- Sources: ... -->` |
| `citation` | error | Cited file not in the repository, wrong letter case, line past the end of the file |
| `threshold` | error | Page under the section 7 minimums |
| `link` | error | Broken relative link (inline or reference-style); folder link without a trailing slash; relative link that leaves the wiki; link to `README.md`, `AGENTS.md`, or `CLAUDE.md`; any other `link` finding not listed as a warning below |
| `link` | warn | In `--page` mode without a catalogue, a sibling page that is not written yet; a non-image file inside the wiki that the site will not publish |
| `anchor` | warn | `#anchor` with no matching heading |
| `table` | warn | More than 5 columns; unbreakable cell text over 60 characters |
| `catalogue` | error | Schema problem in `catalogue.json` (schema: `deep-wiki:wiki-architect`) |
| `catalogue-drift`, `missing`, `landing` | error | Catalogue page never written; requested page absent; no `wiki/index.md` |
| `catalogue-drift`, `section-index` | warn | Page, folder, or index not in the catalogue; section without `index.md` |
| `catalogue-prompt` | warn | A leaf prompt names a file or line that does not exist |
| `placeholder` | error | Unfilled `__NAME__` placeholder in the scaffold |
| `llms` | error / warn | Malformed link line, missing target, page absent from `llms-full.txt` / file over 5 KB |
| `baseline` | error / warn | Baseline missing or unreadable / `git status` failed |
| `leftover` | warn | File that appeared or changed in the repository during the run |

Fix every error at its source and rerun. Fix warnings unless there is a reason not to, and report the ones you left. Never edit a script to make a page pass. If nearly every citation is "not found", the source root is wrong: pass `--repo <path>`.

## 11. Dispatching Subagents

Run at most 5 subagents in parallel and wait for a batch before starting the next. Every prompt carries `REPO_URL`, `HOST`, and `BRANCH`, plus:

| Agent | Also give it |
|-------|--------------|
| `deep-wiki:wiki-architect` | The focus, if the user gave one, and any constraint the user stated (for example a page limit). Output is always `wiki/catalogue.json`. |
| `deep-wiki:wiki-writer` (page) | Depth; the output path as `wiki/<path>`; the leaf's `name` and `prompt`; the sibling list: every leaf path and name, each section's `index.md`, and the onboarding pages. Up to 3 leaves of one section may go to one writer. |
| `deep-wiki:wiki-writer` (onboarding guide) | Depth; the output path; the instruction to load `deep-wiki:wiki-onboarding` and write that guide; the sibling list. The dispatcher, not the writer, runs the hub generator afterwards. |
| `deep-wiki:wiki-writer` (repair) | The page path and the checker's lines for it, with the instruction to edit the existing page for those findings only. A page that was never written gets a page task again, not a repair. |
| `deep-wiki:wiki-researcher` | The research question. |

If these agent types are unavailable, do the same work yourself with the same skills, one page at a time.
