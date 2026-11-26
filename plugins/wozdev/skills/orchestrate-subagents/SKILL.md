---
name: orchestrate-subagents
description: 'Plans, and when authorized runs, a large multi-part task as batches of sub-agent work, saved as a PLAN.md under docs/woz-docs/spec-dev/. Use when asked to orchestrate, delegate, fan out, parallelize, or plan sub-agent or multi-agent work, to split a large task across agents, or to write a plan file that another session will execute. Not for single-step tasks, for writing a prompt (use optimize-prompt), or for line-by-line implementation plans of one feature.'
---

# Orchestrate Sub-Agents

Turn a large task into the fewest, cheapest batches of sub-agent work that still finish it correctly, then run them or hand them off.

**Priority order:** authorization, privacy, and correctness first; required quality and evidence second; token cost last. A cheaper plan that skips an approval or loses a needed fact is wrong.

**Core idea:** every sub-agent starts cold and must be told everything it needs. Spawns cost tokens, so delegate only work that pays for its spawn, group steps that need the same context into one batch, and pass each batch only its excerpts.

## Modes

| Mode | Writes | Side effects |
| --- | --- | --- |
| `plan_only` | `PLAN.md` and `EXECUTE.md` | None. At most read-only exploration to build the plan |
| `plan_and_execute` | `PLAN.md` | Dispatches the batches the user authorized |

A `plan_only` plan still describes every batch, including ones that create files or change settings; it only runs none of them.

Use `plan_only` unless the user clearly authorized execution ("plan and run it", "go ahead and do it"). When authority is ambiguous, choose `plan_only` and say so. A `plan_and_execute` request, or a request to run an execute file, is the user asking for sub-agents to be spawned. `plan_only` spawns none, apart from read-only exploration.

## Output

- **Paths:** `docs/woz-docs/spec-dev/<slug>/PLAN.md` and, in `plan_only`, `docs/woz-docs/spec-dev/<slug>/EXECUTE.md`, relative to the repository root. Create the folders if needed. Write with the file-write tool, not a shell heredoc.
- **Slug:** kebab-case, 2-4 words, task noun first (`version-bump-ci`). When the input is a `SPEC.md` or `BUILD.md` under `docs/woz-docs/spec-dev/<slug>/`, reuse that slug and write beside it. Otherwise, if `<slug>/PLAN.md` exists, use `<slug>-2`, `-3`. Update an existing `PLAN.md` in place only when the user asks for that plan to change; read it and its `EXECUTE.md` first.
- **Format:** exactly the structures in `references/plan-template.md` and `references/execute-template.md`.
- **Chat reply:** what Workflow step 10 lists. No summary of the plan.

**Host plan mode:** if the host restricts writes to its own plan file, draft the plan there, and write `docs/woz-docs/spec-dev/<slug>/` once the host plan is approved.

## Workflow

1. **Capture the request.** Record the goal and concrete deliverables. Copy every restriction, approval boundary, and do-not-send instruction verbatim; these go in the plan unchanged. An instruction that only chooses the mode ("don't run anything yet", "plan only") sets the Mode and is not copied as a restriction, because the session that later runs the execute file must obey every restriction.
2. **Clarify only what blocks.** Ask one focused question when missing information prevents a safe decomposition (who may be contacted, which branch, what "done" means). Otherwise record a reversible assumption in the plan. Gaps or contradictions in the source material that do not block planning go under Open Questions, each with the assumption the plan uses meanwhile.
3. **Decompose.** List the distinct steps, the deliverable each serves, and what each depends on. Mark unresolved prerequisites. Reject cycles by splitting or reordering steps.
4. **Apply the cost gate.** Decide per step whether it runs inline (by the orchestrator) or in a sub-agent, using `references/batching-rules.md`. A plan with one batch, or with every step inline, is valid.
5. **Cluster into batches.** Merge steps whose context and tools largely overlap, but only when every hard gate in `references/batching-rules.md` passes. Assign each batch its write keys.
6. **Write the plan** from `references/plan-template.md`: Context Manifest, batches with dependencies, write keys, acceptance criteria, and the Final Review. Imperative verbs, no filler. In `plan_only`, also write `EXECUTE.md` from `references/execute-template.md`. It holds no rules of its own, only the runtime loop, so the two files cannot drift.
7. **Check the plan** with the bundled checker (see Check) and fix every finding, then lint both files with rumdl as the `writing-markdown` skill describes (`rumdl check --color never --no-cache --fix`, plus `--disable MD013` when the repository has no `.rumdl.toml`) until zero violations remain. If rumdl is missing and cannot be installed, say so in the report.
8. **Execute** (`plan_and_execute` only). Follow the loop in `references/execute-template.md`; it sets dispatch order, write-key holding, acceptance checks, and the retry limit.
9. **Review.** Give the Final Review to a fresh agent that wrote none of the batches. Pass it the acceptance checklist and the artifacts, not the writers' reasoning. Route each blocking finding back to the owning batch, then re-verify it and its dependents.
10. **Report** the plan path (and execute path), each batch's status, the review verdict, any approval still pending, and any Open Questions.

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
pwsh -NoProfile -File <skill-dir>/scripts/Test-OrchestrationPlan.ps1 docs/woz-docs/spec-dev/<slug>/PLAN.md
```

Otherwise use bash (Linux, Git Bash, WSL):

```bash
bash <skill-dir>/scripts/test-orchestration-plan.sh docs/woz-docs/spec-dev/<slug>/PLAN.md
```

- `<skill-dir>` is this skill's base directory. Quote paths that contain spaces.
- It checks the required sections and the mode, the fields in every batch, unknown or self dependencies, dependency cycles, write keys held by two batches with no dependency path between them, and, in `plan_only`, that `EXECUTE.md` sits beside `PLAN.md` and names it.
- It prints `path:line: error: message` per finding and exits 1, or prints `OK` and exits 0. Exit 2 means bad arguments or a missing file.

## Rules That Are Easy to Get Wrong

- **The hard gates outrank token savings.** `references/batching-rules.md` lists them: no merge across an approval or privacy boundary, one writer per key, and a batch's context must leave room to work. A merge that fails any gate is split, even though splitting costs a second spawn.
- **Review is not optional.** Every plan ends with the Final Review, including single-batch plans.

## References

| File | Read when |
| --- | --- |
| `references/batching-rules.md` | Deciding inline versus delegated, merging steps, assigning write keys, choosing worktrees and models |
| `references/plan-template.md` | Writing `PLAN.md`; it defines the format the checker reads |
| `references/execute-template.md` | Writing `EXECUTE.md`, or running a plan |
| `references/example.md` | Seeing a complete small plan and execute pair |
