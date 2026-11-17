# Example

Rough notes in, finished PRD and SPEC out. The notes cover all four pillars, so no questions are asked; the one gap becomes an assumption.

## Input Notes

```text
want a script that finds stale branches so I can clean up the repo.
stale = merged into main and no commits in 30+ days. make the days configurable.
just list them, dont delete anything!! table output, maybe csv too.
powershell 7, run from repo root. remote branches too?
```

## Output

Saved as `docs/woz-docs/spec-dev/stale-branch-report/PRD.md`:

````markdown
# Stale Branch Report PRD

## Objective

List branches that are merged into `main` and inactive for a set number of days, so cleanup decisions take one command instead of manual git archaeology.

## Target Audience

- Repository maintainers running the report before a cleanup.
- Coding agents that need a machine-readable list of cleanup candidates.

## Core Use Cases

- A maintainer runs the report from the repository root and reviews a table of stale branches.
- An agent exports the same list to CSV and proposes deletions for human approval.

## Functional Requirements

- **FR1 Stale detection**: Report a branch only when it is merged into `main` and its last commit is older than the threshold.
- **FR2 Configurable threshold**: Accept the inactivity threshold in days, defaulting to 30.
- **FR3 Table output**: Emit one object per stale branch with name, last commit date, last author, and days inactive.
- **FR4 CSV export**: Write the same rows to a CSV file when a path is given.

## Non-Functional Requirements

- **NFR1 Read-only**: Change no branch, ref, or remote; "dont delete anything".
- **NFR2 Runtime**: Run on PowerShell 7 from a git repository root with only `git` on PATH.

## Out of Scope

- Deleting, archiving, or tagging branches.
- Detecting branches merged into anything other than `main`.

## Key Risks & Trade-offs

- **Squash merges**: Branches merged by squash do not show as merged to `git branch --merged` and are missed; accepted for a read-only first version.

## Assumptions & Open Questions

- Should remote branches be included? - assuming: local branches only; a `-IncludeRemote` switch can come later.
````

Saved as `docs/woz-docs/spec-dev/stale-branch-report/SPEC.md`:

````markdown
# Stale Branch Report Spec

## Constraints & Conventions

- Ship one advanced function, `Get-StaleBranch`, in `scripts/Get-StaleBranch.ps1`, following the `writing-powershell` house style.
- Call only read-only git commands: `git branch --merged`, `git log -1`.
- Run from the repository root; never change the working directory.

## Inputs

- **`-Days`**: `[int]`, optional, default `30`, must be at least 1.
- **`-CsvPath`**: `[string]`, optional, path of a CSV file to write.

## Outputs

- **Pipeline objects**: one `[pscustomobject]` per stale branch with `Branch`, `LastCommit` (`[datetime]`), `Author`, `DaysInactive`.
- **CSV file**: the same objects via `Export-Csv -NoTypeInformation` when `-CsvPath` is given.

## Workflow

1. **Verify repository**: Exit with an error when `git rev-parse --is-inside-work-tree` fails. (NFR2)
2. **List merged branches**: Run `git branch --merged main --format='%(refname:short)'`; drop `main` and the current branch. (FR1)
3. **Read last commit**: For each branch, run `git log -1 --format='%cI|%an' <branch>` and parse date and author. (FR3)
4. **Filter by age**: Keep branches whose last commit is more than `-Days` days before now. (FR1, FR2)
5. **Emit and export**: Output the objects sorted by `DaysInactive` descending; when `-CsvPath` is set, also export them. (FR3, FR4)

## Edge Cases & Error Handling

- **No `main` branch**: Write an error naming the missing branch and exit 1.
- **No stale branches**: Output nothing and exit 0.
- **`-Days` below 1**: Reject through `[ValidateRange(1, [int]::MaxValue)]`.

## Acceptance Criteria

- [ ] In a repository with a branch merged into `main` and last committed 40 days ago, `Get-StaleBranch` returns that branch with `DaysInactive` of at least 40. (FR1, FR3)
- [ ] `Get-StaleBranch -Days 60` does not return that branch. (FR2)
- [ ] `Get-StaleBranch -CsvPath out.csv` creates `out.csv` with one row per returned object. (FR4)
- [ ] `git for-each-ref` output is identical before and after a run. (NFR1)
````
