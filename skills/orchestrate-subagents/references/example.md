# Example

A complete `plan_only` pair for a small real task. It is illustrative: copy the shape, not the wording.

## The Request

> Plan how to make CI and a pre-commit hook fail when `skills/` changes without a version bump in `.claude-plugin/plugin.json`. Don't run anything yet. Don't touch branch protection without asking me.

Why it is shaped this way:

- "Don't run anything yet" makes the mode `plan_only`.
- The shared check script and the CI workflow need the same context (git diff, version comparison), so they share Batch 1.
- The hook and its README note call the script, so Batch 2 depends on Batch 1. The dependency also serializes them if a later edit touches both.
- Branch protection is a settings change behind an approval. It gets its own inline batch, never merged into a writing batch.
- Writing the hook is too small to pay for its own agent, but it shares context with the README note, so the two run together.

## `docs/woz-plans/version-bump-ci-plan.md`

````markdown
# Version Bump Enforcement Execution Plan

## Overall Goal

Fail CI and local commits when `skills/` changes without a strictly higher `version` in `.claude-plugin/plugin.json`.

## Operating Mode and Authorization

- **Mode**: `plan_only`
- **Verbatim Restrictions**:
  - "Don't run anything yet."
  - "Don't touch branch protection without asking me."
- **Approvals Required**: making the CI check required in branch protection for `main`
- **Assumptions**:
  - The default branch is `main`; change the workflow trigger if not.
  - Versions are plain `MAJOR.MINOR.PATCH`, so `sort -V` compares them correctly.
- **Open Questions**:
  - The requirements name no script path; the plan uses `scripts/check-version-bump.sh`.

## Context Manifest

Version 1.

- **C1**: `.claude-plugin/plugin.json` - holds `version`
- **C2**: `README.md` section "Updating" - where the hook setup note goes
- **C3**: `version-bump-enforcement.v2.md` - the requirements

## Batches

### Batch 1: Version Comparison and CI

- **Agent**: general-purpose, standard, worktree: no
- **Write Keys**: `scripts/check-version-bump.sh`, `.github/workflows/version-check.yml`
- **Target Context**: C1, C3 sections "Option 1" and "Option 2"
- **Dependencies**: none
- **Acceptance Criteria**:
  - `bash scripts/check-version-bump.sh origin/main HEAD` exits 1 on a branch that edits `skills/` without a bump, and 0 after a bump.
  - The workflow runs on `pull_request` and on `push` to `main`, and calls the script.
- **Instructions**:
  - Write the script: list changed paths between two refs, and when any is under `skills/`, compare the two `version` values with `sort -V`; exit 1 unless the head version is strictly greater.
  - Write the workflow to check out with full history and run the script against the base ref.
- **Returns**: both paths and the two acceptance results

### Batch 2: Pre-commit Hook and Setup Note

- **Agent**: inline
- **Write Keys**: `.githooks/pre-commit`, `readme.md`
- **Target Context**: C2, output of Batch 1
- **Dependencies**: Batch 1
- **Acceptance Criteria**:
  - Committing a staged `skills/` change without a bump fails with a message naming the required bump.
  - README tells contributors to run `git config core.hooksPath .githooks` and mentions `--no-verify` for emergencies.
- **Instructions**:
  - Write the hook to call the Batch 1 script against the staged tree and `HEAD`.
  - Add the setup note to the README "Updating" section.

### Batch 3: Branch Protection

- **Agent**: inline, standard
- **Approval**: making the version check required on `main`
- **Write Keys**: `resource:branch-protection-main`
- **Target Context**: workflow job name from Batch 1
- **Dependencies**: Batch 1
- **Acceptance Criteria**:
  - The version check is listed as a required status check on `main`.
- **Instructions**:
  - Ask the user to approve the change, naming the check.
  - On approval, add the check to the required status checks for `main`.

## Final Review

- **Agent**: fresh general-purpose agent that wrote no batch
- **Target Context**: outputs of all batches, the Acceptance Criteria above, the Verbatim Restrictions
- **Instructions**:
  - Verify an unbumped `skills/` change fails both the hook and the script.
  - Verify a bumped change passes both.
  - Confirm branch protection changed only after the user approved it.
  - Confirm the result meets the Overall Goal.
  - Report each finding as blocking or non-blocking, with the owning batch.
````

## `docs/woz-plans/version-bump-ci-execute.md`

```markdown
# Execute: Version Bump Enforcement

- **Plan Source**: `docs/woz-plans/version-bump-ci-plan.md`
- **Execution Mode**: `plan_and_execute`. Running this file authorizes the work in the plan, within its Verbatim Restrictions and Approvals Required.

## Execution Loop

1. **Load.** Read the plan source in full. Enforce its Verbatim Restrictions, Approvals Required, and Write Keys. Stop and ask if the plan is missing or the checker reports findings.
2. **Dispatch.** Start every batch whose dependencies are verified and whose Approval, if any, the user has given in this session; ask for a pending approval and hold that batch until the answer. Hold its write keys while it runs. Run independent batches at the same time within host limits. Give each agent only its batch: goal, cited Context Manifest excerpts, write keys, acceptance criteria, instructions, and what to return.
3. **Validate.** Check each batch's acceptance criteria before releasing its dependents. On failure, retry at most twice with a targeted fix to the brief, never replaying a confirmed side effect, then stop and report.
4. **Review.** Run the Final Review with a fresh agent that wrote no batch. Send each blocking finding to the owning batch, then re-verify it and its dependents.
5. **Report.** Give each batch's status, the review verdict, changed paths, and any approval still pending.
```
