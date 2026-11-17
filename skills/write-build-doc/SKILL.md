---
name: write-build-doc
description: 'Turns rough notes - a goal, a loose checklist, and implementation options or components - into a concise, agent-actionable Markdown build document and saves it to docs/woz-docs/build/<name>-build.md. Use when asked to write, generate, or draft a build doc, build plan, or build spec, or to turn notes, requirements, or architectural options into something a coding agent can implement. Produces an Overall Goal, a unified Build Checklist, and per-option Intent, Implementation Guidelines, and Done When criteria, with gaps listed as Open Questions instead of invented. Not for multi-agent execution plans (use orchestrate-subagents), for writing a prompt (use optimize-prompt), or for general documentation.'
---

# Write Build Doc

Turn unstructured notes into a build document that states what to build and how, in a fixed structure a coding agent can follow without asking.

**Reader:** an autonomous coding agent first, a human reviewer second. Every line must tell one of them what to do or how to know it is done; cut anything else.

## Input

Notes in the chat, a file path the user names, or both. They may hold a goal, task lists, alternative approaches, components, constraints, and rationale in any order.

## Output

- **Path:** `docs/woz-docs/build/<name>-build.md`. Create the folder if needed. Write the file with the file-write tool, not a shell heredoc.
- **Name:** kebab-case, 2-4 words, subject noun first (`version-bump-ci`, `rumdl-installer`). Never overwrite an existing build doc; add `-2`, `-3`. Update an existing doc in place only when the user asks for that doc to change.
- **Format:** exactly the structure in `references/build-doc-template.md`.
- **Chat reply:** the file path, plus each Open Question if there are any. No summary of the doc.

**Host plan mode:** if the host restricts writes to its own plan file, put the build doc there, and write `docs/woz-docs/build/` once the host plan is approved.

## Workflow

1. **Capture.** Read all the notes. Copy constraints and do-not instructions verbatim; they belong in the guidelines they limit.
2. **Extract the goal.** One or two sentences on the final outcome, under `## Overall Goal`.
3. **Sort options from components.** Components all get built. Options are alternatives: if the notes pick one, build the doc around it and drop or briefly note the rest; if they do not, keep each option as its own section and add "Choose between X and Y" to Open Questions.
4. **Break down each option or component** into Intent (what it achieves and why, including any hard gate), Implementation Guidelines (imperative steps with concrete paths, commands, conditions, exit codes), and Done When (checkable criteria).
5. **Ground it.** When the notes concern this repository, confirm named paths, scripts, and commands exist with read-only lookups. Anything you cannot confirm or the notes leave open goes to Open Questions with the assumption the doc uses meanwhile; never invent it.
6. **Consolidate the checklist.** Merge explicit and implied tasks into one ordered `- [ ]` list under `## Build Checklist`, covering every component and the chosen option, with no duplicates.
7. **Write the file**, then lint it with rumdl as the `writing-markdown` skill describes (`rumdl check --no-cache --fix`) until zero violations remain.
8. **Report** the path and any Open Questions.

## Rules That Are Easy to Get Wrong

- **Imperative verbs.** Start every checklist item and guideline with a verb: "Create", "Detect", "Exit 1 when". Not "We should", not "The script will".
- **No filler.** No preamble, no restated rationale, no "Note that". Rationale earns a place only in Intent, in one clause.
- **Real headings.** Use `#` and `##` headings, never bold lines standing in for headings.
- **Checkable Done When.** A command and its expected result, a file that must exist, a count. "Works correctly" is not a criterion.
- **Open Questions are optional.** Omit the section when there are none; never leave a placeholder.
- **One source of truth.** Every checklist item maps to a section, and every section's work appears in the checklist.

## References

| File | Read when |
| --- | --- |
| `references/build-doc-template.md` | Writing any build doc; it defines the required structure |
| `references/example.md` | Seeing rough notes turned into a finished build doc |
