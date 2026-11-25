---
name: wiki-vitepress
description: Use when generated wiki Markdown needs to become a browsable VitePress site - scaffolding or repairing wiki/package.json, .vitepress/config.mts, the dark theme, Mermaid rendering or click-to-zoom, the landing page, or fixing a VitePress build that fails on Mermaid, generics, or <br/> tags.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.1.0"
---

# Wiki VitePress Packager

Wrap the Markdown in `wiki/` in a dark-only VitePress site with dark Mermaid diagrams, click-to-zoom, and focus mode.

**First load `deep-wiki:wiki-conventions`.** It defines the repo context, palette, and output layout used here.

## Step 1: Copy the Templates

The templates live in this skill's `templates/` folder (next to this file). Copy them into `wiki/`, creating missing files only. **Never overwrite a file that already exists** unless the user asked you to rebuild the scaffold.

| Template | Destination |
|----------|-------------|
| `templates/package.json` | `wiki/package.json` |
| `templates/gitignore` | `wiki/.gitignore` |
| `templates/.vitepress/config.mts` | `wiki/.vitepress/config.mts` |
| `templates/.vitepress/theme/index.ts` | `wiki/.vitepress/theme/index.ts` |
| `templates/.vitepress/theme/custom.css` | `wiki/.vitepress/theme/custom.css` |
| `templates/public/logo.svg` | `wiki/public/logo.svg` |

Then fill in the placeholders:

| Placeholder | File | Value |
|-------------|------|-------|
| `__PACKAGE_NAME__` | `package.json` | Repo name, lowercase kebab-case |
| `__SITE_TITLE__` | `config.mts` | Project name |
| `__SITE_DESCRIPTION__` | `config.mts` | One specific sentence about the project |
| `__BASE__` | `config.mts` | `'/'` for a user/org Pages site (`<owner>.github.io`) or custom domain; `'/<repo-name>/'` for a GitHub project Pages site; `'/'` when not deploying |
| `__REPO_URL__` | `config.mts` | `REPO_URL`, or `''` when `HOST` is `local` |
| `__BRANCH__` | `config.mts` | `BRANCH` |

`config.mts` builds the sidebar at build time: Onboarding first (expanded), then every `NN-name/` folder in order, with the first three expanded. You don't edit the sidebar by hand.

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

## Step 3: Post-Process the Markdown

Before building, fix every `wiki/**/*.md` (skip `node_modules/`, `.vitepress/`, `dist/`):

| Problem | Fix |
|---------|-----|
| Missing frontmatter | Add `title` and `description` |
| `<br/>` or `<br />` in Mermaid | Replace with `<br>` |
| Bare generics (`List<T>`, `Task<string>`) outside code fences | Wrap in backticks |
| Light-mode Mermaid fills (`#fff…`, `#f…`, `#e…`) | Map to the dark palette (node `#2d333b`, cluster `#161b22`) and add `,color:#e6edf3` |
| 4- or 5-digit hex colors in Mermaid | Expand to 6 digits |
| `flowchart`/`graph` blocks with unbalanced brackets or quotes | Fix the syntax |

## Step 4: Build (only when asked or when verifying)

```bash
cd wiki && npm install && npm run build
```

The output goes to `wiki/.vitepress/dist/`. Preview it with `npm run preview`. When the calling workflow says "no build" (crisp mode), skip this step and say so in the report.

## Known Gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| `document is not defined` during build | DOM code in `enhanceApp()` | Keep DOM code in `setup()` hooks (the template does) |
| Zoom never attaches | Mermaid renders after `onMounted` | The template polls for SVGs for 5 s after mount and after each route change |
| Accent colors replaced by default blue | CSS overrides with `!important` | The template CSS skips elements with an inline `style` |
| `Invalid end tag` / `Element is missing end tag` | Bare `<T>` or `<br/>` in Markdown | Step 3 |
| `logo.svg` or `llms.txt` 404 on the deployed site | Files in `.vitepress/public/` | VitePress serves `wiki/public/` |
| A light/dark toggle appears | `appearance: 'dark'` | Use `appearance: 'force-dark'` |
| Broken assets on GitHub Pages | Wrong `base` | `'/<repo-name>/'` for project sites |
| `isCustomElement` used to silence generics | Breaks rendering of real components | Escape generics instead |
