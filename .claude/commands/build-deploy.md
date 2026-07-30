---
description: Build frontend/ and deploy Hosting + the Cloud Function to Firebase
allowed-tools: Bash, Read
---

Publish the current local version of GroupVote to the live site:
**https://groupvote-12796.web.app** (project `groupvote-12796`).

Every shell must load nvm first (Node 20 lives there, and so does the `firebase`
CLI): prefix each command with

```
export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"
```

## Steps

1. **Build the client** — from `frontend/`: `npm run build` → `frontend/dist/`.
   A healthy build reports ~68 modules and no errors.
   **If the build fails, STOP.** Report the error and deploy nothing —
   `firebase deploy` uploads whatever is sitting in `frontend/dist/`, so
   deploying after a failed build publishes a stale or broken site.
2. **Deploy** — from the repo **root**: `firebase deploy`
   (Hosting + the `suggestOptions` function together).
   If it fails on the functions step, retry the two products separately so one
   can't block the other:
   `firebase deploy --only hosting`, then `firebase deploy --only functions`.
   Hosting needs neither Blaze nor the Gemini secret; functions needs both.
3. **Smoke test** the live site:
   ```bash
   BASE=https://groupvote-12796.web.app
   curl -s -o /dev/null -w "root:      %{http_code}\n" "$BASE/"            # expect 200
   curl -s -o /dev/null -w "deep link: %{http_code}\n" "$BASE/room/TEST12" # expect 200 (SPA rewrite)
   curl -s -o /dev/null -w "api GET:   %{http_code}\n" "$BASE/api/suggest" # expect 405 (POST-only)
   ```
4. **Report** the live URL, each smoke-test code, and anything that came back
   unexpected. Say plainly if a step was skipped or a product failed to deploy —
   don't call it done when only Hosting went out.

`firebase login` and `functions:secrets:set` **cannot run here** — they need a
real terminal. If either is required, tell the user to run it themselves with
`! <command>` or in their own terminal, then re-run this command.

Diagnose failures against `RUNBOOK.md` → Pitfalls (symptom → cause → fix) rather
than guessing.
