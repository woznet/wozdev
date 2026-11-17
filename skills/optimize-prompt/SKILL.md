---
name: optimize-prompt
description: 'Rewrites and drafts prompts for language models so they are well structured, clearly explained, to the point, and economical with tokens. Use when asked to optimize, tighten, shorten, compress, clean up, restructure, review, or write a prompt - system prompts, agent or subagent instructions, skill bodies (SKILL.md), CLAUDE.md or AGENTS.md instruction files, prompt templates, or one-off prompts - and when a prompt is too long, too expensive, repetitive, vague, or being ignored by the model. Covers cutting filler and duplication, ordering sections, choosing prose, lists, tables, or tags, keeping the reasons that make rules work, compact data formats, cache-friendly ordering, and measuring before/after size with a bundled script. Not for prose aimed at human readers, for tuning API parameters or choosing models, or for building evaluation suites.'
---

# Optimize Prompt

Rewrite or draft a prompt so the model reading it gets everything it needs and nothing else.

**Core rule:** every token must change what the reader does. Keep the task, the situation, the constraints, the reasons behind non-obvious rules, and the output format. Cut what repeats, flatters, hedges, or tells the model what it would do anyway. Shorter is the result, not the goal: a prompt that loses a needed fact costs more than the tokens it saved.

## Quick Reference

| Topic | Do | Don't |
| --- | --- | --- |
| Opening | State the task and the situation in the first lines | Greetings, "You are a helpful assistant", announcing that this is a prompt |
| Instructions | One statement per behavior, placed where it applies | The same rule in the intro, the body, and a "remember" footer |
| Reasons | A short reason beside any rule that is not self-evident | Bare commands, or a paragraph of justification |
| Wording | Plain full sentences addressed to the reader ("Return the ID") | "I would like you to please make sure that you..."; telegraphic shorthand |
| Positive form | Say what to do ("Answer in prose") | Only what to avoid ("No bullets"), unless the prohibition is the point |
| Emphasis | A calm statement, once | Capitals, "CRITICAL", "!!!", repeated warnings |
| Specifics | Numbers, names, formats ("under 100 words", "ISO 8601 dates") | "brief", "appropriate", "high quality" |
| Structure | Headings or tags for long prompts and reference material; prose for behavior and trade-offs | Headings on a five-line prompt; nested bullets that fragment reasoning |
| Examples | Few, varied, minimal, labeled as illustrative | One example the model will copy; several near-identical ones |
| Data | Compact forms with keys stated once (table, CSV) | Pretty-printed JSON repeating every key per record |
| Order | Stable content first, variable inputs last, the question after long documents | A timestamp or user data at the top of a reused prompt |
| Output | State format, length, and what to leave out | Leaving the shape to chance, then adding "be concise" three times |
| Rare detail | Move it to a file the reader loads on demand | Everything inline "just in case" |

## Workflow: Optimize an Existing Prompt

1. **Read all of it and establish the job.** Who reads it (which model or agent, with what else in context), what it must produce, and which failures the author is guarding against. If the purpose is unclear, ask before rewriting.
2. **Measure the baseline.** Save the original to a file and run the script (see Measure). Keep that file unchanged for the comparison.
3. **Inventory what must survive.** List every distinct instruction, fact, constraint, and exact string (tool names, placeholders such as `{{input}}`, output schemas, quoted text). This list is the contract for the rewrite.
4. **Cut.** Remove duplication, filler, hedging, instructions the model follows by default, and stale or contradictory rules. Use `references/token-economy.md` for the catalog of cuts and what each saves.
5. **Restructure.** Order and format the survivors using `references/structure.md`: purpose first, behavior next, reference material after, variable inputs last.
6. **Clarify.** Replace vague words with specifics, add the missing reason to any rule the reader would have to guess the purpose of, and resolve conflicts between rules by stating which one wins. This step may add tokens; that is correct.
7. **Verify against the inventory.** Every item is present, or dropped on purpose with a reason. Exact strings are unchanged character for character. Then read the rewrite as the recipient would, with nothing but the page: could a capable reader with no other context do the task well?
8. **Measure again and report:** the rewritten prompt, the before and after sizes, each thing dropped or changed in meaning, and any ambiguity the author must decide. Never change behavior silently.

## Workflow: Write a New Prompt

1. Collect the task, the reader, the inputs it will receive, what a good result looks like, and the output format. Ask for whatever is missing and would change the prompt.
2. Draft in the order from `references/structure.md`, spending words on the judgment calls where a capable newcomer would go wrong, not on what any competent reader does unprompted.
3. Run steps 6-8 of the optimize workflow on the draft.

## Measure

```bash
pwsh -NoProfile -File <skill-dir>/scripts/Measure-Prompt.ps1 -Path ./prompt.md
```

- Reports characters, words, lines, an estimated token count, and counts of flagged wording.
- Add `-Baseline ./original.md` to report tokens saved and the percentage.
- To measure several files in one run, list them without `-Path`: `... Measure-Prompt.ps1 a.md b.md`.
- Add `-Findings` to list each flagged phrase with its line number instead of the summary: `Filler` (phrases that usually carry no instruction), `Emphasis` (capitalized intensifiers, repeated `!`), and `Duplicate` (a line repeated verbatim).
- The token count is characters divided by `-CharsPerToken` (default 4). Tokenizers differ by model and content, so use it to compare versions, not to predict a bill. Use the provider's token counter when an exact number matters.
- A flagged line is a candidate, not a verdict. "Never" in a real prohibition and "please" in a customer-facing template can both be right.

## References

Read on demand - do not load all up front.

| File | Read when you need |
| --- | --- |
| `references/structure.md` | Section order, when to use prose, lists, tables, or tags, and notes per prompt type (system prompt, agent brief, skill, template) |
| `references/token-economy.md` | The catalog of cuts ranked by saving, what never to cut, compact data formats, and cache-friendly ordering |
| `references/examples.md` | Before/after rewrites, including one where the right fix makes the prompt longer |
| `scripts/Measure-Prompt.ps1` | The measuring script (run it; reading it is optional) |

## Gotchas

- **Do not compress into shorthand.** Dropping articles and connectives, or writing arrows and private abbreviations, saves a few percent and forces the reader to reconstruct the meaning. Cut whole sentences that carry nothing; leave the remaining sentences whole.
- **Keep the reason.** "Never use ellipses" works worse than "This is read aloud by a text-to-speech engine, so avoid ellipses - it cannot pronounce them." A clause of reasoning lets the reader handle cases the rule did not list.
- **Do not delete what you do not understand.** An odd-looking instruction is often a patch for an observed failure. Keep it or ask; do not judge it redundant by appearance.
- **Remove emphasis instead of matching it.** Capitals and "CRITICAL" make a model apply the rule too broadly and rigidly. If one rule needs to stand out, state it plainly and give its reason.
- **Examples are the strongest signal in a prompt.** The reader copies their length, tone, and wording. Use several that differ in meaningful ways and say they are illustrative, or describe the qualities wanted in prose.
- **Fix a conflict, do not preserve it.** Two rules that pull against each other with no priority make the reader guess. Ask the author which wins, then say so in the prompt.
- **Preserve exact strings.** Placeholders, tool and field names, schemas, and quoted text are an interface. Rewording them breaks the caller.
- **Order affects cost.** Providers that cache prompts match on the unchanged prefix, so anything that varies per call (date, user name, the query) belongs at the end.
- **Do not optimize the wrong layer.** If most of the tokens are pasted documents or tool output, trimming the instructions barely matters. Measure first, then cut the largest part.
- **Keep the author's voice where the prompt is a template for output.** Text the model will repeat to a user (a greeting, a refusal message) is content, not filler.
