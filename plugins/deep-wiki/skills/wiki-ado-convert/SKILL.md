---
name: wiki-ado-convert
description: Use when a VitePress or GFM wiki must be published as an Azure DevOps (ADO) Wiki, or when Mermaid diagrams, front matter, VitePress containers, or relative links render wrong in Azure DevOps.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.1.0"
---

# ADO Wiki Converter

Install a tested, zero-dependency Node.js script that writes Azure DevOps-compatible copies of the wiki. Source files are never modified.

**First load `deep-wiki:wiki-conventions`** for the wiki layout.

## Procedure

1. **Locate the wiki.** Use `wiki/` (or the folder the user names). Stop if it has no `.md` files.
2. **Install the script.** Copy `scripts/build-ado-wiki.mjs` from this skill's folder to `wiki/scripts/build-ado-wiki.mjs`. Overwrite only if the existing file is an older copy of this script.
3. **Wire npm.** Add `"build:ado": "node scripts/build-ado-wiki.mjs ."` to `scripts` in `wiki/package.json` if it isn't there. Make sure `wiki/.gitignore` contains `dist/`.
4. **Run it.** `cd wiki && node scripts/build-ado-wiki.mjs .`. Always pass the wiki folder (`.` when run from it) as the source: without it, the script guesses the source from `index.md`, and a wiki with no `index.md` resolves to `wiki/wiki` and fails. Output goes to `wiki/dist/ado-wiki/`; the script prints a table of transformation counts.
5. **Verify.** All of these must hold:
   - No ```` ```mermaid ```` fences remain: `grep -rc '```mermaid' wiki/dist/ado-wiki --include=*.md | grep -v ':0$'` prints nothing.
   - No Mermaid block starts with `flowchart`.
   - No file begins with a `---` front-matter block.
   - Cross-page links such as `../02-architecture/overview.md` are still links.
   - `index.md` exists at the output root and is a real landing page.
   - Every folder has a `.order` file.
6. **Report** the counts and how to publish: in Azure DevOps choose **Wiki → Publish code as wiki**, pick the repo and branch, and set the folder to `wiki/dist/ado-wiki` (commit it on a publishing branch, or publish from a pipeline that runs `npm run build:ado`).

The script also takes explicit paths: `node build-ado-wiki.mjs <sourceDir> [outDir]`. It refuses an output folder that would overwrite the source.

## What the Script Changes

| Issue | VitePress/GFM | ADO Wiki | Transform |
|-------|---------------|----------|-----------|
| Mermaid fences | ```` ```mermaid ```` … ```` ``` ```` | `::: mermaid` … `:::` | Convert fences |
| `flowchart` keyword | `flowchart LR` | `graph LR` | Rename (bare `flowchart` → `graph TD`) |
| `<br>` in Mermaid labels | `A[One<br>Two]` | Breaks the diagram | Replace with a space |
| Long arrows | `---->` | Not supported | → `-->` |
| YAML front matter | `---` … `---` | Shown as raw text | Strip |
| Links leaving the wiki | `[file](../../src/a.cs)` | Dead link | Keep the text, drop the link |
| Links inside the wiki | `[Auth](../02-architecture/auth.md)` | Works | Kept |
| VitePress containers | `::: warning Title` | Not supported | `> [!WARNING]` blockquote |
| Hero-only `index.md` | `layout: home` frontmatter | Empty page | Generate a contents page |
| Sidebar order | VitePress config | `.order` per folder | Write `.order` (index, onboarding, then numbered) |

Left untouched: code fences (including link-like text inside them), `<!-- Sources -->` comments, tables, external URLs, images, and Mermaid `style` lines (ADO may ignore them; that is cosmetic).

## ADO Mermaid Support

| Supported | Not supported |
|-----------|---------------|
| `graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram(-v2)`, `erDiagram`, `gantt`, `journey`, `pie`, `gitGraph`, `timeline`, `requirementDiagram` | `mindmap`, `sankey`, `quadrantChart`, `xychart`, `block` |

If the wiki uses an unsupported type, list those pages in the report. The script does not rewrite them.
