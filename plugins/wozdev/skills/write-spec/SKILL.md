---
name: write-spec
description: 'Turns rough notes, brain dumps, or partial ideas for a feature or skill into a paired PRD.md (what and why) and SPEC.md (how) saved under docs/woz-docs/spec-dev/. Use when asked to write, draft, or generate a PRD, product spec, technical spec, requirements doc, or design spec, or to scope a new feature or Claude skill before building it. Not for implementation checklists (use write-build-doc, which can take the SPEC as input), multi-agent execution plans (use orchestrate-subagents), or writing a prompt (use optimize-prompt).'
---

# Write Spec

Turn unstructured notes into two documents: a `PRD.md` that says what to build and why, and a `SPEC.md` that says how, with every requirement traced to the steps and checks that satisfy it.

**Reader:** an autonomous coding agent first, a human reviewer second. Every line must state a requirement, a decision, or a check; cut anything else.

## Input

Notes in the chat, a file path the user names, or both: goals, workflows, inputs, outputs, constraints, and rationale in any order.

## Output

- **Paths:** `docs/woz-docs/spec-dev/<slug>/PRD.md` and `docs/woz-docs/spec-dev/<slug>/SPEC.md`, relative to the repository root. Create the folders if needed. Write with the file-write tool, not a shell heredoc.
- **Slug:** kebab-case, 2-4 words, subject noun first (`version-bump-enforcer`, `subagent-batch-planner`). If the folder exists, use `<slug>-2`, `-3`. Update an existing spec in place only when the user asks for that spec to change; read both files first.
- **Format:** exactly the structures in `references/prd-template.md` and `references/spec-template.md`.
- **Chat reply:** both file paths, plus each Open Question if there are any. No summary of the documents.

**Host plan mode:** if the host restricts writes to its own plan file, draft both documents there, and write `docs/woz-docs/spec-dev/` once the host plan is approved.

## Clarification Gate

Check the notes against four pillars: **objective** (what problem is solved or artifact produced), **trigger and inputs**, **outputs and side effects**, **constraints and failure conditions**.

When the notes concern this repository, do a quick read-only lookup first; a pillar the repository settles is not missing.

- **Blocked** - a pillar is missing or contradictory and the plausible answers lead to different designs: write nothing. Ask 1-4 short questions, the most design-changing gap first, with the host's question tool if it has one (each with likely answers), otherwise as one numbered list. Resume when answered.
- **Actionable** - pick a reasonable default for every smaller gap, record it under Assumptions & Open Questions, and continue. Never ask for what the notes, the repository, or a sensible default already settle.

## Workflow

1. **Capture.** Read all the notes. Keep constraints and do-not instructions verbatim; they become requirements, Out of Scope items, or Constraints.
2. **Gate.** Apply the Clarification Gate.
3. **Ground it.** When the notes concern this repository, confirm named paths, scripts, and commands exist with read-only lookups, and look for anything that already does the job; name it in Key Risks. Anything unconfirmed goes to Open Questions with the assumption used meanwhile; never invent it.
4. **Draft the PRD.** Objective, audience, use cases, numbered `FR`/`NFR` requirements, Out of Scope, risks, assumptions.
5. **Draft the SPEC.** Constraints, inputs, outputs, workflow, interfaces, edge cases, and Acceptance Criteria. Cite the requirement IDs each workflow step and criterion serves.
6. **Write both files**, then lint them with rumdl as the `writing-markdown` skill describes (`rumdl check --color never --no-cache --fix`, plus `--disable MD013` when the repository has no `.rumdl.toml`) until zero violations remain. If rumdl is missing and cannot be installed, say so in the report.
7. **Report** both paths and any Open Questions. If the user wants an implementation checklist next, `write-build-doc` takes the SPEC as its notes and writes `BUILD.md` into the same `<slug>` folder.

## Rules That Are Easy to Get Wrong

- **What vs how.** The PRD holds intent and requirements, never file layouts, schemas, or commands. The SPEC holds mechanics and never restates the why.
- **Full traceability.** Every `FR` is cited by at least one SPEC workflow step and one Acceptance Criterion; every criterion cites an `FR` or `NFR`.
- **Checkable criteria.** A command and its expected result, a file that must exist, an exit code, a count. "Works correctly" is not a criterion.
- **Imperative, no filler.** Requirements and steps start with a verb. No preamble, no "Note that", no restated rationale.
- **Out of Scope is never empty.** Name at least one thing a reasonable implementer might build but should not.
- **Optional sections are omitted, not stubbed.** Drop Assumptions & Open Questions, Prompt / Instructions, or Interfaces & Templates when they have nothing to say.

## References

| File | Read when |
| --- | --- |
| `references/prd-template.md` | Writing any PRD; it defines the required structure |
| `references/spec-template.md` | Writing any SPEC; it defines the required structure |
| `references/example.md` | Seeing rough notes turned into a finished PRD and SPEC |
