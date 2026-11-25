---
name: wiki-llms-txt
description: Use when the user wants llms.txt or llms-full.txt files, an LLM-readable summary of a project or its wiki, or documentation that coding agents and language models can discover at a standard path.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.1.0"
---

# llms.txt Generator

Generate `llms.txt` and `llms-full.txt` files that provide LLM-friendly access to wiki documentation, following the [llms.txt specification](https://llmstxt.org/).

## When This Skill Activates

- User asks to generate `llms.txt` or mentions the llms.txt standard
- User wants to make documentation "LLM-friendly" or "LLM-readable"
- User asks for a project summary file for language models
- User mentions `llms-full.txt` or context-expanded documentation

**First load `deep-wiki:wiki-conventions`.** It defines repository resolution (`REPO_URL`, `HOST`, `BRANCH`), citation formats, the dark Mermaid palette, VitePress-safe Markdown, the `wiki/` layout, and quality thresholds. Do not restate those rules here; follow them.

## llms.txt Format (Spec-Compliant)

The file follows the [llms.txt specification](https://llmstxt.org/):

```markdown
# {Project Name}

> {Dense one-paragraph summary — what it does, who it's for, key technologies}

{Important context paragraphs — constraints, architectural philosophy, non-obvious things}

## {Section Name}

- [{Page Title}]({relative-path-to-md}): {One-sentence description of what the reader will learn}

## Optional

- [{Page Title}]({relative-path-to-md}): {Description — these can be skipped for shorter context}
```

### Key Rules

1. **H1** — Project name (exactly one, required)
2. **Blockquote** — Dense, specific summary (required). Must be unique to THIS project.
3. **Context paragraphs** — Non-obvious constraints, things LLMs would get wrong without being told
4. **H2 sections** — Organized by topic, each with a list of `[Title](url): Description` entries
5. **"Optional" H2** — Special meaning: links here can be skipped for shorter context
6. **Relative links** — All paths relative to wiki directory
7. **Dynamic** — ALL content derived from actual wiki pages, not templates
8. **Section order** — Most important first: Onboarding → Architecture → Getting Started → Deep Dive → Optional

### Description Quality

| ❌ Bad | ✅ Good |
|--------|---------|
| "Architecture overview" | "System architecture showing how Orleans grains communicate via message passing with at-least-once delivery" |
| "Getting started guide" | "Prerequisites, local dev setup with Docker Compose, and first API call walkthrough" |
| "The API reference" | "REST endpoints with auth requirements, rate limits, and request/response schemas" |

## llms-full.txt Format

Same structure as `llms.txt` but with full content inlined:

```markdown
# {Project Name}

> {Same summary}

{Same context}

## {Section Name}

<doc title="{Page Title}" path="{relative-path}">
{Full markdown content — frontmatter stripped, citations and diagrams preserved}
</doc>
```

### Inlining Rules

- **Strip YAML frontmatter** (`---` blocks) from each page
- **Preserve Mermaid diagrams** — keep `` ```mermaid `` fences intact
- **Preserve citations** — all `[file:line](URL)` links stay as-is
- **Preserve tables** — all markdown tables stay intact
- **Preserve `<!-- Sources: -->` comments** — these provide diagram provenance
- **Rebase relative links**. A page's relative links resolve against that page's folder, but once inlined they resolve against `wiki/llms-full.txt`. Rewrite each relative link (Markdown links and images) to the wiki-relative path of its target. For example, `../02-architecture/auth.md#tokens` in `onboarding/contributor-guide.md` becomes `./02-architecture/auth.md#tokens`. Keep anchors. Leave external URLs, absolute paths, and same-page `#anchor` links unchanged.

## Prerequisites

This skill works best when wiki pages already exist (via `/deep-wiki:generate` or `/deep-wiki:page`). If no wiki exists yet:

1. Suggest running `/deep-wiki:generate` first
2. OR generate a minimal `llms.txt` from README + source code scan (without wiki page links)

## Output Files

Generate these files:

| File | Purpose | Discoverability |
|------|---------|-----------------|
| `./llms.txt` | Root discovery file | Standard path per llms.txt spec. GitHub MCP `get_file_contents` and `search_code` find this first. |
| `wiki/llms.txt` | Wiki-relative links | For VitePress deployment and wiki-internal navigation. |
| `wiki/llms-full.txt` | Full inlined content | Comprehensive reference for agents needing all docs in one file. |
| `wiki/public/llms.txt`, `wiki/public/llms-full.txt` | Deployment copies (wiki links rewritten to site routes) | Reachable at `/llms.txt` on the deployed wiki. |

The root `./llms.txt` links into `wiki/` (e.g., `[Guide](./wiki/onboarding/contributor-guide.md)`). The `wiki/llms.txt` uses wiki-relative paths (e.g., `[Guide](./onboarding/contributor-guide.md)`).

Also write deployment copies to `wiki/public/` so the deployed site serves them at `/llms.txt` and `/llms-full.txt`. That folder is the VitePress public folder; `.vitepress/public/` is not served.

The site serves HTML pages, not the `.md` sources, so both deployment copies rewrite wiki links to built site routes. Read `base` (the `BASE` constant) and `cleanUrls` from `wiki/.vitepress/config.mts`. Then turn `./onboarding/contributor-guide.md` into `{base}onboarding/contributor-guide` (add `.html` when `cleanUrls` is off), and `./02-architecture/index.md` into `{base}02-architecture/`. Keep anchors (`#section`). Leave external URLs and source-file citations unchanged.

- **`wiki/public/llms.txt`**: the text of `wiki/llms.txt`, with its wiki links rewritten this way.
- **`wiki/public/llms-full.txt`**: the text of `wiki/llms-full.txt` (whose links are already rebased to wiki-relative paths), with its wiki links rewritten the same way. Everything else stays identical.

`wiki/llms.txt` and the root `./llms.txt` keep their `.md` links, for repository and agent discovery.

**Marker and overwrite guard.** Put `<!-- generated by deep-wiki -->` on the line after the H1 in every file. Before writing any of the five files, check whether it already exists. Overwrite it only if it contains that marker; otherwise skip it and say so in the report.

**Optional links.** List `changelog.md`, `CONTRIBUTING.md`, or similar pages under `## Optional` only if the file exists. Never link a page you have not seen on disk.

## Validation Checklist

Before finalizing:

- [ ] All linked files in `llms.txt` actually exist
- [ ] All `<doc>` blocks in `llms-full.txt` have real content (not empty)
- [ ] Blockquote is specific to this project (not generic boilerplate)
- [ ] Sections ordered by importance
- [ ] No duplicate page entries across sections
- [ ] "Optional" section only contains truly optional content
- [ ] `llms.txt` is concise (1-5 KB)
- [ ] `llms-full.txt` contains all wiki pages
- [ ] Relative links inside `llms-full.txt` are rebased to wiki-relative paths and point at files that exist
- [ ] `wiki/public/llms-full.txt` matches `wiki/llms-full.txt` except that its wiki links are site routes
- [ ] Every wiki link in `wiki/public/llms.txt` and `wiki/public/llms-full.txt` is a site route under `base` (no `.md` links)
- [ ] Every generated file carries the marker; no file without the marker was overwritten
