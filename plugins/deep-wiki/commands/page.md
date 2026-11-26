---
description: Generate a single wiki page with dark-mode Mermaid diagrams, line-level source citations, and first-principles depth
argument-hint: "<topic> [file paths...] [--crisp]"
---

# Deep Wiki: Single Page Generation

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-page-writer`, and follow them to write one page. Naming the topic is a request to write that page, so replace it if it exists.

1. **Path.** If `wiki/catalogue.json` has a page that matches the topic, use its `path`, `name`, and `prompt`. Otherwise choose the path as the page-writer skill describes.
2. **Scripts.** If `wiki/scripts/check-wiki.mjs` is missing, load `deep-wiki:wiki-vitepress` and run its `init-wiki.mjs --scripts-only` command first.
3. **Write and check** the page as the skill describes.
4. **Register a new page.** If `wiki/catalogue.json` exists and the page is not in it, add a page node under its section (`title`, `name`, `path`, a one-sentence `prompt`, `children: []`; add a section node with `dir` and `description` if you created the folder). Then run `node wiki/scripts/gen-section-indexes.mjs wiki` and `node wiki/scripts/check-wiki.mjs wiki --catalogue-only`.
5. If `wiki/llms.txt` exists, run `node wiki/scripts/gen-llms.mjs wiki` so the new page is listed.

## Arguments

The topic or page title, optionally followed by file paths to focus on. `--crisp` writes the page at crisp depth; the default is the wiki's recorded depth, else full. For a crisp page in a full-depth wiki, check it with `--mode crisp`.

$ARGUMENTS
