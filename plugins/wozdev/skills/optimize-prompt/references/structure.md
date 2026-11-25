# Prompt Structure

How to order a prompt and which format to give each part. The aim is that the reader finds each thing once, in the place it expects it.

## Section Order

Use the parts a prompt needs, in this order. A short prompt may be three sentences that cover the first, third, and fifth parts with no headings at all.

| Order | Part | Contains |
| --- | --- | --- |
| 1 | Purpose | The task, who the output is for, and what a good result looks like |
| 2 | Situation | Background the reader cannot infer: the product, the audience, what has been tried, what is hard about the task |
| 3 | Behavior | How to act, with the reason beside each non-obvious rule; the judgment calls and which side to favor |
| 4 | Constraints | Scope, things not to touch, actions that need confirmation, limits |
| 5 | Output | Format, length, what to include and leave out, where to put it |
| 6 | Reference material | Long documents, schemas, lookup tables, examples |
| 7 | Variable input | The per-call data and the question itself |

Two rules sit above the table:

- **Stable before variable.** Parts 1-6 rarely change between calls; part 7 changes every call. Keeping the changing part last lets prompt caching reuse everything before it.
- **Question after documents.** When the prompt carries long material, put the material first and the instruction or question that uses it after. Readers attend best to what follows the material they just read.

## Choosing a Format

| Content | Format | Why |
| --- | --- | --- |
| Behavior, priorities, trade-offs | Prose paragraphs | Prose keeps the links between ideas ("because", "unless", "which matters more") that bullets drop |
| Steps that happen in sequence | Numbered list | Order is the information |
| Discrete parallel facts (allowed values, file locations) | Bullet list | Easy to scan, nothing to link |
| The same attributes across several items | Table | States the attribute names once |
| Material of a different kind from the instructions (a document, an example, user input) | Delimited block: tags or a fenced block | Stops the reader treating data as instructions and lets the prompt refer to it by name |
| Text to reproduce exactly (a schema, a command, a message) | Fenced code block | Signals "verbatim" |
| A long prompt the reader navigates | Headings | Only when there are enough sections to navigate |

Formatting costs tokens too. Each heading, tag pair, table separator, and bold marker is paid for on every call, so use them where they prevent a misreading, not as decoration. A prompt written in heavy Markdown also pulls the reply toward heavy Markdown; write in the style wanted back.

## Delimiters

- Give each delimited block a name that says what it holds: `<contract>`, `<style_guide>`, `<example>`. Use the same name every time and refer to it in the instructions ("using the contract in the `<contract>` tags").
- Wrap material, not instructions. A tag around every rule adds tokens and no clarity.
- Keep one delimiter convention per prompt. Mixing tags, fences, and "---" rules for the same job makes the reader work out whether the difference means something.

## Notes by Prompt Type

**System prompt.** Describe the deployment: who the users are, what they need, what good service looks like, where the judgment calls fall. A one-line role ("You are a support agent") adds little on its own; the situation does the work. Lead with what applies to every turn and move rare cases to the end or out to a reference.

**Agent or subagent brief.** The recipient starts with nothing but the brief. State the goal and what it serves, what done looks like, what is already known or ruled out, what makes the task hard, the limits on scope and actions, and the shape of the reply. Name file paths, identifiers, and error text exactly; a reference to "the bug we discussed" means nothing to it. Several paragraphs is a normal length.

**Skill or instruction file.** These are loaded into many sessions, so every line is paid for repeatedly. Keep the main file to the core rule, a quick reference, the workflow, and the mistakes worth warning about. Move long rules, catalogs, and examples to reference files and say when to read each one.

**Prompt template.** Mark every variable the same way and place variables after the fixed text where possible. State what each variable will contain if the name does not make it obvious. Check the prompt still reads correctly when a variable is empty or very long.

**One-off prompt.** Usually needs only purpose, the one or two constraints that matter, and the output format. Do not add structure to a request that fits in a paragraph.
