---
description: Package the generated wiki pages into a dark-only VitePress site with dark-mode Mermaid diagrams, click-to-zoom, and focus mode
argument-hint: "[--no-build]"
---

# Deep Wiki: Build VitePress Site

Load the `deep-wiki:wiki-conventions` skill, then the `deep-wiki:wiki-vitepress` skill, and follow it: copy the templates, fill in the placeholders, write `wiki/index.md` if it is missing, post-process the Markdown, and run the build.

The wiki pages should already exist (from `/deep-wiki:generate`, `/deep-wiki:crisp`, or `/deep-wiki:page`). If `wiki/` has no pages, stop and suggest one of those commands.

## Arguments

`--no-build` scaffolds and post-processes without running `npm install` or `npm run build`.

$ARGUMENTS
