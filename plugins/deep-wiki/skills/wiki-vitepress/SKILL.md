---
name: wiki-vitepress
description: Use when generated wiki Markdown needs to become a browsable VitePress site - scaffolding or repairing wiki/package.json, .vitepress/config.mts, the dark theme, Mermaid rendering or click-to-zoom, the landing page, or fixing a VitePress build that fails on Mermaid, generics, or <br/> tags.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki VitePress Packager

Wrap the Markdown in `wiki/` in a dark-only VitePress site with dark Mermaid diagrams, click-to-zoom, and focus mode.

**First load `deep-wiki:wiki-conventions`.** It defines the repo context, palette, and output layout used here.

## Step 1: Copy the Templates

The templates live in this skill's `templates/` folder (next to this file). Copy them into `wiki/`, creating missing files only. Replace existing scaffold files only when the user asked you to rebuild the scaffold or the calling workflow is in `regenerate` mode (conventions section 8); the `scripts/` files are always safe to refresh.

| Template | Destination |
|----------|-------------|
| `templates/package.json` | `wiki/package.json` |
| `templates/gitignore` | `wiki/.gitignore` |
| `templates/.vitepress/config.mts` | `wiki/.vitepress/config.mts` |
| `templates/.vitepress/theme/index.ts` | `wiki/.vitepress/theme/index.ts` |
| `templates/.vitepress/theme/custom.css` | `wiki/.vitepress/theme/custom.css` |
| `templates/public/logo.svg` | `wiki/public/logo.svg` |
| `templates/scripts/*.mjs` | `wiki/scripts/` (`lib.mjs`, `check-wiki.mjs`, `gen-section-indexes.mjs`) |

Then fill in the placeholders. Each one already sits inside quotes in the template, so replace only the `__NAME__` text and keep the quotes around it:

| Placeholder | File | Value |
|-------------|------|-------|
| `__PACKAGE_NAME__` | `package.json` | Repo name, lowercase kebab-case |
| `__SITE_TITLE__` | `config.mts` | Project name |
| `__SITE_DESCRIPTION__` | `config.mts` | One specific sentence about the project |
| `__BASE__` | `config.mts` | `/` for a user/org Pages site (`<owner>.github.io`) or custom domain; `/<repo-name>/` for a GitHub project Pages site; `/` when not deploying |
| `__REPO_URL__` | `config.mts` | `REPO_URL`, or nothing (an empty string) when `HOST` is `local` |
| `__BRANCH__` | `config.mts` | `BRANCH` |

`config.mts` builds the sidebar at build time: Onboarding first (expanded), then every `NN-name/` folder in order, with the first three expanded. You don't edit the sidebar by hand.

- A group's label is the section's `name` in `catalogue.json`, then the `title` of its `index.md` (if 60 characters or fewer), then the folder name in title case.
- A group heading links to the section's `index.md`; the index is not repeated as a child item.
- Pages follow catalogue order, then file name.

The config also fails the build on a broken link between wiki pages, and marks inline code `v-pre` so `{{ }}` inside backticks is safe.

If the wiki is not in `wiki/`, update `WIKI_DIR` in `config.mts`.

## Step 2: Landing Page (`wiki/index.md`)

Write a developer-focused home page, not a marketing page. Do not use `layout: home`, `hero:`, `features:`, taglines, badges, or call-to-action buttons.

Required sections, in order:

1. **Frontmatter**: `title: <Project> — Documentation`, `description`.
2. **H1 and a 1–2 sentence technical summary.**
3. **Quick Start**: real, runnable commands taken from the repo (README, scripts, manifests).
4. **Architecture Overview**: one Mermaid diagram followed by `<!-- Sources: ... -->`.
5. **Documentation Map**: a table with `Section | Description` covering every section folder and `onboarding/`. Link each section to its `index.md` when one exists (`./02-architecture/`); otherwise link its first page (`./02-architecture/overview.md`). Never link a folder that has no `index.md`; that route 404s.
6. **Key Files**: a table with `File | Purpose | Source` (citations per conventions).
7. **Tech Stack**: a table with `Technology | Purpose`.

## Step 3: Section Indexes and the Checker

1. If `wiki/catalogue.json` exists, run `node wiki/scripts/gen-section-indexes.mjs wiki`. It writes each section's `index.md` (title = the section name, plus a table of its pages). Never write these by hand. It skips an `index.md` without the deep-wiki marker unless you pass `--force`.
2. Run `node wiki/scripts/check-wiki.mjs wiki` (add `--mode crisp` for a crisp wiki) and fix every error in the page it names, then rerun. Conventions section 10 lists what it checks.

Common fixes:

| Problem | Fix |
|---------|-----|
| Missing frontmatter | Add `title` and `description` |
| Title over 60 characters, or ending in `undefined` | Use the page or section name; move the sentence to `description` |
| `{{ }}` outside code | Wrap the expression in backticks |
| Table over 5 columns, or a long unbreakable cell | Split the table; cite `file.ext:lines` as the link text |
| Broken relative link | Point it at a page that exists, or remove it |
| `<br/>` or `<br />` in Mermaid | Replace with `<br>` |
| Bare generics (`List<T>`, `Task<string>`) outside code fences | Wrap in backticks |
| Light-mode Mermaid fills (`#fff…`, `#f…`, `#e…`) | Map to the dark palette (node `#2d333b`, cluster `#161b22`) and add `,color:#e6edf3` |
| 4- or 5-digit hex colors in Mermaid | Expand to 6 digits |
| `flowchart`/`graph` blocks with unbalanced brackets or quotes | Fix the syntax |

## Step 4: Build (only when asked or when verifying)

```bash
cd wiki && npm install && npm run build
```

Requires Node 22.12 or newer (Mermaid 12). `npm run build` runs the checker's site checks (`check-wiki.mjs . --site`: frontmatter, `{{ }}`, tags, Mermaid rules, links) and then `vitepress build`; `npm run check` runs every check. The output goes to `wiki/.vitepress/dist/`. Preview it with `npm run preview`. When the calling workflow says "no build" (crisp mode), skip this step and say so in the report.

## Known Gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| `document is not defined` during build | DOM code in `enhanceApp()` | Keep DOM code in `setup()` hooks (the template does) |
| Zoom never attaches | Mermaid renders after `onMounted` | The template polls for SVGs for 5 s after mount and after each route change |
| Accent colors replaced by default blue | CSS overrides with `!important` | The template CSS skips elements with an inline `style` |
| `Invalid end tag` / `Element is missing end tag` | Bare `<T>` or `<br/>` in Markdown | Step 3 |
| Build fails with `... is not defined` or `Cannot read properties of undefined` while rendering a page | `{{ }}` in prose is evaluated by Vue | Put the expression in backticks (the template makes inline code `v-pre`) |
| Sidebar group shows a sentence, or text ending in `undefined` | A hand-written section `index.md` with a bad `title` | Run `gen-section-indexes.mjs --force`; keep the template `config.mts` |
| Tables or code spill into the right-hand outline | `display: table` on `.vp-doc table`, or an old `custom.css` | Use the template CSS (tables are `display: block; overflow-x: auto`) |
| `Found dead link` fails the build | A relative link to a page that does not exist | Fix the link; do not set `ignoreDeadLinks: true` |
| Preview shows old styles after a rebuild | `vitepress preview` caches `dist/` at start | Restart the preview |
| `logo.svg` or `llms.txt` 404 on the deployed site | Files in `.vitepress/public/` | VitePress serves `wiki/public/` |
| A light/dark toggle appears | `appearance: 'dark'` | Use `appearance: 'force-dark'` |
| Broken assets on GitHub Pages | Wrong `base` | `'/<repo-name>/'` for project sites |
| `isCustomElement` used to silence generics | Breaks rendering of real components | Escape generics instead |
| `npm install` fails with `ERESOLVE` on peer `mermaid@"10 \|\| 11"` | `vitepress-plugin-mermaid` predates Mermaid 12 | Keep the template's `overrides` entry in `wiki/package.json` |
| Diagrams re-laid out or restyled (ELK layout, "neo" look) | Mermaid 12 defaults | Keep `layout: 'dagre'` and `look: 'classic'` in the `mermaid` config |
