---
description: Generate audience-tailored onboarding guides in wiki/onboarding/ for contributors, staff engineers, executives, and product managers
argument-hint: "[contributor|staff|executive|pm ...]"
---

# Deep Wiki: Onboarding Guide Generation

Load `deep-wiki:wiki-conventions`, then `deep-wiki:wiki-onboarding`, and follow them to write the guides to `wiki/onboarding/`.

1. If `wiki/scripts/check-wiki.mjs` is missing, load `deep-wiki:wiki-vitepress` and run its `init-wiki.mjs --scripts-only` command first.
2. Guides named in the arguments are written even if they exist. With no arguments, write the guides that are missing; if all four exist, ask which to rewrite.
3. To keep each guide's context small, dispatch one `deep-wiki:wiki-writer` per guide with the onboarding task form (conventions section 11). Otherwise write them yourself, one at a time.
4. Run `node wiki/scripts/gen-section-indexes.mjs wiki` to write `wiki/onboarding/index.md`. Do not write the hub by hand.
5. Check each guide with `node wiki/scripts/check-wiki.mjs wiki --page onboarding/<guide>.md` and fix the errors.

## Arguments

Optional list of guides: `contributor` (`contributor-guide.md`), `staff` (`staff-engineer-guide.md`), `executive` (`executive-guide.md`), `pm` (`product-manager-guide.md`).

$ARGUMENTS
