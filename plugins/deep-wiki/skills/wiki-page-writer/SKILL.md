---
name: wiki-page-writer
description: Use when writing or regenerating one documentation page for a code repository - a component, subsystem, or feature deep-dive, or a leaf of the deep-wiki catalogue - that needs Mermaid diagrams and line-level source citations.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki Page Writer

Write one evidence-based documentation page: it explains why the code exists before what it does, every claim is cited, and it uses diagrams and tables more than prose.

Load `deep-wiki:wiki-conventions` if it is not already loaded. Citation formats, Mermaid rules, Markdown rules, thresholds, and the checker are defined there and are not repeated here.

## Inputs

| Input | Source |
|-------|--------|
| Topic or catalogue node (`name`, `prompt`) | Caller, or the user's arguments |
| Output path | Caller. Otherwise the matching leaf's `path` in `wiki/catalogue.json`. Otherwise `wiki/<existing section that fits>/kebab-title.md`; create a new `NN-slug/` section only when none fits |
| Depth | Caller; otherwise `depth` in `wiki/.deep-wiki.json`; otherwise `full` |
| Sibling pages | Caller, or list `wiki/**/*.md` to find cross-link targets |

## Procedure

1. **Plan.** Count the relevant files and take the word and diagram budget from conventions section 7.
2. **Analyze.** Read every relevant file completely. Trace call chains end to end. Record a `file:line` anchor for each fact you will state, taken from the file as you read it. A catalogue `prompt` is a pointer, not a fact: if it names a line, a mechanism, or a term the source does not bear out, follow the source.
3. **Write.** Use the page structure below.
4. **Validate.** Run the checklist below and fix what fails.

## Page Structure

1. Frontmatter: `title` (the catalogue `name`), `description` (one sentence), and `outline: deep` for medium or large pages.
2. `# Title`, then an **Overview** that says why this component exists and what problem it solves.
3. An **at-a-glance table**: `Component | Responsibility | Key File | Source`.
4. **Architecture**: a `graph`/`flowchart` diagram.
5. **Core components**: a table per group, with prose only where the why needs explaining.
6. **Data flow / interactions**: a `sequenceDiagram`.
7. **State / lifecycle** (`stateDiagram-v2`) and **Data model** (`erDiagram`), only when the code has them.
8. **Implementation details**: key algorithms, error handling, and concurrency, with short quoted snippets. For hard code paths, add pseudocode.
9. **Configuration**: a `Key | Default | Description | Source` table, when the topic has config.
10. **Related Pages**.

A crisp page keeps items 1–4 and 10 and adds only the other sections the topic needs.

Writing rules:

- Start each major section with a 1–2 sentence TL;DR or a summary table.
- One idea per paragraph. Turn any list of structured items into a table.
- Mix prose, diagrams, tables, and code so there are no long walls of text.
- Link inline to sibling pages whenever a concept is covered there.

## Validation Checklist

- [ ] `node wiki/scripts/check-wiki.mjs wiki --page <path relative to wiki/>` reports no errors. A crisp page in a full-depth wiki carries `depth: crisp` in its frontmatter. If the script is not in `wiki/scripts/`, check frontmatter, thresholds, citations, Mermaid rules, `{{ }}`, bare tags, tables, and links by hand against the conventions.
- [ ] Every class and function named exists, and each cited line range shows what the sentence says it shows.
- [ ] Every Mermaid block has balanced brackets and quotes (nothing checks Mermaid syntax for you).
- [ ] Inferences are marked as inferences, and nothing is guessed from names.
