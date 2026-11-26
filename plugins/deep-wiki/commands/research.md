---
description: Conduct a five-iteration deep research investigation of one topic, tracing actual code paths with evidence and confidence ratings
argument-hint: "<topic or question> [--write]"
---

# Deep Wiki: Deep Research

Load the `deep-wiki:wiki-conventions` skill, then the `deep-wiki:wiki-researcher` skill, and follow them to investigate the topic below. Present each iteration in this conversation, then the final report.

## Arguments

The research topic or question. If it is empty, ask the user what to investigate. With `--write`, also save the final report to `wiki/research/<topic-slug>.md` as the skill describes.

$ARGUMENTS
