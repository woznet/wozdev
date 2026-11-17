# Token Economy

Where a prompt's tokens go, which cuts are worth making, and which are false savings.

## Measure Before Cutting

Find the largest part first. In most real prompts the instructions are a small share and pasted documents, examples, tool definitions, or conversation history are the bulk. A 30% trim of a 400-token instruction block is invisible next to a 6,000-token document sent whole when one section was needed.

## Cuts, Largest Saving First

| Cut | What to do | Typical saving | Risk |
| --- | --- | --- | --- |
| Unneeded material | Send the relevant section of a document, not the whole; drop history and tool output the task does not use | Very large | Low if the task is well understood |
| Detail used in few calls | Move it to a reference the reader loads when a stated condition applies | Large | Low; state the condition clearly |
| Verbose data | Convert repeated-key records to a table or CSV; remove pretty-print indentation; drop unused fields | Large on data-heavy prompts | Low |
| Redundant examples | Keep the few that differ meaningfully; trim each to the part that teaches | Medium to large | Medium: fewer examples means less signal, so check output |
| Duplicated instructions | State each rule once, where it applies | Medium | Low |
| Default behavior | Remove instructions the model follows unprompted ("be accurate", "think carefully", "use correct grammar") | Medium | Low |
| Stale or contradictory rules | Delete rules for cases that no longer exist; resolve conflicts | Medium | Confirm with the author |
| Preamble and sign-off | Remove greetings, "you are a helpful assistant", "thank you", restated summaries | Small | None |
| Filler phrases | "in order to" becomes "to"; "it is important to note that X" becomes "X" | Small | None |
| Decorative formatting | Remove bold, rules, and headings that do not aid navigation | Small | None |

Work from the top of the table. The bottom rows make a prompt read better but rarely change its cost much.

## What Never to Cut

- **The goal and what it serves.** A reader who knows the purpose makes the unlisted decisions correctly.
- **Reasons behind non-obvious rules.** A clause of reasoning replaces a list of special cases.
- **Constraints and limits on action**, especially around anything destructive or hard to undo.
- **The output specification.** Unspecified output gets padded, and output tokens usually cost more than input tokens.
- **Exact strings**: placeholders, identifiers, schemas, commands, quoted text.
- **The words that link ideas**: "because", "unless", "so", "only if". They are single tokens that carry the logic.

## False Savings

- **Telegraphic style.** Dropping articles and connectives saves a few percent and makes relationships between ideas ambiguous. Common short words cost one token each; they are the cheapest clarity available.
- **Private abbreviations and symbols.** An invented label costs the reader a guess every time it appears, and unusual symbols or rare strings often split into more tokens than the words they replaced.
- **Removing all examples.** For a format that is hard to describe, one small example is cheaper than the paragraph needed to replace it.
- **Deleting structure from a long prompt.** A handful of headings is a small price for the reader finding the right section.
- **Compressing until the output degrades.** A retry or a wrong answer costs far more than the tokens saved. Test the rewrite on real inputs when the prompt matters.

## Wording Substitutions

| Instead of | Write |
| --- | --- |
| "I would like you to please write" | "Write" |
| "Make sure that you always remember to" | The instruction itself |
| "It is important to note that" | Delete |
| "in order to" | "to" |
| "due to the fact that" | "because" |
| "in the event that" | "if" |
| "a large number of" | "many", or the number |
| "at this point in time" | "now" |
| "Do not under any circumstances ever" | "Do not" plus the reason |
| "The response should be formatted as a JSON object" | "Return JSON:" plus the schema |

## Compact Data

- **Uniform records:** a table or CSV states the field names once. JSON repeats every key in every record.
- **JSON that must stay JSON:** minify it. Indentation and newlines are tokens.
- **Nested or irregular records:** YAML or an indented outline is usually lighter than JSON because it has no braces or quotes around keys.
- **Unused fields:** remove them before sending. Internal IDs, timestamps, and null fields are common dead weight.
- **Long identifiers:** UUIDs, hashes, and URLs split into many tokens. If the task only needs to tell items apart, replace them with short labels and map back afterward.
- **Numbers:** round to the precision the task needs.

## Trimming Examples

- Keep examples that differ in the dimension that matters; drop near-duplicates.
- Shorten each to the smallest input and output that still shows the pattern.
- Say that examples are illustrative, or the reader will copy their length and phrasing.
- If the wanted quality can be stated in a sentence ("one line per item, verb first"), try the sentence alone before adding an example.

## Ordering for Caching

Many providers cache a prompt prefix and bill the cached part at a reduced rate. The cache matches only up to the first character that differs from the previous call.

- Put fixed instructions, tool definitions, and reference documents first, in a stable order.
- Put per-call values (date and time, user details, retrieved passages, the question) after them.
- Do not interpolate a variable into the middle of the fixed text; a changing word near the top discards the cache for everything after it.
- Keep whitespace and ordering identical between calls. Serialize lists and maps in a fixed order.

## Output Is Part of the Budget

A prompt controls how much the model writes back. State the length and shape wanted ("three sentences", "only the changed lines", "JSON, no commentary") and name what to leave out. One precise output instruction often saves more than every wording cut in the prompt.
