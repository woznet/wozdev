# Markdown Style Guide

The full conventions behind the Quick Reference in `SKILL.md`. Each rule lists the convention, the rumdl rule IDs it maps to, and, where useful, why it matters.

## Headings

- Use ATX headings (`#`, `##`, `###`), never Setext underlines `===` / `---` (MD003).
- Exactly one H1 (`#`) per document - the title (MD025). In many doc systems the H1 is generated from metadata; in that case start the body at `##`.
- A YAML front matter `title:` plus one `#` heading is allowed, not a duplicate H1. This skill's `.rumdl.toml` sets `front-matter-title = ""` under `[MD025]`, which stops rumdl from treating the front matter title as an H1; a genuine second `#` heading in the body still fails.
- Never skip a level: `##` may be followed by `###`, not `####` (MD001).
- Put a space after the hash marks and none before the text: `## Title` (MD018 / MD019).
- Surround every heading with a blank line above and below (MD022).
- No trailing punctuation such as `:` in a heading (MD026).

## Blank Lines and Spacing

- One blank line around headings, lists, fenced code blocks, and tables (MD022 / MD031 / MD032).
- Collapse runs of blank lines to a single blank line (MD012).
- End the file with exactly one trailing newline (MD047).

## Lists

- Use a single, consistent bullet marker - prefer `-` (MD004).
- Indent nested list items by 2 spaces so they align under the parent text (MD007).
- Use `1.` for every ordered item, or count `1.`, `2.`, `3.` - keep one style and do not restart unexpectedly (MD029).
- Exactly one space after the list marker (MD030).
- A blank line separates a list from surrounding paragraphs (MD032).

## Code

- Use fenced code blocks (triple backticks), not indented code (MD046).
- Tag every fence with a language; use `text` for plain output (MD040).
- Keep the fence style consistent - prefer backticks over tildes (MD048).
- Do not prefix shell examples with `$` when you also show output (MD014).

## Links and Images

- Never leave a bare URL in prose; wrap it as `<https://example.com>` or `[label](https://example.com)` (MD034).
- Write descriptive link text - never "click here" or "this link".
- No spaces inside link or image brackets/parens (MD039).
- Always provide meaningful alt text for images (MD045).
- Reference-style links must resolve to a defined label (MD052) and every defined reference should be used (MD053).

## Emphasis

- Do not use bold or italic text as a substitute for a heading (MD036).
- No spaces just inside emphasis markers: `**bold**`, not `** bold **` (MD037).
- Keep one consistent style for emphasis (`_italic_`) and strong (`**bold**`)
  (MD049 / MD050).

## Whitespace

- No trailing spaces at the end of lines (MD009). A deliberate two-space line break is the rare exception - prefer a real blank line instead.
- No hard tabs; indent with spaces (MD010).

## Tables

- Include a header row and a delimiter row (`| --- | --- |`).
- Keep the pipe count consistent across every row (MD056).
- Surround the table with blank lines (MD058).

## Line Length

- MD013 is **disabled**. Do not hard-wrap prose to a column limit, and never break a table row, URL, or code line to satisfy one. Let the editor soft-wrap.
- To re-enable it for a project, drop `"MD013"` from `disable` in `.rumdl.toml` and add `[MD013]` with `line-length`, `code-blocks = false`, `tables = false`.

## Accessibility

- Maintain a logical heading order so screen readers can build an outline
  (one H1, no skipped levels).
- Give every image alt text that conveys its meaning; use empty alt text only for
  purely decorative images.
- Use descriptive link text that makes sense out of context.
