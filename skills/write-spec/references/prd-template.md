# PRD Template

Copy the template below into `docs/woz-docs/spec-dev/<slug>/PRD.md` and replace every bracketed placeholder.

## Format Rules

- One level-1 heading: the feature or skill name followed by `PRD`.
- Level-2 headings, in this order: `Objective`, `Target Audience`, `Core Use Cases`, `Functional Requirements`, `Non-Functional Requirements`, `Out of Scope`, `Key Risks & Trade-offs`, then `Assumptions & Open Questions` only when there are any.
- `Objective` is one or two sentences: the outcome and its value.
- Number functional requirements `FR1`, `FR2`, ... and non-functional ones `NFR1`, `NFR2`, ... as bold labels; the SPEC cites these IDs, so never renumber an existing spec's requirements.
- Each requirement is one testable statement starting with an imperative verb; state what, not how.
- Each Assumptions & Open Questions item names the gap, then `- assuming:` and the assumption the spec uses until it is answered.
- Use `-` for every bullet and two-space indentation for nested lists.

## Template

````markdown
# [Feature or Skill Name] PRD

## Objective

[One or two sentences: the outcome and why it matters.]

## Target Audience

- [Primary consumer: a person, an agent, a CI job]
- [Secondary consumer]

## Core Use Cases

- [Scenario: who does what, and what they get]
- [Scenario]

## Functional Requirements

- **FR1 [Capability]**: [Imperative, testable requirement]
- **FR2 [Capability]**: [Imperative, testable requirement]

## Non-Functional Requirements

- **NFR1 [Quality attribute]**: [Measurable constraint]

## Out of Scope

- [Thing an implementer might build but should not]

## Key Risks & Trade-offs

- **[Risk]**: [Trade-off or mitigation in one sentence]

## Assumptions & Open Questions

- [Gap or contradiction in the notes] - assuming: [assumption used meanwhile]
````
