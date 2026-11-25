---
name: wiki-conventions
description: Use when running any deep-wiki skill, command, or agent and you need the shared rules - resolving the source repository and branch, citation link formats per git host, the dark-mode Mermaid palette, VitePress-safe Markdown, the wiki output layout, page quality thresholds, the bundled checker, and the overwrite and regenerate rules. Loaded by the other deep-wiki skills; not a user-facing task on its own.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Deep Wiki Conventions

The single source of truth for rules every deep-wiki skill, command, and agent shares. Other deep-wiki files reference this skill instead of restating these rules. When a task-specific skill disagrees with this file, this file wins.

## 1. Repository Context (resolve once, before any analysis)

Resolve these values once per run and pass them to every subagent you dispatch:

| Value | How to resolve |
|-------|----------------|
| `REPO_URL` | `git remote get-url origin`. Normalize Azure DevOps SSH remotes first: `git@ssh.dev.azure.com:v3/<org>/<project>/<repo>` → `https://dev.azure.com/<org>/<project>/_git/<repo>`, and `<org>@vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>` → `https://<org>.visualstudio.com/<project>/_git/<repo>`. Then the generic SSH form: `git@host:org/repo(.git)` → `https://host/org/repo`; strip a trailing `.git`; strip credentials (`https://user@host/...` → `https://host/...`). |
| `HOST` | `github`, `gitlab`, `azure-devops` (`dev.azure.com` or `*.visualstudio.com`), or `local` when there is no remote. |
| `BRANCH` | Default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (strip the `origin/` prefix). Fall back to `git rev-parse --abbrev-ref HEAD`. |

Rules:

- **Remote found** → use it. Do not ask the user to confirm.
- **No remote** → if you are the main session, ask once whether there is a source URL; otherwise treat the repo as `local`.
- **You are a subagent** → never ask the user. Use the `REPO_URL`, `HOST`, and `BRANCH` given in your prompt. If none were given, resolve them yourself with the commands above, and use `local` if that fails.
- An explicit URL or branch in the user's arguments overrides detection.

## 2. Citation Formats

Every non-trivial claim cites `file_path:line` (paths relative to the repo root, forward slashes).

| `HOST` | Single line | Line range |
|--------|-------------|------------|
| `github` | `[src/a.ts:42](REPO_URL/blob/BRANCH/src/a.ts#L42)` | `[src/a.ts:42-58](REPO_URL/blob/BRANCH/src/a.ts#L42-L58)` |
| `gitlab` | `[src/a.ts:42](REPO_URL/-/blob/BRANCH/src/a.ts#L42)` | `[src/a.ts:42-58](REPO_URL/-/blob/BRANCH/src/a.ts#L42-58)` |
| `azure-devops` | `[src/a.ts:42](REPO_URL?path=/src/a.ts&version=GBBRANCH&line=42&lineEnd=42&lineStartColumn=1&lineEndColumn=1)` | same, with `lineEnd=58` |
| `local` | `(src/a.ts:42)` | `(src/a.ts:42-58)` |

Special forms:

- **Approximate location**: `(src/a.ts:~ClassName)`, or the linked form without a line anchor.
- **Missing evidence**: `(Unknown – verify in path/to/check)`.
- **After every Mermaid diagram**: `<!-- Sources: src/a.ts:42, src/b.ts:10 -->`.
- **Above a quoted code snippet**: `<!-- Source: src/a.ts:42-58 -->`.
- **Tables listing code artifacts** (components, APIs, config keys) include a `Source` column.
- **Inside a table**, the link text is the file name and lines only, and the full path stays in the URL: `[a.ts:42-58](REPO_URL/blob/BRANCH/src/deep/path/a.ts#L42-L58)`. A full path in a cell is one unbreakable word and makes the table wider than the page.
- **Line numbers come from a file you opened**, never from a search hit or memory. A line past the end of the file fails the checker.
- **Commit links** (changelogs): GitHub/GitLab `REPO_URL/commit/SHA`; Azure DevOps `REPO_URL/commit/SHA`; local: plain short SHA.

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

- `<br>` in labels, never `<br/>` or `<br />`. This applies inside Mermaid blocks; in prose use a blank line instead of a break tag.
- No per-diagram `%%{init: ...}%%` line. The site applies the theme to every diagram; use inline `style` only for accents.
- Keep diagrams readable at page width: at most 6 participants in a `sequenceDiagram`, at most 8 nodes in one `LR` row (switch to `TD` or split the diagram).
- `autonumber` in every `sequenceDiagram`.
- Hex colors are 3 or 6 digits only.
- Pick the type by content: structure → `graph`/`flowchart`; behavior → `sequenceDiagram` or `stateDiagram-v2`; data → `erDiagram`; types → `classDiagram`; decisions → `flowchart`.
- No light-mode fills (`#fff…`, `#e…`, `#f…`). Replace them with the table above.

## 5. VitePress-Safe Markdown

- Every page starts with frontmatter containing `title` and `description` (add `outline: deep` for long pages).
- `title` is a name of at most 60 characters ("Dispatch Engine"), never a sentence. It becomes the sidebar label and the browser tab title. The sentence goes in `description`.
- `{{` and `}}` (GitHub Actions expressions, Jinja, Helm, Vue, Handlebars) appear only inside backticks or a code fence, never in plain prose, headings, or table text. Vue evaluates them anywhere else and the build fails.
- Tables have at most 5 columns. Split a wider table, or fold two columns into one.
- A link to a numbered heading uses the VitePress slug, which prefixes a leading digit with `_`: `## 7. Limits` is `#_7-limits`.
- Wrap generics and anything shaped like an HTML tag outside code fences in backticks: `` `List<T>` ``, `` `Task<string>` ``.
- Standard Markdown only; VitePress containers (`::: tip`) are allowed, custom shortcodes are not.
- Cross-page links are relative `.md` links: `[Auth](../02-architecture/auth.md#token-refresh)`. End each page with a `## Related Pages` table (`Page`, `Relationship`).

## 6. Output Layout

All generated documentation lives under `wiki/` at the repo root (the VitePress `srcDir`):

```text
wiki/
├── catalogue.json            # Table of contents from wiki-architect
├── index.md                  # Developer-focused landing page (no hero)
├── onboarding/               # index.md + audience guides
├── NN-section-name/          # Numbered sections, e.g. 01-getting-started/
│   ├── index.md              # Written by scripts/gen-section-indexes.mjs, never by hand
│   └── page-name.md
├── changelog.md              # Optional, from wiki-changelog
├── llms.txt / llms-full.txt  # From wiki-llms-txt
├── public/                   # Static assets served at the site root (logo.svg, llms*.txt)
├── AGENTS.md / CLAUDE.md     # Only if missing (section 8)
├── package.json
├── scripts/                  # check-wiki.mjs, gen-section-indexes.mjs (not part of the site)
└── .vitepress/               # config.mts, theme/
```

Static files go in `wiki/public/`, never `wiki/.vitepress/public/`. VitePress serves `<srcDir>/public`.

## 7. Quality Thresholds

| Mode | Mermaid diagrams per page | Diagram types | Distinct source files cited |
|------|---------------------------|---------------|-----------------------------|
| Full (`generate`, `page`) | ≥ 3 (small scope), ≥ 4 (medium), ≥ 5 (large) | ≥ 2 | ≥ 5 |
| Crisp (`crisp`) | 1–2 | any | ≥ 3 |
| Onboarding guides | see `wiki-onboarding` | ≥ 2 | ≥ 5 (none for executive/PM code) |

The numbers in this table are enforced by `wiki/scripts/check-wiki.mjs` (section 10). A page passes when the checker says so, not when its author believes it does.

## 8. Ownership, the Generated-File Marker, and Overwrite Rules

Files deep-wiki creates outside page content (`llms.txt`, `llms-full.txt`, `AGENTS.md`, `CLAUDE.md`) and the section `index.md` files carry `<!-- generated by deep-wiki -->` on the line after the H1 (or as the first line if there is no H1).

What a run may replace depends on its write mode. Single-skill runs (`/deep-wiki:page`, `/deep-wiki:llms`, and so on) follow the `fill-missing` column unless the user asks to replace a file.

| Path | `fill-missing` | `regenerate` |
|------|----------------|--------------|
| `wiki/catalogue.json`, catalogue pages, onboarding guides, `wiki/index.md` | Write only if missing | Replace |
| Section `index.md` | Write if missing or marked | Replace (`--force`) |
| Scaffold: `wiki/package.json`, `wiki/.vitepress/**`, `wiki/scripts/**`, `wiki/.gitignore` | Write only if missing | Replace, then refill the placeholders |
| `wiki/llms*.txt`, `wiki/public/llms*.txt` | Replace if marked | Replace |
| `NN-*/` folders and pages no longer in the catalogue | Leave | Delete, after listing them to the user |
| Root `llms.txt` / `llms-full.txt` without the marker | Skip | Ask |
| Any `AGENTS.md` / `CLAUDE.md` that already exists | Skip | Ask |

- The last two rows may be the user's own files. In `regenerate` mode, list the ones that exist and ask once, before writing anything: replace them or keep them. Never decide silently, and never replace them in `fill-missing` mode.
- Report every skipped, replaced, and deleted file in the run summary.

## 9. Read-Only Source Repository

Generating documentation never changes or runs the project it documents.

- Do not run the project's tests, builds, installers, linters, or scripts. Take commands and expected output from the repository's files (README, manifests, CI workflows, test sources).
- Create no file outside `wiki/` and the documented outputs (root `llms*.txt`, `AGENTS.md`, `CLAUDE.md`, the deploy workflow). No scratch files, logs, or test results.
- A subagent writes only the file(s) it was assigned.

## 10. The Checker

`wiki/scripts/check-wiki.mjs` and `wiki/scripts/gen-section-indexes.mjs` are copied in with the site scaffold (see `deep-wiki:wiki-vitepress`). They need only Node.

| Command (run from `wiki/`) | Use |
|----------------------------|-----|
| `node scripts/check-wiki.mjs . --catalogue-only` | Validate `catalogue.json` and print the real section and page counts |
| `node scripts/check-wiki.mjs . --page <path>` | Check one page while siblings are still being written (links to catalogue pages not yet on disk are accepted) |
| `node scripts/check-wiki.mjs .` | Check the whole wiki; add `--mode crisp` for crisp thresholds |
| `node scripts/gen-section-indexes.mjs .` | Write every section `index.md` from the catalogue and the pages' frontmatter |

The checker reports errors (exit code 1) and warnings.

- **Errors**: missing or over-long titles, script artefacts such as `undefined` in frontmatter, `{{ }}` or tag-shaped text outside code, Mermaid rule breaks, broken relative links, cited files or line ranges that do not exist, pages under the section 7 thresholds, catalogue pages never written, malformed `llms.txt` lines.
- **Warnings**: wide tables, long unbreakable cell text, `#anchor` links with no matching heading, pages or folders missing from the catalogue, `llms.txt` over 5 KB, files left behind in the repository.

Fix every error at its source and rerun until none remain. Fix warnings unless there is a reason not to, and report the ones you left. Never edit the checker to make a page pass.

## 11. Dispatching Subagents

When a deep-wiki workflow delegates to `deep-wiki:wiki-architect`, `deep-wiki:wiki-writer`, or `deep-wiki:wiki-researcher`, the prompt must contain:

1. `REPO_URL`, `HOST`, `BRANCH`.
2. The exact output file path(s) to write.
3. The mode (`full` or `crisp`) and the task (catalogue node, page topic, or research question).
4. The list of sibling pages (paths and titles) so cross-links resolve. Include each section's `index.md` and the onboarding guides, not only catalogue leaves.

Run at most 5 writers in parallel; wait for a batch before starting the next.
