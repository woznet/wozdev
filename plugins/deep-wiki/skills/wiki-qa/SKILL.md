---
name: wiki-qa
description: Use when the user asks a question about how something in a code repository works, where something is defined, or what a component does, and the answer should be grounded in and cite the actual source files.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki Q&A

Answer a repository question using only evidence from its files.

Load `deep-wiki:wiki-conventions` if it is not already loaded. It defines repository resolution, citation formats, and the read-only source rule: answer by reading, never by running the project.

## Procedure

1. Answer in the language the question is asked in.
2. If `wiki/` exists, use its pages to find leads (`wiki/llms.txt`, then the relevant pages). Always confirm against the source; the wiki can be stale.
3. Search the codebase for the identifiers and concepts in the question, then read the matching files.
4. Check that the evidence supports the answer. If it does not, say so and name the files that would settle it.

## Shape the Answer to the Question

| Question | Answer |
|----------|--------|
| Lookup: "where is X defined?", "what is the default for Y?" | One or two sentences with the citation. Nothing else. |
| What a component does | A short paragraph with citations, plus a `File \| Role \| Source` table if several files are involved |
| How or why something works across files | The full structure below |

Full structure, for how and why questions only:

1. **Direct answer**: one or two paragraphs with inline citations.
2. **How it works**: the explanation, cited step by step. Add one Mermaid diagram if the answer is a flow or a set of relationships that prose would not make clear.
3. **Key files**: a `File | Role | Source` table.
4. **Code excerpt**: only if it helps, taken from the real source and preceded by `<!-- Source: path/to/file.ext:10-24 -->`.
5. **Related**: files or wiki pages to read next.

Leave out any part that would be empty or would repeat another part.

## Rules

- Use only information from this repository's files. Label anything from general knowledge (for example, how a library behaves) as such, and keep it out of claims about this code.
- Never invent paths, names, or behavior.
- Use a table for structured data (endpoints, options, components).
