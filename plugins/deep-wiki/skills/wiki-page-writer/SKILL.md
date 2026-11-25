---
name: wiki-page-writer
description: Use when writing or regenerating one documentation page for a code repository - a component, subsystem, or feature deep-dive, or a leaf of the deep-wiki catalogue - that needs Mermaid diagrams and line-level source citations.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.1.0"
---

# Wiki Page Writer

Write one evidence-based documentation page: it explains why the code exists before what it does, every claim is cited, and it uses diagrams and tables more than prose.

**First load `deep-wiki:wiki-conventions`.** It defines repository resolution, citation formats, the dark Mermaid palette, VitePress-safe Markdown, the `wiki/` layout, and the diagram and citation thresholds this page must meet.

## Inputs

| Input | Source |
|-------|--------|
| Topic or catalogue node (`title`, `name`, `prompt`) | Caller, or the user's arguments |
| Output path | Caller; otherwise `wiki/NN-section/kebab-title.md` (pick the section that fits, or create the next number) |
| Mode | `full` (default) or `crisp` |
| Sibling pages | Caller, or list `wiki/**/*.md` to find cross-link targets |

## Procedure

1. **Plan (10%).** Count the relevant files and set the budget:

   | Scope | Relevant files | Words | Diagrams (full mode) |
   |-------|----------------|-------|----------------------|
   | Small | ≤ 50 | 2,000–3,000 | 3, of 2+ types |
   | Medium | 50–300 | 3,000–5,000 | 4, of 3+ types |
   | Large | > 300 (sample entry points, domain models, data access, integration edges) | 5,000–8,000 | 5–8, of 4+ types |

   In crisp mode, write 600–1,500 words and 1–2 diagrams.
2. **Analyze (40%).** Read every relevant file completely. Trace call chains end to end. Record a `file:line` anchor for each fact you will state, taken from the file as you read it. A catalogue `prompt` is a pointer, not a fact: if it names a line, a mechanism, or a term the source does not bear out, follow the source. Read only; do not run the project's tests, builds, or scripts.
3. **Write (40%).** Use the page structure below.
4. **Validate (10%).** Run the checker on the page, then the checklist below, and fix anything that fails.

## Page Structure

1. Frontmatter: `title` (the catalogue `name`, at most 60 characters), `description` (one sentence), and `outline: deep` for medium or large pages.
2. `# Title`, then an **Overview** that says why this component exists and what problem it solves.
3. An **at-a-glance table**: `Component | Responsibility | Key File | Source`.
4. **Architecture**: a `graph`/`flowchart` diagram.
5. **Core components**: a table per group, with prose only where the why needs explaining.
6. **Data flow / interactions**: a `sequenceDiagram` with `autonumber`.
7. **State / lifecycle** (`stateDiagram-v2`) and **Data model** (`erDiagram`), only when the code has them.
8. **Implementation details**: key algorithms, error handling, and concurrency, with short quoted snippets (each preceded by `<!-- Source: ... -->`). For hard code paths, add pseudocode.
9. **Configuration**: a `Key | Default | Description | Source` table, when the topic has config.
10. **Related Pages**: a `Page | Relationship` table of relative links.

Writing rules:

- Start each major section with a 1–2 sentence TL;DR or a summary table.
- One idea per paragraph. Turn any list of structured items into a table.
- Keep tables narrow: at most 5 columns, and in a cell cite `file.ext:lines` as the link text with the full path in the URL.
- Mix prose, diagrams, tables, and code so there are no long walls of text.
- Link inline to sibling pages whenever a concept is covered there. Make links bidirectional when you are also writing the other page.

## Validation Checklist

- [ ] `node wiki/scripts/check-wiki.mjs wiki --page <path>` (with `--mode crisp` in crisp mode) reports no errors. It checks frontmatter, thresholds, citations, Mermaid rules, `{{ }}`, bare tags, tables, and links. If the script is not in `wiki/scripts/` yet, check those by hand against the conventions.
- [ ] Every class and function named exists, and each cited line range shows what the sentence says it shows.
- [ ] Every Mermaid block parses and uses the dark palette.
- [ ] Every relative `.md` link points to a page that exists or that the caller listed as a sibling.
- [ ] Inferences are marked as inferences, and nothing is guessed from names.
