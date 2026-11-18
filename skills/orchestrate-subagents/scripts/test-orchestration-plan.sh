#!/usr/bin/env bash
# Checks an orchestration plan file against the orchestrate-subagents plan format.
#
# Shell counterpart of Test-OrchestrationPlan.ps1, for hosts without PowerShell. It runs the same checks
# and prints identical output: missing sections, an invalid mode, batches missing a field, empty fields,
# write keys that are not backticked, dependencies on unknown batches or on the batch itself, dependency
# cycles, write keys held by two batches with no dependency path between them, and, in plan_only mode, a
# missing or unlinked execute file.
#
# Prints 'path:line: error: message' per finding (or 'path: error: message' for whole-file findings),
# sorted by line, or 'OK: path (N batches, mode M)' for a clean plan. Fenced code blocks are ignored.
#
# Exit codes: 0 when every plan is clean, 1 when any plan has findings, 2 for bad arguments or a missing
# file.
#
# Requires bash, awk, and sort.

set -euo pipefail

export LC_ALL=C.UTF-8

ScriptName=$(basename "$0")

usage() {
    cat <<EOF
Usage: $ScriptName FILE [FILE ...]

Check one or more docs/woz-docs/spec-dev/<slug>/PLAN.md files.

Options:
  -h, --help    Show this help

Example:
  $ScriptName docs/woz-docs/spec-dev/version-bump-ci/PLAN.md
EOF
}

# Keep every check and message in sync with Test-OrchestrationPlan.ps1.
read -r -d '' CheckProgram <<'AWK' || true
function add(line, msg) { nfind++; findLine[nfind] = line; findMsg[nfind] = msg }
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function overlap(a, b) {
    if (a == b) return 1
    if (substr(a, length(a)) == "/" && index(b, a) == 1) return 1
    if (substr(b, length(b)) == "/" && index(a, b) == 1) return 1
    return 0
}
function setPending(line, field) { pendingLine = line; pendingField = field }
BEGIN {
    path = ENVIRON["PLAN_PATH"]
    nsec = split("Overall Goal|Operating Mode and Authorization|Context Manifest|Batches|Final Review", sections, "|")
    nfld = split("Write Keys|Target Context|Dependencies|Acceptance Criteria|Instructions", fields, "|")
    nb = 0; cur = 0; inFinal = 0; finalInstr = 0; mode = ""; modeLine = 0
    fenceChar = ""; fenceLen = 0; pendingLine = 0; nfind = 0
}
{
    sub(/\r$/, "")
    text = $0

    # Skip fenced code: a fence closes only with the same character, at least as long as the opener.
    if (fenceChar != "") {
        t = trim(text)
        if (length(t) >= fenceLen) {
            run = t; gsub(fenceChar == "`" ? "`" : "~", "", run)
            if (run == "") fenceChar = ""
        }
        next
    }
    if (text ~ /^[ \t]*(```|~~~)/) {
        t = text; sub(/^[ \t]+/, "", t)
        fenceChar = substr(t, 1, 1)
        match(t, fenceChar == "`" ? "^`+" : "^~+")
        fenceLen = RLENGTH
        next
    }

    # A field with no inline value must be followed by an indented list item.
    if (pendingLine > 0) {
        if (text ~ /^[ \t][ \t]+[-*][ \t]+[^ \t]/) { pendingLine = 0; next }
        if (text ~ /^[ \t]*$/) next
        add(pendingLine, "field \"" pendingField "\" is empty")
        pendingLine = 0
    }

    if (text ~ /^##[ \t]+[^ \t]/ && text !~ /^###/) {
        cur = 0
        name = trim(substr(text, 3))
        seen[tolower(name)] = 1
        inFinal = (tolower(name) == "final review")
        next
    }
    if (text ~ /^###[ \t]+Batch[ \t]+[0-9]+/) {
        rest = text; sub(/^###[ \t]+Batch[ \t]+/, "", rest)
        match(rest, /^[0-9]+/)
        after = substr(rest, RLENGTH + 1, 1)
        if (after !~ /[A-Za-z0-9_]/) {
            number = substr(rest, 1, RLENGTH) + 0
            for (b = 1; b <= nb; b++) if (num[b] == number) { add(NR, "duplicate Batch " number); break }
            nb++; cur = nb; num[nb] = number; bline[nb] = NR; nkeys[nb] = 0; ndeps[nb] = 0
            next
        }
    }
    if (text ~ /^###/) { cur = 0; next }

    if (text ~ /^- \*\*Mode\*\*:/) {
        modeLine = NR
        v = substr(text, 12)
        if (v ~ /(^|[^A-Za-z0-9_])plan_and_execute([^A-Za-z0-9_]|$)/) mode = "plan_and_execute"
        else if (v ~ /(^|[^A-Za-z0-9_])plan_only([^A-Za-z0-9_]|$)/) mode = "plan_only"
        next
    }

    if (match(text, /^- \*\*(Write Keys|Target Context|Dependencies|Acceptance Criteria|Instructions)\*\*:/)) {
        field = substr(text, 5, RLENGTH - 7)
        value = trim(substr(text, RLENGTH + 1))
        if (cur == 0) {
            if (inFinal && field == "Instructions") {
                finalInstr = 1
                if (value == "") setPending(NR, field)
            }
            next
        }
        has[cur, field] = 1
        if (value == "") { setPending(NR, field); next }

        if (field == "Write Keys") {
            v = value; found = 0
            while (match(v, /`[^`]+`/)) {
                key = trim(substr(v, RSTART + 1, RLENGTH - 2))
                key = tolower(key); gsub(/\\/, "/", key); sub(/^\.\//, "", key)
                nkeys[cur]++; keys[cur, nkeys[cur]] = key; found = 1
                v = substr(v, RSTART + RLENGTH)
            }
            if (!found && tolower(value) !~ /^none([^a-z0-9_]|$)/)
                add(NR, "Write Keys must be backticked keys or none")
        } else if (field == "Dependencies") {
            v = tolower(value); found = 0
            while (match(v, /(^|[^a-z0-9_])batch[ \t]+[0-9]+/)) {
                m = substr(v, RSTART, RLENGTH)
                sub(/^.*batch[ \t]+/, "", m)
                ndeps[cur]++; deps[cur, ndeps[cur]] = m + 0; depLine[cur, ndeps[cur]] = NR; found = 1
                v = substr(v, RSTART + RLENGTH)
            }
            if (!found && tolower(value) !~ /^none([^a-z0-9_]|$)/)
                add(NR, "Dependencies must be none or Batch references")
        }
    }
}
END {
    if (pendingLine > 0) add(pendingLine, "field \"" pendingField "\" is empty")

    for (s = 1; s <= nsec; s++)
        if (!(tolower(sections[s]) in seen)) add(0, "missing section \"## " sections[s] "\"")
    if (mode == "") add(modeLine, "Mode must be `plan_only` or `plan_and_execute`")
    if (nb == 0) add(0, "no \"### Batch <number>:\" sections")
    if (("final review" in seen) && !finalInstr) add(0, "Final Review has no Instructions field")

    for (b = 1; b <= nb; b++) known[num[b]] = 1
    for (b = 1; b <= nb; b++) {
        for (f = 1; f <= nfld; f++)
            if (!((b, fields[f]) in has)) add(bline[b], "Batch " num[b] " is missing field \"" fields[f] "\"")
        for (d = 1; d <= ndeps[b]; d++) {
            if (deps[b, d] == num[b]) add(depLine[b, d], "Batch " num[b] " depends on itself")
            else if (!(deps[b, d] in known)) add(depLine[b, d], "Batch " num[b] " depends on unknown Batch " deps[b, d])
        }
    }

    # Dependency edges between distinct, known batches; a repeated batch number keeps its last definition.
    nn = 0
    for (b = 1; b <= nb; b++) {
        n = num[b]
        if (!(n in isNode)) { isNode[n] = 1; nn++; nodes[nn] = n }
        for (k in edge) { split(k, parts, SUBSEP); if (parts[1] == n) delete edge[k] }
        for (d = 1; d <= ndeps[b]; d++) {
            t = deps[b, d]
            if (t != n && (t in known)) edge[n, t] = 1
        }
    }

    # Cycles: whatever Kahn's algorithm cannot remove is in, or waits on, a cycle.
    progress = 1
    while (progress) {
        progress = 0
        for (i = 1; i <= nn; i++) {
            n = nodes[i]
            if (n in done) continue
            open = 0
            for (j = 1; j <= nn; j++) if (((n, nodes[j]) in edge) && !(nodes[j] in done)) open = 1
            if (!open) { done[n] = 1; progress = 1 }
        }
    }
    ns = 0
    for (i = 1; i <= nn; i++) if (!(nodes[i] in done)) { ns++; stuck[ns] = nodes[i] }
    for (i = 2; i <= ns; i++) { x = stuck[i]; j = i - 1; while (j > 0 && stuck[j] > x) { stuck[j + 1] = stuck[j]; j-- } stuck[j + 1] = x }
    if (ns > 0) {
        list = stuck[1]; for (i = 2; i <= ns; i++) list = list ", " stuck[i]
        add(0, "dependency cycle among batches: " list)
    }

    # Reachability: reach[a, b] is set when a depends on b directly or through a chain.
    for (k in edge) reach[k] = 1
    for (m = 1; m <= nn; m++) for (i = 1; i <= nn; i++) if ((nodes[i], nodes[m]) in reach)
        for (j = 1; j <= nn; j++) if ((nodes[m], nodes[j]) in reach) reach[nodes[i], nodes[j]] = 1

    # Write-key ownership: overlapping keys need a dependency path between their batches.
    for (a = 1; a <= nb; a++) for (b = a + 1; b <= nb; b++) {
        if (num[a] == num[b]) continue
        if (((num[a], num[b]) in reach) || ((num[b], num[a]) in reach)) continue
        for (x = 1; x <= nkeys[b]; x++) for (y = 1; y <= nkeys[a]; y++) {
            if (overlap(keys[b, x], keys[a, y])) {
                add(bline[b], "Batch " num[b] " write key `" keys[b, x] "` overlaps `" keys[a, y] "` in Batch " num[a] " with no dependency path between them")
                break
            }
        }
    }

    # plan_only needs EXECUTE.md beside PLAN.md, naming <slug>/PLAN.md.
    if (mode == "plan_only") {
        planName = path; sub(/.*[\\\/]/, "", planName)
        if (planName != "PLAN.md") add(0, "plan file must be named PLAN.md")
        else {
            planDir = substr(path, 1, length(path) - length(planName))
            execPath = planDir "EXECUTE.md"
            slug = planDir; sub(/[\\\/]$/, "", slug); sub(/.*[\\\/]/, "", slug)
            planRef = (slug == "" || slug == ".") ? planName : slug "/" planName
            content = ""; status = (getline lineText < execPath)
            if (status < 0) add(0, "plan_only plan needs execute file " execPath)
            else {
                while (status > 0) { content = content lineText "\n"; status = (getline lineText < execPath) }
                close(execPath)
                if (index(content, planRef) == 0) add(0, "execute file " execPath " does not reference " planRef)
            }
        }
    }

    for (i = 1; i <= nfind; i++) printf "F\t%d\t%d\t%s\n", findLine[i], i, findMsg[i]
    if (nfind == 0) printf "K\t%d\t%s\n", nb, mode
}
AWK

AllClean=1
Files=()
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --) shift; Files+=("$@"); break ;;
        -*) printf '%s: unknown option: %s\n' "$ScriptName" "$1" >&2; usage >&2; exit 2 ;;
        *) Files+=("$1") ;;
    esac
    shift
done
if [ ${#Files[@]} -eq 0 ]; then
    usage >&2
    exit 2
fi

# Check every path before any plan, so a typo stops the run with no partial output.
Missing=0
for Plan in "${Files[@]}"; do
    if [ ! -f "$Plan" ]; then
        printf '%s: file not found: %s\n' "$ScriptName" "$Plan" >&2
        Missing=1
    fi
done
if [ "$Missing" -eq 1 ]; then
    exit 2
fi

for Plan in "${Files[@]}"; do
    Raw=$(PLAN_PATH="$Plan" awk "$CheckProgram" "$Plan")
    if printf '%s\n' "$Raw" | grep -q '^K'; then
        IFS=$'\t' read -r _ Count Mode <<<"$Raw"
        printf 'OK: %s (%s batches, mode %s)\n' "$Plan" "$Count" "$Mode"
    else
        AllClean=0
        printf '%s\n' "$Raw" | sort -t "$(printf '\t')" -k2,2n -k3,3n |
            while IFS=$'\t' read -r _ Line _ Message; do
                if [ "$Line" -eq 0 ]; then
                    printf '%s: error: %s\n' "$Plan" "$Message"
                else
                    printf '%s:%s: error: %s\n' "$Plan" "$Line" "$Message"
                fi
            done
    fi
done

if [ "$AllClean" -eq 0 ]; then
    exit 1
fi
exit 0
