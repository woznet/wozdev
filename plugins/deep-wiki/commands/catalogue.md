---
description: Generate only the wiki structure (table of contents) as wiki/catalogue.json for the current repository
argument-hint: "[focus area or constraints]"
---

# Deep Wiki: Catalogue Generation

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-architect`, and follow them to write `wiki/catalogue.json`. Do not generate pages.

Running this command is a request to write the catalogue. If one exists, tell the user it will be replaced (or, with a focus, updated for that focus only) before you write it.

If `wiki/scripts/check-wiki.mjs` is missing, load `deep-wiki:wiki-vitepress` and run its `init-wiki.mjs --scripts-only` command first, so the catalogue can be validated.

Finish by showing the `Section | Pages | Key files` table and suggesting `/deep-wiki:generate` (choose "fill missing" there to keep this catalogue).

## Arguments

Optional focus (for example "only the pwsh app" or "max 10 pages"), applied as the architect skill describes.

$ARGUMENTS
