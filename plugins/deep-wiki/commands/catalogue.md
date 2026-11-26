---
description: Generate only the wiki structure (table of contents) as wiki/catalogue.json for the current repository
argument-hint: "[focus area or constraints]"
---

# Deep Wiki: Catalogue Generation

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-architect`, and follow them to write `wiki/catalogue.json`. Do not generate pages.

Running this command is a request to write the catalogue. If one exists, tell the user it will be replaced (or, with a focus, updated for that focus only) before you write it.

First load `deep-wiki:wiki-vitepress` and run the bootstrap command from conventions section 10 (it gives the flags for a first run and for a later one), so the catalogue can be validated with current scripts.

Finish by showing the `Section | Pages | Key files` table and suggesting `/deep-wiki:generate` (choose "fill missing" there to keep this catalogue).

## Arguments

Optional. A focus is a subsystem or folder ("only the pwsh app"); a constraint shapes the whole catalogue ("at most 10 pages"). Both are applied as the architect skill describes.

$ARGUMENTS
