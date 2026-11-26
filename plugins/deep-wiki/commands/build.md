---
description: Package the generated wiki pages into a dark-only VitePress site with dark-mode Mermaid diagrams, click-to-zoom, and focus mode
argument-hint: "[--no-build]"
---

# Deep Wiki: Build VitePress Site

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-vitepress`, and follow its four steps: scaffold with `init-wiki.mjs`, write `wiki/index.md` if it is missing, generate the indexes, check, and build.

The wiki pages should already exist (from `/deep-wiki:generate`, `/deep-wiki:crisp`, or `/deep-wiki:page`). If `wiki/` has no pages, stop and suggest one of those commands.

This command packages; it does not rewrite content or settings:

- The write mode is `fill-missing`: existing scaffold files are kept. Pass `--title` and `--description` only when `wiki/.vitepress/config.mts` does not exist yet.
- When `wiki/.deep-wiki.json` exists, pass no `--depth`, `--host`, `--repo-url`, or `--branch`. When it does not (a wiki from an older version), resolve the repository context and pass all four, with `--depth full` unless the user says the wiki is crisp.
- Fix the errors that `node wiki/scripts/check-wiki.mjs wiki --site` reports, since they break the build. Report every other finding to the user and leave the pages as they are.

## Arguments

`--no-build` scaffolds and checks without running `npm install` or the build.

$ARGUMENTS
