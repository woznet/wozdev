#!/usr/bin/env bash
# Measures a prompt file and flags wording worth a second look.
#
# Shell counterpart of Measure-Prompt.ps1, for hosts without PowerShell. It takes the same options and
# reports the same numbers: characters, words, lines, an estimated token count (characters divided by
# --chars-per-token), and counts of filler phrases, shouted emphasis, and duplicated lines. With
# --baseline it also reports the tokens saved against an earlier version. With --findings it lists each
# flagged phrase or line instead of the summary.
#
# The token count is an estimate. Tokenizers differ by model and content, so use it to compare two
# versions of a prompt, not to predict a bill.
#
# Requires bash, GNU grep (for \b in -E patterns), awk, sed, tr, wc, and sort.

set -euo pipefail

# Count characters, not bytes, and lowercase non-ASCII letters correctly.
export LC_ALL=C.UTF-8

ScriptName=$(basename "$0")

usage() {
    cat <<EOF
Usage: $ScriptName [options] FILE [FILE ...]

Measure one or more prompt files.

Options:
  --baseline FILE         Earlier version of the prompt; adds BaselineTokens, SavedTokens, SavedPercent
  --chars-per-token N     Characters per token for the estimate, 1-10 (default 4)
  --findings              List each flagged phrase or line (Line, Kind, Text, Path) instead of the summary
  -h, --help              Show this help

Examples:
  $ScriptName ./prompt.md
  $ScriptName ./prompt.md --baseline ./original.md
  $ScriptName ./prompt.md --findings
EOF
}

fail() {
    printf '%s: %s\n' "$ScriptName" "$1" >&2
    exit 1
}

# Phrases that usually carry no instruction. A match is a candidate for removal, not an error.
# Keep in sync with $FillerPattern in Measure-Prompt.ps1.
FillerPhrases=(
    'please'
    'kindly'
    'thank you'
    'thanks in advance'
    'in order to'
    'it is (very |extremely )?important (to note |to remember )?(that|to)'
    'it should be noted that'
    'note that'
    'make sure (that|to)'
    'be sure to'
    'remember to'
    'i (want|need|would like) you to'
    'feel free to'
    'as (mentioned|stated|noted|described) (above|earlier|before|previously)'
    'in other words'
    'due to the fact that'
    'in the event that'
    'for the purpose of'
    'with regard to'
    'at this point in time'
    'each and every'
    'under any circumstances'
    'very'
    'really'
    'basically'
    'actually'
    'simply'
)
FillerRegex="\\b($(IFS='|'; printf '%s' "${FillerPhrases[*]}"))\\b"

# Case-sensitive on purpose: only the shouted forms are flagged.
EmphasisRegex='\b(IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS|MANDATORY|ABSOLUTELY|EXTREMELY|VERY)\b|!{2,}'

Paths=()
Baseline=''
CharsPerToken='4'
Findings=0

while [ $# -gt 0 ]; do
    case "$1" in
        --baseline)
            [ $# -ge 2 ] || fail '--baseline needs a file'
            Baseline=$2
            shift 2
            ;;
        --chars-per-token)
            [ $# -ge 2 ] || fail '--chars-per-token needs a number'
            CharsPerToken=$2
            shift 2
            ;;
        --findings)
            Findings=1
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        --)
            shift
            Paths+=("$@")
            break
            ;;
        -*)
            fail "unknown option: $1 (see --help)"
            ;;
        *)
            Paths+=("$1")
            shift
            ;;
    esac
done

[ ${#Paths[@]} -gt 0 ] || { usage >&2; exit 1; }

if ! awk -v n="$CharsPerToken" 'BEGIN { exit !(n ~ /^[0-9]+(\.[0-9]+)?$/ && n >= 1 && n <= 10) }'; then
    fail "--chars-per-token must be a number from 1 to 10, not '$CharsPerToken'"
fi

TempDir=$(mktemp -d)
trap 'rm -rf "$TempDir"' EXIT

# Writes the prompt with line endings normalized to LF, so CRLF and LF copies measure the same.
normalize() {
    local Source=$1 Target=$2
    [ -f "$Source" ] && [ -r "$Source" ] || fail "cannot read '$Source': no such readable file"
    sed -e 's/\r$//' -- "$Source" | tr '\r' '\n' >"$Target"
}

char_count() {
    wc -m <"$1" | tr -d '[:space:]'
}

token_estimate() {
    awk -v c="$1" -v n="$CharsPerToken" 'BEGIN { t = c / n; r = int(t); if (r < t) r++; print r }'
}

# Emits tab-separated findings: Line, Kind, Text, Path. Order matches Measure-Prompt.ps1:
# by line, then Filler, Emphasis, Duplicate.
findings() {
    local File=$1 Label=$2
    {
        grep -noiE -- "$FillerRegex" "$File" |
            awk -F: -v OFS='\t' '{ n = $1; sub(/^[0-9]+:/, ""); print n, 1, "Filler", tolower($0) }' || true

        grep -noE -- "$EmphasisRegex" "$File" |
            awk -F: -v OFS='\t' '{ n = $1; sub(/^[0-9]+:/, ""); print n, 2, "Emphasis", $0 }' || true

        # Short lines, fences, and table rules repeat legitimately; only longer text counts as a duplicate.
        awk -v OFS='\t' '
            {
                s = $0
                gsub(/[[:space:]]+/, " ", s)
                sub(/^ /, "", s)
                sub(/ $/, "", s)
                s = tolower(s)
                if (length(s) < 25 || s ~ /^[[:space:]|:`~=-]+$/) next
                if (s in seen) {
                    p = s
                    if (length(p) > 60) p = substr(p, 1, 60) "..."
                    print NR, 3, "Duplicate", "same as line " seen[s] ": " p
                } else {
                    seen[s] = NR
                }
            }' "$File"
    } | sort -t "$(printf '\t')" -s -k1,1n -k2,2n |
        awk -F '\t' -v OFS='\t' -v path="$Label" '{ print $1, $3, $4, path }'
}

BaselineTokens=''
if [ -n "$Baseline" ]; then
    normalize "$Baseline" "$TempDir/baseline"
    BaselineTokens=$(token_estimate "$(char_count "$TempDir/baseline")")
fi

[ "$Findings" -eq 1 ] && printf 'Line\tKind\tText\tPath\n'

First=1
for File in "${Paths[@]}"; do
    Work="$TempDir/prompt"
    normalize "$File" "$Work"
    findings "$Work" "$File" >"$TempDir/findings"

    if [ "$Findings" -eq 1 ]; then
        cat "$TempDir/findings"
        continue
    fi

    Characters=$(char_count "$Work")
    Words=$(wc -w <"$Work" | tr -d '[:space:]')
    Tokens=$(token_estimate "$Characters")

    # Lines after trimming trailing newlines; 0 only for an empty file.
    Lines=0
    if [ "$Characters" -gt 0 ]; then
        Lines=$(awk 'length($0) > 0 { last = NR } END { print (last > 0 ? last : 1) }' "$Work")
    fi

    Filler=$(awk -F '\t' '$2 == "Filler"' "$TempDir/findings" | wc -l | tr -d '[:space:]')
    Emphasis=$(awk -F '\t' '$2 == "Emphasis"' "$TempDir/findings" | wc -l | tr -d '[:space:]')
    Duplicate=$(awk -F '\t' '$2 == "Duplicate"' "$TempDir/findings" | wc -l | tr -d '[:space:]')

    [ "$First" -eq 1 ] || printf '\n'
    First=0

    printf 'Path: %s\nCharacters: %s\nWords: %s\nLines: %s\nEstimatedTokens: %s\nFiller: %s\nEmphasis: %s\nDuplicate: %s\n' \
        "$File" "$Characters" "$Words" "$Lines" "$Tokens" "$Filler" "$Emphasis" "$Duplicate"

    if [ -n "$BaselineTokens" ]; then
        awk -v b="$BaselineTokens" -v t="$Tokens" 'BEGIN {
            saved = b - t
            pct = (b > 0) ? sprintf("%.1f", 100 * saved / b) : "0"
            sub(/\.0$/, "", pct)
            if (pct == "-0") pct = "0"
            printf "BaselineTokens: %d\nSavedTokens: %d\nSavedPercent: %s\n", b, saved, pct
        }'
    fi
done
