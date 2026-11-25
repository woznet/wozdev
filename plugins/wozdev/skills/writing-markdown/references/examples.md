# Markdown Examples: Before and After

Concrete demonstrations of the style rules. Each pair shows a common AI-generated mistake (Before) and its corrected rewrite (After). The examples are shown inside fenced blocks so they illustrate the syntax without being linted themselves.

## 1. Headings: skipped levels and a second H1

**Before** (two H1s, jumps `##` to `####`):

```markdown
# Project
# Installation
## Setup
#### Notes
```

**After** (one H1, strict hierarchy):

```markdown
# Project

## Installation

### Setup

#### Notes
```

## 2. Spacing: blocks glued together

**Before** (no blank lines around the heading and list):

```markdown
Intro paragraph.
## Features
- Fast
- Portable
Next paragraph.
```

**After** (blank lines surround every block):

```markdown
Intro paragraph.

## Features

- Fast
- Portable

Next paragraph.
```

## 3. Code: untagged or indented blocks

**Before** (indented code, and a bare fence):

````markdown
    npm install

```
const x = 1;
```
````

**After** (fenced with language tags):

````markdown
```bash
npm install
```

```javascript
const x = 1;
```
````

## 4. Lists: mixed markers and bad indentation

**Before** (mixed `*`/`+`, 4-space nesting):

```markdown
* One
+ Two
    * Nested
```

**After** (single `-` marker, 2-space nesting):

```markdown
- One
- Two
  - Nested
```

## 5. Links: bare URL and vague text

**Before**:

```markdown
See https://example.com for details, or click here.
```

**After**:

```markdown
See the [project documentation](https://example.com) for details.
```

## 6. Images: missing alt text

**Before**:

```markdown
![](diagram.png)
```

**After**:

```markdown
![Architecture diagram showing the API and database tiers](diagram.png)
```

## 7. Tables: ragged pipes

**Before** (inconsistent columns, no surrounding blank lines):

```markdown
Text before.
| Name | Role |
| Ada | Engineer | Lead |
```

**After** (aligned header, delimiter, and consistent pipes):

```markdown
Text before.

| Name | Role     |
|------|----------|
| Ada  | Engineer |
```
