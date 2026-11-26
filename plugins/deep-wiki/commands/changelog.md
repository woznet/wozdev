---
description: Generate a structured changelog from git commits, categorized by change type, for a date or revision range
argument-hint: "[range | --since <date>] [--write]"
---

# Deep Wiki: Changelog Generation

Load the `deep-wiki:wiki-conventions` skill, then the `deep-wiki:wiki-changelog` skill, and follow them.

## Arguments

Optional revision range (`v1.2.0..HEAD`) or `--since <date>`; the default is the last 30 days. `--write` also writes `wiki/changelog.md` as the skill describes.

$ARGUMENTS
