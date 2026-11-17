# Batching Rules

How to decide what runs inline, what becomes a sub-agent batch, which steps share a batch, and who owns each write.

## Inline or Delegate

A sub-agent starts with none of the orchestrator's context. Its brief, the files it re-reads, and its report all cost tokens, so delegation pays only when it saves more than that.

| Run inline when | Delegate when |
| --- | --- |
| The step is a few tool calls (one edit, one search, one command) | The step needs wide reading whose detail the orchestrator does not need back, only the conclusion |
| The orchestrator already holds the context the step needs | The step can run in parallel with other work and the wall-clock saving matters |
| The step is tightly coupled to the next decision the orchestrator makes | The step benefits from a fresh, unbiased reader (review, verification) |
| The brief would be longer than the work | The step needs a different tool set, model, or isolation (worktree) |

Small or tightly coupled tasks may end with every step inline and only the Final Review delegated. That is a valid plan. Inline batches cost no spawn, so split them by deliverable and dependency for clear acceptance checks; merging them saves nothing.

## Merging Steps into a Batch

Merge two steps when they would load mostly the same context, so that one agent reads it once. Signals that they overlap enough:

| Signal | Merge | Keep apart |
| --- | --- | --- |
| Files, URLs, or data read | Same set, or one is a subset of the other | Mostly different |
| Tools and skills needed | Same | One needs a tool or skill the other must not have |
| Output | Feeds the same deliverable | Separate deliverables with separate reviewers |
| Sequencing | One step's output is the other's only input | Independent and worth running in parallel |

A merge is allowed only when every hard gate passes:

1. **Authority.** Both steps fall under the same approval. A read-only step never shares a batch with one that sends, publishes, deletes, pays, or changes settings. Anything beyond editing files in the working tree needs its own approval: remote state (pushes, PRs, branch protection, issues), local configuration (`git config`, hooks enabled, installs), and messages to anyone. Give each such step its own batch with an `**Approval**` field.
2. **Privacy.** Neither step needs material the other must not see.
3. **Skills and tools.** The merged batch needs no tool or skill that either step must not use.
4. **Write keys.** The merged batch can hold all of its keys without colliding with a batch that runs in parallel to it.
5. **Context capacity.** The merged context, plus room to work and report, fits comfortably in one agent. When in doubt, split.
6. **Dependencies.** The merge creates no cycle.

## Write Keys

A write key names something a batch creates or changes.

- Files: repo-relative path, forward slashes, lowercase, no leading `./`, in backticks: `` `skills/foo/skill.md` ``. A trailing `/` claims a whole tree: `` `docs/woz-plans/` ``.
- Other resources: `` `resource:<system>-<object>` `` in kebab-case, for example `` `resource:github-pr` ``, `` `resource:github-branch-protection-main` ``, or `` `resource:git-config-core-hookspath` ``. Use the same name everywhere the resource appears, because the checker compares keys as text.
- A batch that writes nothing lists `none`.

Two batches may hold the same key, or overlapping keys (a tree and a file in it), only when one depends on the other directly or through a chain, so they never run at the same time. Parallel batches that must touch overlapping trees each run in their own git worktree, with a merge step that owns the shared keys afterward.

## Context Manifest

List every shared source once in the plan's Context Manifest with an ID (`C1`, `C2`, ...) and a one-line note on why it matters. Batches cite IDs and narrow them (`C2 lines 40-90`, `C4 section "Auth"`). Bump the manifest's version line when a source changes mid-run, so a batch can tell whether its excerpt is stale.

## Agents, Models, and Concurrency

- Read-only searching goes to an exploration agent; writing goes to a general-purpose agent.
- Use the `small` tier for mechanical batches (search, rename, format) and keep the strongest model for design and review.
- Run independent batches at the same time within the host's limits; when the host gives no limit, keep it under five agents at once.
