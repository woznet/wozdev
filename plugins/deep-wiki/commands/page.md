---
description: Generate a single wiki page with dark-mode Mermaid diagrams, line-level source citations, and first-principles depth
argument-hint: "<topic> [file paths...] [--crisp]"
---

# Deep Wiki: Single Page Generation

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-page-writer`, and follow them to write one page.

1. **Target.** Look for the topic in `wiki/catalogue.json` (page `path` or `name`) and among the existing pages (file path or frontmatter `title`).

   | Match | Do |
   |-------|----|
   | Exact path, name, or title | Write that page, replacing it if it exists. Use the catalogue node's `path`, `name`, and `prompt` when there is one |
   | Only a similar page | Name it and ask: replace it, or write a new page |
   | None | Choose a new path as the page-writer skill describes |

2. **Scripts.** If `wiki/scripts/check-wiki.mjs` is missing, load `deep-wiki:wiki-vitepress` and run the bootstrap command from conventions section 10 (depth `crisp` with `--crisp` on a repository that has no wiki yet, otherwise `full`).
3. **Write and check** the page as the skill describes. With `--crisp` in a full-depth wiki, put `depth: crisp` in the page's frontmatter.
4. **Register a new page.** If `wiki/catalogue.json` exists and the page is not in it, add a page node under its section: `title`, `name`, `path`, a one-sentence `prompt`, `children: []`. If you created the folder, add a section node too: `title`, `name`, `dir`, `description`, and `children` holding the page. A section holds at most 8 children; if it is full, use another fitting section. Then run `node wiki/scripts/check-wiki.mjs wiki --catalogue-only`.
5. **Refresh generated files.** Run `node wiki/scripts/gen-section-indexes.mjs wiki`. If `wiki/llms.txt` exists, run `node wiki/scripts/gen-llms.mjs wiki` so the page is listed.

## Arguments

The topic or page title, optionally followed by file paths to focus on. `--crisp` writes the page at crisp depth; the default is the wiki's recorded depth, else full.

$ARGUMENTS
