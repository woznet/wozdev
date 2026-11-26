---
description: Package the generated wiki pages into a dark-only VitePress site with dark-mode Mermaid diagrams, click-to-zoom, and focus mode
argument-hint: "[--no-build]"
---

# Deep Wiki: Build VitePress Site

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-vitepress`, and follow its four steps: scaffold with `init-wiki.mjs` (existing scaffold files are kept), write `wiki/index.md` if it is missing, generate the indexes, check, and build.

The wiki pages should already exist (from `/deep-wiki:generate`, `/deep-wiki:crisp`, or `/deep-wiki:page`). If `wiki/` has no pages, stop and suggest one of those commands.

This command packages; it does not rewrite content. Fix the errors that `node wiki/scripts/check-wiki.mjs wiki --site` reports, since they break the build. Report every other finding to the user and leave the pages as they are.

## Arguments

`--no-build` scaffolds and checks without running `npm install` or the build.

$ARGUMENTS
