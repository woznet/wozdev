---
description: Generate a single wiki page with dark-mode Mermaid diagrams, line-level source citations, and first-principles depth
argument-hint: "<topic> [file paths...] [--crisp]"
---

# Deep Wiki: Single Page Generation

Load the `deep-wiki:wiki-conventions` skill, then the `deep-wiki:wiki-page-writer` skill, and follow them to write one page.

If `wiki/catalogue.json` has a leaf that matches the topic, use its `path` and `prompt`. Otherwise choose the path as the page-writer skill describes. If the page is new and `wiki/llms.txt` exists, mention that `/deep-wiki:llms` should be re-run.

## Arguments

The topic or page title, optionally followed by file paths to focus on. `--crisp` selects crisp mode; the default is full mode.

$ARGUMENTS
