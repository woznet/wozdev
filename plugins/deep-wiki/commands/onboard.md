---
description: Generate audience-tailored onboarding guides in wiki/onboarding/ for contributors, staff engineers, executives, and product managers
argument-hint: "[contributor|staff|executive|pm ...]"
---

# Deep Wiki: Onboarding Guide Generation

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-onboarding`, and follow them to write the guides to `wiki/onboarding/`.

1. **Scripts.** If `wiki/scripts/check-wiki.mjs` is missing, load `deep-wiki:wiki-vitepress` and run the bootstrap command from conventions section 10 with depth `full`.
2. **Which guides.** The depth is the one recorded in `wiki/.deep-wiki.json`, else `full`.

   | Arguments | Full-depth wiki | Crisp wiki |
   |-----------|-----------------|------------|
   | Guides named | Write them, even if they exist | Write them at crisp depth, even if they exist |
   | None | Write the guides that are missing; if all four exist, ask which to rewrite | Write the contributor guide if it is missing; if it exists, ask whether to rewrite it |

3. **Write.** Dispatch one `deep-wiki:wiki-writer` per guide with the onboarding task form (conventions section 11), which keeps each guide's context small. If that agent type is unavailable, write them yourself, one at a time.
4. **Hub.** Run `node wiki/scripts/gen-section-indexes.mjs wiki` to write `wiki/onboarding/index.md`. Do not write the hub by hand.
5. **Check** each guide with `node wiki/scripts/check-wiki.mjs wiki --page onboarding/<guide>.md` and fix the errors.
6. **llms files.** If `wiki/llms.txt` exists, run `node wiki/scripts/gen-llms.mjs wiki` so the guides are listed.

## Arguments

Optional list of guides: `contributor` (`contributor-guide.md`), `staff` (`staff-engineer-guide.md`), `executive` (`executive-guide.md`), `pm` (`product-manager-guide.md`).

$ARGUMENTS
