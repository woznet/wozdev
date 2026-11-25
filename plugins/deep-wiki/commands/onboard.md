---
description: Generate audience-tailored onboarding guides in wiki/onboarding/ for contributors, staff engineers, executives, and product managers
argument-hint: "[contributor|staff|executive|pm ...]"
---

# Deep Wiki: Onboarding Guide Generation

Load the `deep-wiki:wiki-conventions` skill, then the `deep-wiki:wiki-onboarding` skill, and follow them to write the guides to `wiki/onboarding/`.

To keep each guide's context small, you may dispatch one `deep-wiki:wiki-writer` subagent per guide. Give each the onboarding guide's section list from the skill as its task, and the repository context as the conventions describe.

## Arguments

Optional list of guides to generate; the default is all four.

$ARGUMENTS
