---
name: wiki-qa
description: Use when the user asks a question about how something in a code repository works, where something is defined, or what a component does, and the answer should be grounded in and cite the actual source files.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.1.0"
---

# Wiki Q&A

Answer a repository question using only evidence from its files.

**First load `deep-wiki:wiki-conventions`.** It defines repository resolution and citation formats.

## Procedure

1. Answer in the language the question is asked in.
2. If `wiki/` exists, use its pages to find leads (`wiki/llms.txt`, then the relevant pages). Always confirm against the source; the wiki can be stale.
3. Search the codebase for the identifiers and concepts in the question, then read the matching files in full.
4. Think through the chain of evidence before answering. If it doesn't support an answer, say so and name the files that would settle it.

## Response Format

```markdown
## Concise Answer Title

A one- or two-paragraph direct answer with inline citations.

### How It Works
A detailed explanation with citations. Include one Mermaid diagram when the answer involves architecture, a flow, or relationships between components.

### Key Files
| File | Role | Source |
|------|------|--------|

### Code Example
<!-- Source: path/to/file.ext:10-24 -->
(an excerpt from the real source, only if it helps)

### Related
- Files or wiki pages to read next
```

## Rules

- Use only information from this repository's files. If something comes from general knowledge (for example, how a library works), label it as such and keep it out of claims about this code.
- Never invent paths, names, or behavior.
- Use tables for any structured data (endpoints, options, components).
