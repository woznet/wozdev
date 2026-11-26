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

Two terms are used throughout:

- **Depth**: `full` (default) or `crisp`. It sets the thresholds in section 7 and is recorded in `wiki/.deep-wiki.json`.
- **Write mode**: `fill-missing` (default) or `regenerate`. It sets what may be replaced (section 8).

## 1. Repository Context (resolve once, before any analysis)

Resolve these values once per run and pass them to every subagent you dispatch:

| Value | How to resolve |
|-------|----------------|
| `REPO_URL` | `git remote get-url origin`. Normalize Azure DevOps SSH remotes first: `git@ssh.dev.azure.com:v3/<org>/<project>/<repo>` → `https://dev.azure.com/<org>/<project>/_git/<repo>`, and `<org>@vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>` → `https://<org>.visualstudio.com/<project>/_git/<repo>`. Then the generic SSH form: `git@host:org/repo(.git)` → `https://host/org/repo`; strip a trailing `.git`; strip credentials (`https://user@host/...` → `https://host/...`). |
| `HOST` | `github` (github.com or a GitHub Enterprise server), `gitlab` (gitlab.com or a self-hosted GitLab), `azure-devops` (`dev.azure.com` or `*.visualstudio.com`), otherwise `local`. Bitbucket, Gitea, any other host, and a repo with no remote are all `local`. |
| `BRANCH` | Default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (strip the `origin/` prefix). Fall back to `git rev-parse --abbrev-ref HEAD`. |

Rules:

- **Remote found** → use it. Do not ask the user to confirm.
- **No remote** → if you are the main session, ask once whether there is a source URL; otherwise treat the repo as `local`.
- **You are a subagent** → never ask the user. Use the values given in your prompt. If none were given, read `wiki/.deep-wiki.json`, then resolve them yourself with the commands above, and use `local` if that fails.
- An explicit URL or branch in the user's arguments overrides detection.
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

- **Approximate location**: `(src/a.ts:~ClassName)`, or the linked form without a line anchor.
- **Missing evidence**: `(Unknown – verify in path/to/check)`.
- **After every Mermaid diagram**: `<!-- Sources: src/a.ts:42, src/b.ts:10 -->` on one line. These are checked like any other citation.
- **Above a quoted code snippet**: `<!-- Source: src/a.ts:42-58 -->`.
- **Tables listing code artifacts** (components, APIs, config keys) include a `Source` column.
- **Inside a table**, a linked citation shows the file name and lines only, with the full path in the URL: `[a.ts:42-58](REPO_URL/blob/BRANCH/src/deep/path/a.ts#L42-L58)`. A full path in a cell is one unbreakable word. `local` citations have no URL, so they keep the full path everywhere.
- **Line numbers come from a file you opened**, never from a search hit or memory. A line past the end of the file is a checker error.
- **Never link to a source file with a relative path** (`../../src/a.ts`). The site build reports it as a dead link.
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

- `<br>` in labels, never `<br/>` or `<br />`.
- `autonumber` in every `sequenceDiagram`.
- Hex colors are 3 or 6 digits only. No light fills (light hex values or names such as `white`): use the table above.
- No per-diagram `%%{init: ...}%%` line. The site applies the theme to every diagram.
- Keep diagrams readable at page width: at most 6 participants in a `sequenceDiagram`, at most 8 nodes in one `LR` row (switch to `TD` or split the diagram).
- Pick the type by content: structure → `graph`/`flowchart`; behavior → `sequenceDiagram` or `stateDiagram-v2`; data → `erDiagram`; types → `classDiagram`; decisions → `flowchart`.
- Only draw what the code has. A repo without persistent data gets no `erDiagram`.

Diagrams render in the browser. Neither the checker nor the build parses Mermaid syntax, so a syntax error shows only in `npm --prefix wiki run dev` or the built site. Balance every bracket and quote, and quote labels that contain punctuation.

## 5. VitePress-Safe Markdown

- Every page starts with frontmatter containing `title` and `description`, each on one line in double quotes: `title: "CLI: Commands"`. Add `outline: deep` for long pages.
- `title` is a name of at most 60 characters ("Dispatch Engine"), never a sentence. It becomes the sidebar label and the browser tab title. The sentence goes in `description`.
- Wrap generics and anything shaped like an HTML tag in backticks wherever it is not in a code fence, frontmatter included: `` `List<T>` ``, `` `Task<string>` ``.
- `{{` and `}}` (GitHub Actions expressions, Jinja, Helm, Vue, Handlebars) appear only inside backticks or a code fence. Vue evaluates them anywhere else and the build fails.
- Tables have at most 5 columns. Split a wider table, or fold two columns into one.
- Standard Markdown only; VitePress containers (`::: tip`) are allowed, custom shortcodes are not.
- Cross-page links are relative `.md` links to a file: `[Auth](../02-architecture/auth.md#token-refresh)`, `[Architecture](./02-architecture/index.md)`.
- A link to a numbered heading uses the VitePress slug, which prefixes a leading digit with `_`: `## 7. Limits` is `#_7-limits`.
- Catalogue pages end with a `## Related Pages` table (`Page`, `Relationship`).

## 6. Output Layout

All generated documentation lives under `wiki/` at the repository root (the VitePress `srcDir`):

```text
wiki/
├── .deep-wiki.json           # Run state: depth, host, repoUrl, branch, base, wikiDir, version
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

Static files go in `wiki/public/`, never `wiki/.vitepress/public/`.

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

Section indexes, the landing page, `research/`, and `changelog.md` have no minimums.

Size a full-depth catalogue page by the number of source files it covers. The checker enforces only the row above; the larger budgets are yours to meet.

| Scope | Relevant files | Words | Diagrams |
|-------|----------------|-------|----------|
| Small | ≤ 50 | 2,000–3,000 | 3 |
| Medium | 50–300 | 3,000–5,000 | 4 |
| Large | > 300 (sample entry points, domain models, data access, integration edges) | 5,000–8,000 | 5–8 |

A crisp page is 600–1,500 words with 1–2 diagrams.

## 8. Ownership and Write Modes

Files deep-wiki generates outside page content (`llms.txt`, `llms-full.txt`, `AGENTS.md`, `CLAUDE.md`, section `index.md`, `onboarding/index.md`, `changelog.md`) carry `<!-- generated by deep-wiki -->` on the line after the H1 (or as the first line if there is no H1). A file with the marker is "marked".

| Path | `fill-missing` | `regenerate` |
|------|----------------|--------------|
| `wiki/scripts/**`, `wiki/.deep-wiki.json` | Always refreshed | Always refreshed |
| `wiki/catalogue.json`, catalogue pages, onboarding guides, `wiki/index.md` | Write only if missing | Replace |
| Section `index.md`, `onboarding/index.md` | Write if missing or marked | Replace |
| `wiki/llms*.txt`, `wiki/public/llms*.txt` | Replace | Replace |
| Scaffold: `wiki/package.json`, `wiki/.vitepress/**`, `wiki/.gitignore`, `wiki/public/logo.svg` | Write only if missing | Replace (`base` and other recorded values are kept) |
| `wiki/changelog.md`, `wiki/research/*.md` | Write if missing or (changelog) marked | Same; a generate run never touches them |
| Root `llms.txt` | Replace if marked, else skip | Same |
| `AGENTS.md` / `CLAUDE.md` | Write only if missing | Replace if marked; unmarked: see below |
| `NN-*/` folders and pages no longer in the catalogue | Leave | Delete after confirmation |

Rules:

- **A named target is a request to replace it.** `/deep-wiki:page <topic>`, `/deep-wiki:onboard <guide>`, and `/deep-wiki:catalogue` replace the page, guide, or catalogue they name, in any write mode. Everything else those commands touch follows `fill-missing`.
- **Unmarked `AGENTS.md` / `CLAUDE.md` are the user's.** Keep them. Only when the user chose `regenerate` on an existing wiki, list them in that same question and ask whether to replace or keep them.
- **Deleting needs a list and a yes.** Before deleting anything, show the exact paths and ask. Delete stale sections and pages only after their replacements are written. A run narrowed by a focus argument never deletes.
- **`fill-missing` does not rewrite existing pages.** Checker errors in pages that existed before the run are reported, not fixed, unless the user agrees.
- Report every skipped, replaced, and deleted file in the run summary.

## 9. Read-Only Source Repository

Generating documentation never changes or runs the project it documents.

- Do not run the project's tests, builds, installers, linters, or scripts. Take commands and expected output from the repository's files (README, manifests, CI workflows, test sources).
- Create no file outside `wiki/` and the documented outputs (root `llms.txt`, `AGENTS.md`, `CLAUDE.md`, the deploy workflow). No scratch files, logs, or test results.
- A subagent writes only the file(s) it was assigned.

## 10. Scripts and the Checker

The scripts need only Node 22.12 or newer, no `npm install`. `init-wiki.mjs` copies them from the `deep-wiki:wiki-vitepress` skill's `templates/scripts/` folder into `wiki/scripts/`.

Run every command from the repository root, in this form. Do not `cd` into `wiki/`. Commands are written for a POSIX-style shell; the scripts themselves run on any platform. Never redirect command output into a file the scripts will read; use the flags below.

| Command | Use |
|---------|-----|
| `node <vitepress skill dir>/templates/scripts/init-wiki.mjs wiki --scripts-only --depth <full\|crisp> --host <HOST> --repo-url <REPO_URL> --branch <BRANCH>` | Install or refresh the scripts and write `wiki/.deep-wiki.json`, before any page exists |
| `node <vitepress skill dir>/templates/scripts/init-wiki.mjs wiki --title "<name>" --description "<sentence>" [--write-mode regenerate]` | Write the site scaffold with every placeholder filled (see `deep-wiki:wiki-vitepress`) |
| `node wiki/scripts/gen-section-indexes.mjs wiki [--force] [--prune]` | Write every section `index.md` and `onboarding/index.md`. `--force` replaces unmarked ones; `--prune` deletes marked indexes whose folder left the catalogue |
| `node wiki/scripts/gen-llms.mjs wiki [--input <file.json>]` | Write the five llms files (see `deep-wiki:wiki-llms-txt`) |
| `node wiki/scripts/check-wiki.mjs wiki` | Check the whole wiki at the recorded depth |
| `npm --prefix wiki install`, `npm --prefix wiki run build` | Install and build the site; the build runs `check-wiki --site` first |

Checker options:

| Option | Effect |
|--------|--------|
| `--page <path>` | Check one page (repeatable; path relative to `wiki/`). Links to pages the run has not written yet (catalogue pages, section indexes, landing page, onboarding) are accepted |
| `--pending` | Whole-wiki run that accepts links to the landing page and onboarding pages before they exist, and does not require the landing page |
| `--catalogue-only` | Validate `catalogue.json` alone and print the real section and page counts |
| `--site` | Only what affects the rendered site: frontmatter, `{{ }}`, tags, Mermaid rules, links, placeholders |
| `--report` | Print a `Section \| Pages \| Diagrams \| Cited files` table |
| `--json` | Machine-readable output (`errors`, `warnings`, `stats`, `pages`, `report`) |
| `--write-baseline <file>` / `--baseline <file>` | Save `git status` before a run; afterwards report files that appeared or changed |
| `--mode full\|crisp` | Override the recorded depth, for example one crisp page in a full wiki |
| `--repo <path>`, `--repo-url <url>`, `--branch <name>` | Override the source root and citation link parsing |
| `--no-source` | Skip file and line verification when the source repository is not on disk |

Exit code 0 means no errors, 1 means errors, 2 means a bad command line or an unreadable input.

| Finding | Level | Meaning |
|---------|-------|---------|
| `frontmatter`, `title-length` | error | Missing, empty, unquoted-with-YAML-syntax, or multi-line `title`/`description`; a script artefact; title over 60 characters |
| `interpolation`, `bare-tag` | error | `{{ }}` or tag-shaped text outside code, in prose or frontmatter |
| `mermaid` | error | `<br/>`, `sequenceDiagram` without `autonumber`, bad hex length, light fill, empty diagram |
| `mermaid` | warn | `%%{init}%%`, more than 6 sequence participants |
| `mermaid-sources` | warn | Diagram not followed by `<!-- Sources: ... -->` |
| `citation` | error | Cited file not in the repository, wrong letter case, line past the end of the file |
| `threshold` | error | Page under the section 7 minimums |
| `link` | error | Broken relative link; relative link that leaves the wiki |
| `link`, `anchor` | warn | Missing asset outside the site; `#anchor` with no matching heading |
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

Run at most 5 subagents in parallel and wait for a batch before starting the next. Every prompt carries `REPO_URL`, `HOST`, `BRANCH`, and the write mode, plus:

| Agent | Also give it |
|-------|--------------|
| `deep-wiki:wiki-architect` | The focus, if the user gave one. Output is always `wiki/catalogue.json`. |
| `deep-wiki:wiki-writer` (page) | Depth; the output path as `wiki/<path>`; the leaf's `name` and `prompt`; the sibling list: every leaf path and name, each section's `index.md`, and the onboarding pages. Up to 3 leaves of one section may go to one writer. |
| `deep-wiki:wiki-writer` (onboarding guide) | Depth; the output path; the instruction to load `deep-wiki:wiki-onboarding` and write that guide; the sibling list. |
| `deep-wiki:wiki-writer` (repair) | The page path and the checker's lines for it, with the instruction to edit the existing page for those findings only. |
| `deep-wiki:wiki-researcher` | The research question. |

If these agent types are unavailable, do the same work yourself with the same skills, one page at a time.
