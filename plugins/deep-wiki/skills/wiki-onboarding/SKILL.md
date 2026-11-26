---
name: wiki-onboarding
description: Use when the user wants onboarding documentation for a codebase - a contributor getting-started guide, an architecture primer for senior engineers, or capability and risk overviews for engineering leaders or product managers.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki Onboarding Guides

Write audience-tailored onboarding guides in `wiki/onboarding/`. Each guide gives one kind of reader the understanding they need and nothing else.

Load `deep-wiki:wiki-conventions` if it is not already loaded. Its citation formats, Mermaid rules, VitePress-safe Markdown, evidence standard, and read-only source rule all apply; they are not repeated here.

## Guides

| Guide | File | `title` (exact) | Reader |
|-------|------|-----------------|--------|
| Contributor | `wiki/onboarding/contributor-guide.md` | `"Contributor Guide"` | Engineer joining the project |
| Staff engineer | `wiki/onboarding/staff-engineer-guide.md` | `"Staff Engineer Guide"` | Senior engineer who wants the reasons behind the design |
| Executive | `wiki/onboarding/executive-guide.md` | `"Executive Guide"` | Engineering leader: capability, risk, investment |
| Product manager | `wiki/onboarding/product-manager-guide.md` | `"Product Manager Guide"` | Non-engineer: what it does and where the limits are |

- **Which to write:** all four at full depth. If the caller or the user names a subset (`contributor`, `staff`, `executive`, `pm`), write only those. At crisp depth, write only the contributor guide.
- **The hub** `wiki/onboarding/index.md` is generated. After the guides are written, run `node wiki/scripts/gen-section-indexes.mjs wiki`. Never write the hub by hand. It lists each guide's `title` and `description`, so make the description one sentence that tells the reader what they will learn.
- **Dispatching:** when a workflow delegates a guide to a `deep-wiki:wiki-writer`, the prompt names the guide and tells the writer to load this skill and follow the section for that guide.

## Requirements for Every Guide

| Item | Rule |
|------|------|
| Frontmatter | `title` (from the table, in double quotes), `description` (one sentence, in double quotes), `outline: deep` |
| Headings | Do not number headings. If you link to a heading, follow the conventions' anchor rule. |
| Evidence | Read the code before writing. Cite per the conventions. |
| Diagrams | Use only diagram kinds the code supports. If the project has no data model or no state machine, leave that diagram out and meet the minimum with other types. |
| Commands | Take commands from the repository's files. Show expected output only where the repository documents it; never run a command to capture output and never invent output. |
| Unknowns | See "Facts the Repository Cannot Supply". |

Minimums the checker enforces (it reads the depth from `wiki/.deep-wiki.json`):

| Guide | Full depth | Crisp depth | Word budget (full / crisp) |
|-------|------------|-------------|----------------------------|
| Contributor | 5 diagrams of 2+ types, 5 cited files | 2 diagrams, 3 cited files | 5,000–9,000 / 1,200–2,000 |
| Staff engineer | 5 diagrams of 2+ types, 5 cited files | not written | 4,000–7,000 |
| Executive | 3 diagrams of 2+ types | not written | 1,500–3,000 |
| Product manager | 3 diagrams of 2+ types | not written | 1,500–3,000 |

Budgets are ceilings on padding, not targets to fill: stop when the sections are covered. At crisp depth the contributor guide keeps sections 3–6, 8, 10, 11 and the Key File Reference.

## Facts the Repository Cannot Supply

Owners, bus factor, current metric values, SLAs, rate limits, costs, roadmap, and retention policies come only from evidence in the repository (CODEOWNERS, config, docs, dashboards-as-code, git history for ownership). When there is no evidence, write `Not determinable from the repository` in the cell. Never write a plausible-sounding number or name. List those gaps in a closing "Open questions for the team" section.

## Contributor Guide

Progressive: each section builds on the last. Code examples are in the repository's primary language (detect it from the manifests).

**Part I: Foundations** (skip when the repository is Python or JavaScript/TypeScript)

1. **{Primary language} for Python/JS engineers**: side-by-side syntax tables, async model, collections, types, package management.
2. **{Primary framework} essentials**: compared with the nearest Python/JS equivalent.

**Part II: This codebase**

3. **What this project does**: two or three sentences.
4. **Project structure**: annotated directory tree and an architecture `flowchart`.
5. **Core concepts**: the project's own terms, with code. An `erDiagram` when there is a data model.
6. **Request or run lifecycle**: a `sequenceDiagram` tracing one typical path end to end.
7. **Key patterns**: "to add X, follow this" recipes built from real code.

**Part III: Getting productive**

8. **Prerequisites and setup**: `Tool | Version | Install command` table, then the steps.
9. **Your first task**: end-to-end walkthrough of a small change.
10. **Development workflow**: branches, commits, PR checks, as a `flowchart`.
11. **Running tests**: all, one file, one test, coverage.
12. **Debugging**: `Symptom | Cause | Fix` table.
13. **Common pitfalls**.

**Appendices:** a glossary of every project-specific term the guide uses; a Key File Reference (`File | Purpose | Why it matters | Source`); a quick-reference card of the most-used commands.

## Staff Engineer Guide

Dense and opinionated. Explain why each decision was made, not only what exists. Prefer tables with a `Source` column to bullet lists. Assume deep systems experience and no knowledge of this repository's language: map unfamiliar concepts with comparison tables (for example `` `Task<T>` `` beside `` `Awaitable[T]` ``) and show the core idea as pseudocode in a different language.

1. **Executive summary**: one dense paragraph; what the system owns and what it delegates.
2. **The core architectural insight**: the single most important idea, with the pseudocode.
3. **System architecture**: a `flowchart`; name the heart of the system.
4. **Domain model**: `erDiagram` of core entities (when there is one) and an invariants table (`Entity | Invariant | Enforced by | Source`).
5. **Key abstractions and interfaces**: a `classDiagram` of the load-bearing ones.
6. **Request or run lifecycle**: a `sequenceDiagram`.
7. **State transitions**: a `stateDiagram-v2`, only for entities with real lifecycle states.
8. **Decision log**: `Decision | Alternatives | Rationale | Source`.
9. **Dependency rationale**: `Dependency | Purpose | What it replaced | Source`.
10. **Data flow and state**: how data moves; storage comparison table.
11. **Failure modes and error handling**: a `flowchart` of error propagation.
12. **Performance characteristics**: bottlenecks, limits, hot paths.
13. **Security model**: authentication, authorization, trust boundaries.
14. **Testing strategy**: what is tested and what is not.
15. **Known technical debt**: `Issue | Risk | Affected files | Source`.
16. **Where to go deep**: reading order of source files and links to wiki pages.

## Executive Guide

Strategic and decision-oriented. No code snippets. Diagrams at the level of services and teams, never classes or functions. Translate technical facts into reliability, velocity, cost, and risk. One table per structured finding.

1. **System overview**: what it does, who uses it, its value.
2. **Capability map**: `Capability | Status (Built/Partial/Planned) | Maturity | Dependencies`.
3. **Architecture at a glance**: a `flowchart LR` of deployment units, data stores, and external integrations.
4. **Team topology**: `Component | Owner | Criticality | Bus factor`.
5. **Technology investment thesis**: `Technology | Purpose | Alternatives | Risk`.
6. **Risk assessment**: `Risk | Likelihood | Impact | Mitigation | Owner`.
7. **Cost and scaling model**: how cost grows with use, and the next bottleneck.
8. **Dependency map**: a diagram of critical external dependencies and `Dependency | Type | Risk if unavailable`.
9. **Key metrics and observability**: `Metric | Current | Target | Source`.
10. **Roadmap alignment**: in progress, planned, blocked.
11. **Technical debt summary**: top five items, `Issue | Business impact | Effort | Priority`.
12. **Recommendations**: three to five, ordered by impact.

## Product Manager Guide

User-centric. No engineering jargon; when a technical term is unavoidable, explain it in one sentence. Describe what users experience, not how the code works. One table per structured finding.

1. **What this system does**: two or three sentences in user-facing language.
2. **User journey map**: a `flowchart LR` or `journey` diagram of the main flows.
3. **Feature capability map**: `Feature | Status | User-facing behaviour | Limitations`.
4. **Data model, product view**: a simplified `erDiagram` in business terms, when users deal with entities.
5. **Configuration and feature flags**: `Setting | What it controls | Default | Who can change it`.
6. **Integration capabilities**: `Capability | Endpoint or method | Authentication | Limits`.
7. **Performance and SLAs**: `Operation | Expected latency | Limit | SLA`.
8. **Known limitations**: `Limitation | User impact | Workaround | Planned fix`.
9. **Data and privacy**: `Data type | Where stored | Retention | Compliance`.
10. **Glossary**: domain terms in plain language.
11. **FAQ**: the questions a PM would ask, answered briefly.

## Validation

1. Run `node wiki/scripts/check-wiki.mjs wiki --page onboarding/<guide>.md` when the script exists. Fix every error and rerun, at most three passes; then report what remains.
2. Confirm by reading: every named class, function, and path exists; the executive and PM guides contain no code; every `Not determinable from the repository` cell is listed under "Open questions for the team".
