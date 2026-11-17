# SPEC Template

Copy the template below into `docs/woz-docs/spec-dev/<slug>/SPEC.md` and replace every bracketed placeholder.

## Format Rules

- One level-1 heading: the feature or skill name followed by `Spec`.
- Level-2 headings, in this order: `Constraints & Conventions`, `Inputs`, `Outputs`, `Workflow`, `Interfaces & Templates` (optional), `Edge Cases & Error Handling`, `Acceptance Criteria`.
- Add `### Prompt / Instructions` under `Constraints & Conventions` only when the thing being specified is an LLM skill, agent, or prompt; list the rules it must follow there.
- `Workflow` is a numbered list in execution order. Each step starts with a bold step name, gives a deterministic instruction, and ends with the requirement IDs it serves, such as `(FR1, FR3)`.
- `Interfaces & Templates` holds file layouts, schemas, CLI signatures, or output templates, each in a fenced block with a language tag. Omit the section when there are none.
- Each `Acceptance Criteria` item is a `- [ ]` task with a checkable result and the requirement ID it proves, such as `(FR2)`. Every `FR` in the PRD appears at least once. A criterion that needs sample input names it: a fixture path, or the input stated inline.
- Use `-` for every bullet and two-space indentation for nested lists.

## Template

````markdown
# [Feature or Skill Name] Spec

## Constraints & Conventions

- [Hard rule: stack, dependency, boundary, style]
- [Hard rule]

### Prompt / Instructions

- [Rule the skill or agent must follow]

## Inputs

- **[Input name]**: [Type and format, where it comes from, required or optional]

## Outputs

- **[Output name]**: [Type, exact path or format, side effects]

## Workflow

1. **[Step name]**: [Deterministic instruction] (FR1)
2. **[Step name]**: [Deterministic instruction] (FR2, NFR1)

## Interfaces & Templates

```text
[File layout, schema, signature, or template]
```

## Edge Cases & Error Handling

- **[Condition]**: [Expected behavior, message, or exit code]

## Acceptance Criteria

- [ ] [Command and expected result, file that must exist, exit code, or count] (FR1)
- [ ] [Checkable result] (FR2)
````
