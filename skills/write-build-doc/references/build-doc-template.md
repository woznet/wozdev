# Build Doc Template

Copy the template below into `docs/woz-docs/build/<name>-build.md` and replace every bracketed placeholder.

## Format Rules

- One level-1 heading: the feature or component name.
- Level-2 headings, in this order: `Overall Goal`, `Build Checklist`, one section per option or component, then `Open Questions` only when there are any.
- `Overall Goal` is one or two sentences.
- `Build Checklist` is a flat `- [ ]` task list, in build order, each item starting with an imperative verb.
- Each option or component section has three top-level list items, in this order: `**Intent**`, `**Implementation Guidelines**`, `**Done When**`. Intent takes a value on the same line; the other two take an indented list.
- An option the user has not chosen yet gets `(option)` after its heading name, such as `## Polling Loop (option)`.
- Each Open Questions item names the gap, then `- assuming:` and the assumption the doc uses until it is answered.
- Use `-` for every bullet and two-space indentation for nested lists.

## Template

````markdown
# [Feature or Component Name]

## Overall Goal

[One or two sentences: the final outcome.]

## Build Checklist

- [ ] [Imperative step 1]
- [ ] [Imperative step 2]

## [Option or Component 1 Name]

- **Intent**: [What this achieves and why, including any hard gate.]
- **Implementation Guidelines**:
  - [Imperative step with a concrete path, command, condition, or exit code]
  - [Imperative step]
- **Done When**:
  - [Command and expected result, file that must exist, or count]

## [Option or Component 2 Name]

- **Intent**: [What this achieves and why.]
- **Implementation Guidelines**:
  - [Imperative step]
- **Done When**:
  - [Checkable criterion]

## Open Questions

- [Gap or contradiction in the notes] - assuming: [assumption used meanwhile]
````
