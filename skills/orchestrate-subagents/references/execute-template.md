# Execute Template

The execute file is the runtime loop for one plan and nothing more. Every rule, constraint, batch, and check lives in the plan file; repeating one here would let the two files disagree. Copy the template into `docs/woz-plans/<name>-execute.md`, replace `[Task Name]` and `<name>`, and keep the `Plan Source` line pointing at the plan file.

When running a plan in `plan_and_execute` mode without an execute file, follow the same loop.

## Template

```markdown
# Execute: [Task Name]

- **Plan Source**: `docs/woz-plans/<name>-plan.md`
- **Execution Mode**: `plan_and_execute`. Running this file authorizes the work in the plan, within its Verbatim Restrictions and Approvals Required. The plan's own `Mode` line records how the plan was written and does not block this run.

## Execution Loop

1. **Load.** Read the plan source in full. Enforce its Verbatim Restrictions, Approvals Required, and Write Keys. Stop and ask if the plan is missing or the checker reports findings.
2. **Dispatch.** Start every batch whose dependencies are verified and whose Approval, if any, the user has given in this session; ask for a pending approval and hold that batch until the answer. Hold its write keys while it runs. Run independent batches at the same time within host limits. Give each agent only its batch: goal, cited Context Manifest excerpts, write keys, acceptance criteria, instructions, and what to return.
3. **Validate.** Check each batch's acceptance criteria before releasing its dependents. On failure, retry at most twice with a targeted fix to the brief, never replaying a confirmed side effect, then stop and report.
4. **Review.** Run the Final Review with a fresh agent that wrote no batch. Send each blocking finding to the owning batch, then re-verify it and its dependents.
5. **Report.** Give each batch's status, the review verdict, changed paths, and any approval still pending.
```
