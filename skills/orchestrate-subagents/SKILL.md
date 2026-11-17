---
name: orchestrate-subagents
description: 'Plans and runs complex, multi-part tasks as batches of sub-agent work at the lowest token cost that keeps the result correct. Use when asked to orchestrate, delegate, fan out, parallelize, or plan sub-agent or multi-agent work, to split a large task across agents, or to write a plan file that another session will execute. Decides whether delegation pays at all, groups steps that share context and tools into batches, orders them as a dependency graph, gives every file or resource exactly one writer, and ends with an independent review. Writes docs/woz-plans/<name>-plan.md, plus a trim <name>-execute.md in plan-only mode, and validates the plan with a bundled checker. Not for single-step tasks, for writing a prompt (use optimize-prompt), or for line-by-line implementation plans of one feature.'
---

# Orchestrate Sub-Agents

Turn a large task into the fewest, cheapest batches of sub-agent work that still finish it correctly, then run them or hand them off.

**Priority order:** authorization, privacy, and correctness first; required quality and evidence second; token cost last. A cheaper plan that skips an approval or loses a needed fact is wrong.

**Core idea:** every sub-agent starts cold and must be told everything it needs. Spawns cost tokens, so delegate only work that pays for its spawn, group steps that need the same context into one batch, and pass each batch only its excerpts.

## Modes

| Mode | Writes | Side effects |
| --- | --- | --- |
| `plan_only` | `docs/woz-plans/<name>-plan.md` and `docs/woz-plans/<name>-execute.md` | None. At most read-only exploration to build the plan |
| `plan_and_execute` | `docs/woz-plans/<name>-plan.md` | Dispatches the batches the user authorized |

A `plan_only` plan still describes every batch, including ones that create files or change settings; it only runs none of them. Write the plan files with the file-write tool, not a shell heredoc.

Use `plan_only` unless the user clearly authorized execution ("plan and run it", "go ahead and do it"). When authority is ambiguous, choose `plan_only` and say so. Invoking this skill in `plan_and_execute`, or running an execute file, is the user's request to spawn sub-agents; `plan_only` spawns none except read-only exploration.

**Name:** kebab-case, 2-4 words, task noun first (`version-bump-ci`). Never overwrite an existing plan; add `-2`, `-3`.

**Host plan mode:** if the host restricts writes to its own plan file, put the plan content there, and write the `docs/woz-plans/` files once the host plan is approved.

## Workflow

1. **Capture the request.** Record the goal and concrete deliverables. Copy every restriction, approval boundary, and do-not-send instruction verbatim; these go in the plan unchanged.
2. **Clarify only what blocks.** Ask one focused question when missing information prevents a safe decomposition (who may be contacted, which branch, what "done" means). Otherwise record a reversible assumption in the plan. Gaps or contradictions in the source material that do not block planning go under Open Questions, each with the assumption the plan uses meanwhile.
3. **Decompose.** List the distinct steps, the deliverable each serves, and what each depends on. Mark unresolved prerequisites. Reject cycles by splitting or reordering steps.
4. **Apply the cost gate.** Decide per step whether it runs inline (by the orchestrator) or in a sub-agent, using `references/batching-rules.md`. A plan with one batch, or with every step inline, is valid.
5. **Cluster into batches.** Merge steps whose context and tools largely overlap, but only when every hard gate in `references/batching-rules.md` passes. Assign each batch its write keys.
6. **Write the plan** from `references/plan-template.md`: Context Manifest, batches with dependencies, write keys, acceptance criteria, and the Final Review. Imperative verbs, no filler. In `plan_only`, also write the execute file from `references/execute-template.md`. It holds no rules of its own, only the runtime loop, so the two files cannot drift.
7. **Check the plan** with the bundled checker (see Check) and fix every finding.
8. **Execute** (`plan_and_execute` only). Follow the loop in `references/execute-template.md`: run ready batches in dependency order, hold each batch's write keys, verify acceptance before releasing dependents, retry a failed batch at most twice with a targeted fix, then escalate. Never replay a confirmed side effect.
9. **Review.** Give the Final Review to a fresh agent that wrote none of the batches. Pass it the acceptance checklist and the artifacts, not the writers' reasoning. Route each blocking finding back to the owning batch, then re-verify it and its dependents.
10. **Report** the plan path (and execute path), each batch's status, the review verdict, and any approval still pending.

## Writing Batch Briefs

A batch's instructions are the whole world of the agent that runs it. For each one:

- State the goal, the deliverable, and how the batch knows it is done.
- Cite Context Manifest entries by ID, with the line ranges or excerpt needed, instead of pasting shared material into every batch.
- Name the write keys the batch owns, and say that every other path is read-only.
- Give acceptance criteria a reviewer can check without judgment: a command and its expected result, a file that must exist, a count.
- Say what to return: a short report of what changed, where, and what was verified, not a transcript.

## Check

Two equivalent scripts give the same findings. Use PowerShell when it is installed:

```bash
pwsh -NoProfile -File <skill-dir>/scripts/Test-OrchestrationPlan.ps1 docs/woz-plans/<name>-plan.md
```

Otherwise use bash (Linux, Git Bash, WSL):

```bash
bash <skill-dir>/scripts/test-orchestration-plan.sh docs/woz-plans/<name>-plan.md
```

- `<skill-dir>` is this skill's base directory. Quote paths that contain spaces.
- It checks the required sections and the mode, the fields in every batch, unknown or self dependencies, dependency cycles, write keys held by two batches with no dependency path between them, and, in `plan_only`, that the execute file exists and names the plan.
- It prints `path:line: error: message` per finding and exits 1, or prints `OK` and exits 0. Exit 2 means bad arguments or a missing file.

## Rules That Are Easy to Get Wrong

- **One writer per key.** Two batches that write the same file or resource must be connected by a dependency, so they run one after the other. Parallel batches that must edit overlapping trees each run in their own git worktree and merge afterward.
- **Do not merge across authority.** A batch that only reads must not absorb a step that sends, publishes, deletes, or spends, even when the context matches; keep the side effect in its own batch behind its approval.
- **Do not merge across privacy.** Material one batch may see but another may not stays in separate batches.
- **Context has a ceiling.** If a merged batch's context would crowd out room to work, split it, even though splitting costs a second spawn.
- **Review is not optional.** Every plan ends with the Final Review, including single-batch plans.

## References

| File | Read when |
| --- | --- |
| `references/batching-rules.md` | Deciding inline versus delegated, merging steps, assigning write keys, choosing worktrees and models |
| `references/plan-template.md` | Writing the plan file; it defines the format the checker reads |
| `references/execute-template.md` | Writing the execute file, or running a plan |
| `references/example.md` | Seeing a complete small plan and execute pair |
