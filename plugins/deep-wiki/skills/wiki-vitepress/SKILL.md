---
name: wiki-vitepress
description: Use when generated wiki Markdown needs to become a browsable VitePress site - scaffolding or repairing wiki/package.json, .vitepress/config.mts, the dark theme, Mermaid rendering or click-to-zoom, the landing page, or fixing a VitePress build that fails on Mermaid, generics, dead links, or {{ }} text.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki VitePress Packager

Wrap the Markdown in `wiki/` in a dark-only VitePress site with dark Mermaid diagrams, click-to-zoom, and focus mode.

Load `deep-wiki:wiki-conventions` if it is not already loaded. It defines the repository context, the write modes, the output layout, and the scripts used here (section 10). Run every command from the repository root.

The templates live in this skill's `templates/` folder, next to this file. `<skill dir>` below is this skill's base directory.

## Step 1: Scaffold with `init-wiki.mjs`

Never copy template files or edit placeholders by hand. Do not read the template files; run the script.

```bash
node "<skill dir>/templates/scripts/init-wiki.mjs" wiki --title "<project name>" --description "<one specific sentence about the project>"
```

Which flags to pass (the command rules are in conventions section 10):

| Situation | Flags |
|-----------|-------|
| `wiki/.deep-wiki.json` exists (the bootstrap ran) | `--title` and `--description` only. Leave out `--depth`, `--host`, `--repo-url`, and `--branch`: the recorded values are used |
| No `wiki/.deep-wiki.json` | Add `--depth <full\|crisp> --host <HOST> --repo-url <REPO_URL\|none> --branch <BRANCH>` |
| `wiki/.vitepress/config.mts` exists and the write mode is `fill-missing` | Leave out `--title` and `--description` too; the existing config keeps its own |

| Option | When |
|--------|------|
| `--write-mode regenerate` | The calling workflow is in `regenerate` write mode, or the user asked to rebuild the scaffold. Replaces `package.json`, `.vitepress/**`, `.gitignore`, and the logo. Without it, existing scaffold files are kept. |
| `--base <repo-name>` | A GitHub project Pages site (the script adds the slashes; `--base root` means `/`). Omit it otherwise: the previous value is kept, and a new site gets `/`. Never pass a value starting with `/`. |
| `--scripts-only` | The bootstrap in conventions section 10: install `wiki/scripts/` and write `wiki/.deep-wiki.json`, nothing else. |
| `--package-name <name>` | Override the name in `wiki/package.json` (default: the repository folder name). |

What it does:

- Copies `package.json`, `.gitignore`, `.vitepress/config.mts`, `.vitepress/theme/`, `public/logo.svg`, and `scripts/*.mjs` into `wiki/`. `scripts/` is always refreshed.
- Fills every placeholder as a safe string literal. Values you omit come from the previous `config.mts` and state file, then from `catalogue.json` (`project`, `summary`).
- Keeps an existing `config.mts` in `fill-missing`: only a `--base`, `--repo-url`, or `--branch` you pass is patched into it. The title and description there are never changed.
- Writes `wiki/.deep-wiki.json` (`depth`, `host`, `repoUrl`, `branch`, `base`, `wikiDir`, `version`). The checker and the llms generator read it.
- Prints `wrote`, `replaced`, `kept`, or `updated` per file. Put those in your report. It never deletes anything.

To change one value later (for example the base path), run the installed copy with just that flag: `node wiki/scripts/init-wiki.mjs wiki --base <repo-name>`, then rerun `node wiki/scripts/gen-llms.mjs wiki` if `wiki/llms.txt` exists.

The sidebar is built at build time; you never edit it:

- Order: Home, Onboarding (expanded), every `NN-name/` folder (first three expanded), other folders such as `research/`, then a "More" group for other root pages such as `changelog.md`.
- A group's label is the section's `name` in `catalogue.json`, then the `title` of its `index.md` (if 60 characters or fewer), then the folder name in title case. The group heading links to the section's `index.md`.
- Pages follow catalogue order, then file name.

The config also fails the build on a broken link between wiki pages, and marks inline code `v-pre` so `{{ }}` inside backticks is safe.

## Step 2: Landing Page (`wiki/index.md`)

Write a developer-focused home page, not a marketing page. Do not use `layout: home`, `hero:`, `features:`, taglines, badges, or call-to-action buttons.

Required sections, in order:

1. **Frontmatter**: `title: "<Project> — Documentation"`, `description`.
2. **H1 and a 1–2 sentence technical summary.**
3. **Quick Start**: real, runnable commands taken from the repo (README, scripts, manifests).
4. **Architecture Overview**: one Mermaid diagram followed by `<!-- Sources: ... -->`.
5. **Documentation Map**: a table with `Section | Description` covering every section folder and `onboarding/`. Link each section to its `index.md` (`./02-architecture/index.md`); if a section has none (crisp), link its first page.
6. **Key Files**: a table with `File | Purpose | Source` (citations per conventions).
7. **Tech Stack**: a table with `Technology | Purpose`.

## Step 3: Generated Indexes and the Checker

1. Run `node wiki/scripts/gen-section-indexes.mjs wiki`. It writes each section's `index.md` from `catalogue.json` and `onboarding/index.md` from the guides that exist. Never write these by hand. Add `--force` in `regenerate` write mode.
2. If `wiki/llms.txt` exists, run `node wiki/scripts/gen-llms.mjs wiki`. The deployment copies in `wiki/public/` are written only once the site exists, so a wiki whose llms files predate the scaffold has none until this runs.
3. Run `node wiki/scripts/check-wiki.mjs wiki` and fix every error in the page it names, then rerun. Conventions section 10 lists the findings. When this skill runs on its own (`/deep-wiki:build`), fix what `--site` reports and only report the rest to the user.

## Step 4: Build (only when asked or when verifying)

```bash
npm --prefix wiki install
npm --prefix wiki run build
```

Requires Node 22.12 or newer (Mermaid 12). The build runs `check-wiki.mjs . --site` and then `vitepress build`; the output goes to `wiki/.vitepress/dist/`. Preview with `npm --prefix wiki run preview`, and look at a few diagrams: Mermaid syntax errors appear only in the browser. When the calling workflow says "no build" (crisp), skip this step and say so in the report.

`wiki/package.json` scripts: `dev`, `build`, `preview`, `check` (all checks), `indexes` (generated indexes), `llms` (llms files).

## Known Gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Invalid end tag` / `Element is missing end tag` | Tag-shaped text such as `<T>` outside code | Wrap it in backticks; the checker reports it as `bare-tag` |
| Build fails with `... is not defined` while rendering a page | `{{ }}` in prose is evaluated by Vue | Put the expression in backticks |
| YAML error in frontmatter | Unquoted `title` or `description` containing `: ` or `#`, or a backslash or quote inside double quotes | Double-quote both values; write `\\` and `\"`, or use single quotes |
| `Found dead link` fails the build | A relative link to a page that does not exist, a folder link (`./02-architecture`), or a link to a file outside `wiki/` | Link the page file (`index.md` for a section); do not set `ignoreDeadLinks: true` |
| Sidebar group shows a sentence | A hand-written section `index.md` with a bad `title` | `node wiki/scripts/gen-section-indexes.mjs wiki --force` |
| Tables or code spill into the right-hand outline | An old or edited `custom.css` | Rerun `init-wiki.mjs` with `--write-mode regenerate` |
| Diagram shows "Syntax error in text" | Invalid Mermaid; nothing checks syntax before the browser | Fix the diagram source |
| Preview shows old styles after a rebuild | `vitepress preview` caches `dist/` at start | Restart the preview |
| `logo.svg` or `llms.txt` 404 on the deployed site | Files in `.vitepress/public/` | VitePress serves `wiki/public/` |
| Broken assets on GitHub Pages | Wrong `base` | `node wiki/scripts/init-wiki.mjs wiki --base <repo-name>` |
| `npm install` fails with `ERESOLVE` on peer `mermaid@"10 \|\| 11"` | `vitepress-plugin-mermaid` predates Mermaid 12 | Keep the template's `overrides` entry in `wiki/package.json`. If it is gone, rerun `init-wiki.mjs` with `--write-mode regenerate`, which replaces the whole scaffold |
| A diagram shows as a code block | The fence was not opened with exactly ```` ```mermaid ```` | Fix the opening line |
| Diagrams re-laid out or restyled (ELK layout, "neo" look) | Mermaid 12 defaults | Keep `layout: 'dagre'` and `look: 'classic'` in the `mermaid` config |
| A light/dark toggle appears | `appearance: 'dark'` | Keep `appearance: 'force-dark'` |
