# Plan Template

Copy the template below into `docs/woz-plans/<name>-plan.md` and replace every bracketed placeholder. The headings and the bold field labels are the format the checker reads, so keep them exactly as written.

## Format Rules

- Level-2 headings, in this order: `Overall Goal`, `Operating Mode and Authorization`, `Context Manifest`, `Batches`, `Final Review`.
- Each batch is a level-3 heading `### Batch <number>: <shared context or tool area>`, numbered from 1 with no repeats.
- Every batch has five fields as top-level list items: `**Write Keys**`, `**Target Context**`, `**Dependencies**`, `**Acceptance Criteria**`, `**Instructions**`. Each needs a value on the same line or an indented list under it.
- `**Write Keys**` holds backticked keys or `none`. `**Dependencies**` holds `none` or `Batch <number>` references.
- `**Mode**` holds `` `plan_only` `` or `` `plan_and_execute` ``.
- Optional per-batch fields: `**Agent**` (agent type, model tier, worktree; `inline` alone when the orchestrator runs the batch itself), `**Approval**` (the user's yes this batch waits for), and `**Returns**` (what the report contains).
- Model tier is `small` (mechanical work), `standard`, or `strongest` (design, review); the host maps it to a model.

## Template

````markdown
# [Task Name] Execution Plan

## Overall Goal

[One sentence: the final outcome and its deliverables.]

## Operating Mode and Authorization

- **Mode**: `plan_only`
- **Verbatim Restrictions**:
  - "[User constraint, copied exactly]"
- **Approvals Required**: [Actions that need the user's yes before they run, or none]
- **Assumptions**:
  - [Reversible assumption, and how to undo it if wrong]
- **Open Questions**:
  - [Gap or contradiction in the source, and the assumption used until it is answered, or none]

## Context Manifest

Version 1.

- **C1**: `[path or URL]` - [why it matters]
- **C2**: `[path or URL]` - [why it matters]

## Batches

### Batch 1: [Shared Context or Tool Area]

- **Agent**: [Explore | general-purpose | inline], [small | standard | strongest], [worktree: yes | no]
- **Approval**: [what the user must approve before this batch runs, or none]
- **Write Keys**: `[repo/relative/path.md]`
- **Target Context**: C1, C2 lines [x-y]
- **Dependencies**: none
- **Acceptance Criteria**:
  - [Command and its expected result, or a file that must exist]
- **Instructions**:
  - [Imperative action]
  - [Imperative action]
- **Returns**: [Changed paths and the result of each acceptance check]

### Batch 2: [Shared Context or Tool Area]

- **Agent**: [type], [model], [worktree]
- **Write Keys**: `[another/path/]`
- **Target Context**: C2, output of Batch 1
- **Dependencies**: Batch 1
- **Acceptance Criteria**:
  - [Deterministic check]
- **Instructions**:
  - [Imperative action]

## Final Review

- **Agent**: fresh general-purpose agent that wrote no batch
- **Target Context**: outputs of all batches, the Acceptance Criteria above, the Verbatim Restrictions
- **Instructions**:
  - Verify [specific success criterion 1].
  - Verify [specific success criterion 2].
  - Confirm no unresolved side effects and no action ran without its required approval.
  - Confirm the result meets the Overall Goal.
  - Report each finding as blocking or non-blocking, with the owning batch.
````
