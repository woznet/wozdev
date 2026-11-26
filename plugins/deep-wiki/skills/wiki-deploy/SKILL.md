---
name: wiki-deploy
description: Use when a VitePress wiki in wiki/ should be published to GitHub Pages, when a deploy-wiki GitHub Actions workflow is needed or broken, or when the deployed wiki 404s or loads without styles because of a wrong base path.
license: MIT
metadata:
  author: Microsoft (forked)
  version: "2.2.0"
---

# Wiki Deploy (GitHub Pages)

Add `.github/workflows/deploy-wiki.yml` to build `wiki/` with VitePress and publish it to GitHub Pages.

Load `deep-wiki:wiki-conventions` if it is not already loaded; it defines `REPO_URL`, `HOST`, and `BRANCH`. Run every command from the repository root.

## Step 1: Preconditions

Check in order.

| Check | If it fails |
|-------|-------------|
| `wiki/package.json` and `wiki/scripts/init-wiki.mjs` exist | Stop: run `/deep-wiki:build` first. |
| `HOST` is `github` | Stop: GitHub Pages needs a GitHub remote. |
| The remote is on `github.com` | A GitHub Enterprise server has its own Pages URLs. Ask the user for the site URL and take the base from its path; a subagent stops and reports instead. |
| `.github/workflows/deploy-wiki.yml` does not exist | Keep the existing workflow (change it only if the user asked). Skip Steps 3 and 4, and still do Steps 2 and 5, so a wrong base path gets fixed. |
| No other workflow publishes to Pages (command below) | Ask whether to add `deploy-wiki.yml` alongside it. A subagent skips and reports instead. |

To find another Pages workflow:

```bash
grep -rlE "deploy-pages|upload-pages-artifact" .github/workflows
```

Ignore `deploy-wiki.yml` itself in the output. Every other file it prints publishes to Pages. No other file, no output, or a "No such file or directory" error means there is none.

## Step 2: Base Path

Get the owner and repo name: `gh repo view --json owner,name --jq '.owner.login + "/" + .name'`. Without `gh`, parse `REPO_URL`, which is already normalized to `https://github.com/<owner>/<repo>`.

Use the first row that matches:

| Situation | Pages URL | Base | `--base` value |
|-----------|-----------|------|----------------|
| Custom domain (`wiki/public/CNAME` exists) | `https://<domain>/` | `/` | `root` |
| Repo is named `<owner>.github.io` | `https://<owner>.github.io/` | `/` | `root` |
| Any other repo | `https://<owner>.github.io/<repo>/` | `/<repo>/` | `<repo>` |

Compare with `BASE` in `wiki/.vitepress/config.mts`. If it differs, set it with the script. Do not edit `config.mts` by hand, and pass the value without slashes (a value starting with `/` is rewritten by Git Bash on Windows):

```bash
node wiki/scripts/init-wiki.mjs wiki --base <repo>
```

The deployment copies of the llms files carry the base in their links. If `wiki/llms.txt` exists, regenerate them: `node wiki/scripts/gen-llms.mjs wiki`.

## Step 3: Lockfile

| Situation | Install step | `setup-node` inputs |
|-----------|--------------|---------------------|
| `wiki/package-lock.json` exists, or the user is fine with creating it now (`npm --prefix wiki install`) | `npm ci` | Keep `cache: npm` and `cache-dependency-path` |
| No lockfile and installing now is not wanted | `npm install` | Replace both cache lines with `package-manager-cache: false`; `setup-node` fails when the cache path is missing |

## Step 4: Write the Workflow

Replace `BRANCH` with the resolved default branch. The action versions below were current in November 2026. With `gh` available, check each with `gh api repos/actions/<name>/releases/latest --jq .tag_name` and use the latest major; without `gh`, use the versions shown.

```yaml
name: Deploy Wiki to GitHub Pages

on:
  push:
    branches: [BRANCH]
    paths:
      - 'wiki/**'
      - '.github/workflows/deploy-wiki.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # full history for VitePress lastUpdated

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: wiki/package-lock.json

      - uses: actions/configure-pages@v6

      - name: Install dependencies
        run: npm ci
        working-directory: wiki

      - name: Build
        run: npm run build
        working-directory: wiki

      - uses: actions/upload-pages-artifact@v5
        with:
          path: wiki/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

## Step 5: Report

Tell the user:

1. Which files were created or changed: the workflow, the base (in `config.mts` and `.deep-wiki.json`), the llms files, the lockfile.
2. To commit them: `git add .github/workflows/deploy-wiki.yml wiki/` and push to `BRANCH`. The build runs the wiki's site checks first, so `wiki/scripts/`, `wiki/catalogue.json`, and `wiki/.deep-wiki.json` must be committed with the pages.
3. **Required one-time setup:** in the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Without this, the workflow run fails or publishes nothing. With `gh` and admin rights: `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`. Run that only if the user asks; it changes repository settings.
4. The site URL from Step 2.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Site loads without CSS or 404s on assets | The base doesn't match the repo name (Step 2) |
| Build step fails in `check-wiki.mjs` | A page breaks a site rule; run `npm --prefix wiki run build` locally and fix the page it names |
| Build step cannot find `scripts/check-wiki.mjs` | `wiki/scripts/` was not committed |
| `npm ci` fails: missing lockfile | Commit `wiki/package-lock.json`, or switch to the no-lockfile variant (Step 3) |
| setup-node: "Some specified paths were not resolved" | Cache lines left in while no lockfile exists (Step 3) |
| Workflow never runs | The push didn't touch `wiki/**`, or it went to a branch other than `BRANCH` |
| The run fails with "Get Pages site failed", "Pages not enabled", or a 404 from Pages | Do the Settings → Pages step |
| Mermaid diagrams missing | `mermaid` and `vitepress-plugin-mermaid` missing from `wiki/package.json` |
| `npm ci` / `npm install`: `ERESOLVE` on peer `mermaid@"10 \|\| 11"` | The `overrides` entry for `vitepress-plugin-mermaid` is missing from `wiki/package.json`. `/deep-wiki:build` keeps an existing `package.json`, so restore the entry from the template: load `deep-wiki:wiki-vitepress` and run `node "<vitepress skill dir>/templates/scripts/init-wiki.mjs" wiki --write-mode regenerate`. That replaces the whole scaffold (config, theme, `package.json`, `.gitignore`, logo; the base is kept), so tell the user first |
| `EBADENGINE` or a Mermaid build error on old Node | Mermaid 12 needs Node 22.12+; keep `node-version` at 22.12 or newer |
