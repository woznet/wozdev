---
description: Generate AGENTS.md (and companion CLAUDE.md) files for the repository root, the wiki, and package roots, only where they are missing
argument-hint: "[folder ...]"
---

# Deep Wiki: Generate AGENTS.md Files

Load the `deep-wiki:wiki-conventions` skill, then the `deep-wiki:wiki-agents-md` skill, and follow them. Run on its own, this command creates files only where they are missing; the skill says when an existing file may be replaced.

## Arguments

Optional folders to limit the run to. The default is the repository root, `wiki/`, and each package root the skill detects.

$ARGUMENTS
