---
name: wiki-architect
description: Use when planning documentation for a code repository - creating a wiki, mapping a codebase's structure, producing a documentation table of contents or catalogue, or deciding which pages a wiki needs before writing them.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki Architect

Analyze the repository and produce the wiki catalogue: a hierarchical table of contents whose titles and page prompts come from the real code.

Load `deep-wiki:wiki-conventions` if it is not already loaded. It defines repository resolution, the `wiki/` layout, the write modes, and the read-only source rule.

## Inputs

| Input | Meaning |
|-------|---------|
| Repository context | `REPO_URL`, `HOST`, `BRANCH` |
| Focus (optional) | A subsystem or folder ("only the pwsh app"). Catalogue only what the focus names. When `wiki/catalogue.json` already exists, keep every node outside the focus unchanged and add or replace only the focus's sections, then report the page paths you added or changed. Without a focus, cover the whole repository. |
| Constraint (optional) | A limit on the whole catalogue ("at most 10 pages", "two levels only"). Apply it at the level of detail it asks for; it does not narrow the scope. |
| Existing catalogue | You were asked to write `wiki/catalogue.json`, so replace it (or, with a focus, merge into it). |

## Procedure

1. **Scan** the file tree (skip `node_modules/`, `dist/`, `.git/`, vendored code, and `wiki/` itself) and read the README.
2. **Detect** languages (from extensions and manifests: `package.json`, `pyproject.toml`, `*.csproj`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.psd1`, `Dockerfile`, …), frameworks, entry points, build and CI configuration, and key technologies (datastores, messaging, protocols).
3. **Identify** the natural decomposition: layers, modules, services, and their boundaries. Read enough code to confirm each boundary instead of trusting folder names.
4. **Write** the catalogue to `wiki/catalogue.json` (create `wiki/` if needed) using the schema below.
5. **Verify** it. If `wiki/scripts/check-wiki.mjs` exists, run `node wiki/scripts/check-wiki.mjs wiki --catalogue-only` and fix every error and every `catalogue-prompt` warning. Take the section and page counts from its summary line, not from your plan.

## Catalogue Schema

```json
{
  "project": "Project Name",
  "summary": "One specific sentence about what the project does.",
  "items": [
    {
      "title": "getting-started",
      "name": "Getting Started",
      "dir": "01-getting-started",
      "description": "What the project is, how to install it, and how to run it for the first time.",
      "children": [
        {
          "title": "setup",
          "name": "Setup and First Run",
          "path": "01-getting-started/setup.md",
          "prompt": "Document prerequisites and the dev loop from package.json (scripts), README.md (Development section), Dockerfile, docker-compose.yml, and .github/workflows/ci.yml.",
          "children": []
        }
      ]
    }
  ]
}
```

| Field | Rule |
|-------|------|
| `title` | kebab-case slug, unique among siblings |
| `name` | Display name taken from the code, never a placeholder. At most 60 characters, no `<`, `>`, `{{`, or `}}`: it is the sidebar label and the page title |
| `dir` | Section nodes only: the folder relative to `wiki/`. Top level is `NN-slug`, numbered in reading order; a nested section is `NN-slug/sub-slug`. No `..` segments, and no folder named `dist` or `node_modules` |
| `description` | Section nodes only: one sentence on what the section covers, with no `<`, `>`, `{{`, or `}}`. It becomes the introduction of the section's generated `index.md` |
| `path` | Page nodes only: the page file relative to `wiki/`, inside its parent section's `dir`. Every segment is kebab-case (`02-architecture/request-flow.md`): no spaces, capitals, or `..` |
| `prompt` | Page nodes only: 1–3 sentences naming the files the writer must read and what to explain. Name files and symbols by their real paths. Add a line range only for a file you opened and read; never take line numbers from search output |
| `minFiles` | Page nodes only, optional: an integer from 2 to 4. Set it only when the topic genuinely has fewer than 5 source files; it lowers that page's citation minimum |
| `children` | Empty array for pages; at least one node for sections |

## Structure Rules

- Top-level sections in order: **Getting Started** (overview, setup, usage, quick reference), then **Deep Dive** sections (architecture → subsystems → components → key interfaces). Onboarding guides are not catalogue nodes; `deep-wiki:wiki-onboarding` writes them to `wiki/onboarding/`.
- Max depth 4; max 8 children per node.
- A node has `dir` or `path`, never both. Never add an `index.md` page: section indexes are generated from the catalogue.
- `name`, `description`, and `prompt` are each a single line: no line breaks inside the string.
- Every page `prompt` names at least 5 real files (the writer must cite 5), or the page sets `minFiles`. Never reference a file you have not seen in the scan.
- Small repos (≤ 10 source files): Getting Started only, with 1–3 pages, each with `minFiles` as needed. The checker never asks a page to cite more files than the repository has.
- Split a page when its prompt would need more than ~15 files; merge pages that would cite the same handful of files.
- Describe what the code does now. Check each term in a `name` or `prompt` against the current source, not against a README, comment, or commit message that may be out of date.

## Output

1. `wiki/catalogue.json`.
2. A short summary table for the caller: `Section | Pages | Key files`, with the counts the checker printed (or counted from the written file when the checker is not installed).
3. With a focus: the list of page paths you added or changed.
