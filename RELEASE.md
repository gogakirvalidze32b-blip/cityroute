# CityRoute Release Process

Official source for Production uploads:

| Item | Value |
|------|--------|
| Folder | `C:\Users\For Home\Desktop\cityroute-prod-release-f9` |
| Vercel project | `cityroute` (`prj_HYruSM96EoyTjeeNNFZyGYEMf0kd`) |
| Process | **change → tests → Preview → approval → Production** |

Do **not** deploy from other Desktop folders, from diverged `main`, or from a lagging `release/canonical` tip unless that tip equals the approved SHA.

## Release Gate (required before every upload)

The gate verifies the folder, Vercel project, exact Git SHA, clean tree, tests, and build.  
It **never** deploys, and it **never** changes git (no checkout / reset / clean / push).

### Usage

```powershell
cd "C:\Users\For Home\Desktop\cityroute-prod-release-f9"

# Example: approved Preview commit
node scripts/release-gate.mjs --sha 332d75d3c103f77d67fe76733f419572f41d8628
```

Optional compare base for the commit list (default: last known Production content SHA `49b6af0`):

```powershell
node scripts/release-gate.mjs --sha <approved-sha> --compare 49b6af0
```

Or via npm:

```powershell
npm run release:gate -- --sha 332d75d3c103f77d67fe76733f419572f41d8628
```

Exit code `0` = safe to ask for Production approval.  
Exit code `1` = stop; fix the printed `[CODE]` reason.

### What the gate checks

1. Working directory is exactly the official folder above  
2. `.vercel/project.json` name + projectId + orgId match `cityroute`  
3. `HEAD` equals the `--sha` you pass (full or unique short)  
4. No tracked dirty files; no release-significant untracked files under `src/`, `public/`, migrations, lockfiles, etc.  
5. `npm run test:run` and `npm run build` succeed  
6. Report prints: release SHA, current Production deployment id/url, and commits since `--compare`

### After the gate passes (manual — only with your approval)

```powershell
# Still in the official folder, same SHA:
npx vercel deploy --prod --yes `
  -m githubDeployment=1 `
  -m githubCommitSha=<full-sha> `
  -m githubCommitRef=preview/route1-pins-audio `
  -m githubOrg=gogakirvalidze32b-blip `
  -m githubCommitRepo=cityroute
```

Record the **previous** Production URL from the gate report before uploading.

### Rollback

```powershell
npx vercel rollback <previous-production-url> --yes
```

Example of the Production deployment that was live when this process was written:

- host: `cityroute-e3wlm4ntf-gogas-projects-8280b2a8.vercel.app`  
- id: `dpl_JBMAcB45h5fZ8W9XktxDG7bMBDv6`  
- content ≈ Git `49b6af0`

Do not force-push. Do not delete backup branches.

## Flow checklist

1. Commit on a feature / preview branch in the official folder  
2. `npm run test:run` && `npm run build`  
3. Preview: `npx vercel deploy --yes` (not `--prod`)  
4. QA / audit on Preview URL  
5. `node scripts/release-gate.mjs --sha <that-commit>`  
6. Explicit Production approval  
7. `npx vercel deploy --prod --yes` with meta SHA (only then)  
8. Keep rollback URL handy  

## Safety rules

- Gate does not run Production deploy  
- Do not change `.env`, `.vercel/project.json`, remotes, or Vercel project settings for a normal release  
- User data and other Vercel projects are out of scope and must stay untouched  
- If any gate check fails, stop — do not upload  
