# Maintaining the repository

A checklist for the maintainer. Most of it is GitHub settings that cannot live in the repository.

## 1. Settings to enable (once)

| Where (GitHub) | Setting | Why |
| --- | --- | --- |
| Your account → Settings → Password and authentication | **Two-factor authentication** (a passkey is best) | the single most important protection of the whole repo |
| Account → Settings → Emails | **Keep my email addresses private** and **Block command line pushes that expose my email** | commits must use `ID+user@users.noreply.github.com`; also run `git config --global user.email "<that address>"` |
| Repo → Settings → Rules → Rulesets (or Branches → Branch protection) | Target `main`: **require a pull request**, **block force pushes**, **block deletions**, require the _CI_ checks to pass. Add yourself as a bypass actor if you want to push directly | nobody (including a stolen token) can rewrite or silently change `main` |
| Repo → Settings → Actions → General | _Fork pull request workflows_: **Require approval for all external contributors**. _Workflow permissions_: **Read repository contents** only | a malicious PR cannot run code in your CI without your approval, and the token cannot write |
| Repo → Settings → Advanced Security (or _Code security_) | Enable **Dependabot alerts**, **Dependabot security updates**, **Secret scanning** and **Push protection**, **Private vulnerability reporting**, and **Code scanning** (the CodeQL workflow already exists) | alerts on vulnerable dependencies, leaked secrets and code issues; a private channel for reports (matches `SECURITY.md`) |
| Repo → Settings → General → Features | Disable **Wikis** and **Projects** if unused; enable **Discussions** if you want Q&A outside issues | less spam to moderate |
| Repo → About (gear) | Description + topics (see README); **Releases / Packages / Deployments** off if unused | cleaner front page |

## 2. Routine

- **Every upstream merge:** follow [UPDATING.md](UPDATING.md) and re-run `tools/audit/network-audit.cjs` (must print _none / none / 0_).
- **Before each release:** secret scan (`docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo`), `yarn audit --groups dependencies`, review open Dependabot/CodeQL alerts.
- **Reviewing a PR:** check the changed files for new `http(s)://` strings, new dependencies, new `fetch`/`WebSocket` calls and edits to `deploy/`, `Dockerfile`, `.github/`. The PR template asks contributors to confirm local-first behaviour.
- **Never** merge a PR that adds telemetry, a CDN, a hosted dependency, or an asset whose license forbids redistribution (see [LIBRARIES.md](LIBRARIES.md)).

## 3. Known security notes

- **Dormant collaboration code.** Excalidraw's Firebase / socket.io collaboration and share-link code is **kept in the source on purpose**: it is the starting point of a possible future _self-hosted / local-network collaboration_ feature. It is **not reachable** in this build (`isCollabDisabled = true`, no UI, no server URLs configured) and the app is served as static files. Its dependencies (`firebase` → `protobufjs`, `websocket-driver`) therefore appear in `yarn audit` and in Dependabot alerts; the advisories concern server/network code paths that never run here. If you dismiss those alerts, choose _"Vulnerable code is not actually used"_ and mention this note. Re-evaluate when the collaboration feature is designed (its backend must be self-hosted, never a third-party service by default).
- **`examples/` and `dev-docs/`** are upstream material that is not deployed; their advisories (for instance `next` in `examples/with-nextjs`) do not affect the app.
- **Browser storage.** Portal tokens and the LLM key live in `localStorage` ([SECURITY.md](SECURITY.md) §4).

## 4. If something leaks

1. Revoke the credential at its provider first (Esri portal token, LLM key, GitHub token).
2. Remove it from the repository history (`git filter-repo`) and force-push, then ask GitHub support to purge cached views if needed.
3. Publish a short advisory if users were affected.
