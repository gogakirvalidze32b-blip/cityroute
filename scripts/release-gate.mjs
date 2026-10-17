/**
 * CityRoute Release Gate - pre-deploy verification only.
 * Never deploys, never mutates git (no checkout/reset/clean/push).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

export const EXPECTED_ROOT = 'C:\\Users\\For Home\\Desktop\\cityroute-prod-release-f9'
export const EXPECTED_PROJECT_NAME = 'cityroute'
export const EXPECTED_PROJECT_ID = 'prj_HYruSM96EoyTjeeNNFZyGYEMf0kd'
export const EXPECTED_ORG_ID = 'team_obgD2HEZE7dunDNAzJslD7vW'

/** Content SHA known to match the live Production build as of the last verified audit. */
export const KNOWN_PRODUCTION_CONTENT_SHA = '49b6af0'

/**
 * Untracked paths that are considered release-significant and must block the gate.
 * Audit noise under scripts/ and supabase/.temp is ignored.
 */
export const SIGNIFICANT_UNTRACKED_PATTERNS = [
  /^src[\\/]/i,
  /^public[\\/]/i,
  /^supabase[\\/]functions[\\/]/i,
  /^supabase[\\/]migrations[\\/]/i,
  /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|vercel\.json|index\.html)$/i,
  /^vite\.config\./i,
  /^vitest\.config\./i,
  /^tsconfig.*\.json$/i,
  /^\.env(\.|$)/i,
  /^\.vercel[\\/]/i,
]

export class GateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GateError'
    this.code = code
  }
}

export function normalizePath(p) {
  return normalize(p).replace(/[/\\]+$/, '')
}

export function pathsEqual(a, b) {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()
}

export function isSignificantUntracked(relPath) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  return SIGNIFICANT_UNTRACKED_PATTERNS.some((re) => re.test(normalized))
}

export function parseArgs(argv) {
  const args = { sha: null, compare: KNOWN_PRODUCTION_CONTENT_SHA, skipNpm: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sha' || a === '-s') {
      args.sha = argv[++i]
    } else if (a === '--compare' || a === '-c') {
      args.compare = argv[++i]
    } else if (a === '--help' || a === '-h') {
      args.help = true
    } else if (a === '--skip-npm') {
      // Intentionally undocumented for production use; tests may inject instead.
      args.skipNpm = true
    } else if (a.startsWith('-')) {
      throw new GateError('BAD_ARGS', `Unknown flag: ${a}`)
    } else if (!args.sha) {
      args.sha = a
    }
  }
  return args
}

export function checkWorkingDirectory(cwd, expectedRoot = EXPECTED_ROOT) {
  if (!pathsEqual(cwd, expectedRoot)) {
    throw new GateError(
      'WRONG_DIRECTORY',
      `Working directory must be exactly:\n  ${expectedRoot}\nGot:\n  ${cwd}`,
    )
  }
  return { cwd: normalizePath(cwd) }
}

export function checkVercelProject(projectJson, expected = {
  projectName: EXPECTED_PROJECT_NAME,
  projectId: EXPECTED_PROJECT_ID,
  orgId: EXPECTED_ORG_ID,
}) {
  if (!projectJson || typeof projectJson !== 'object') {
    throw new GateError('VERCEL_PROJECT', 'Missing or unreadable .vercel/project.json')
  }
  const { projectId, orgId, projectName } = projectJson
  if (projectName !== expected.projectName) {
    throw new GateError(
      'VERCEL_PROJECT',
      `Vercel projectName must be "${expected.projectName}", got "${projectName}"`,
    )
  }
  if (projectId !== expected.projectId) {
    throw new GateError(
      'VERCEL_PROJECT',
      `Vercel projectId must be "${expected.projectId}", got "${projectId}"`,
    )
  }
  if (orgId !== expected.orgId) {
    throw new GateError(
      'VERCEL_PROJECT',
      `Vercel orgId must be "${expected.orgId}", got "${orgId}"`,
    )
  }
  return { projectId, orgId, projectName }
}

export function checkGitSha(actualFullSha, requiredSha) {
  if (!requiredSha || typeof requiredSha !== 'string') {
    throw new GateError('BAD_ARGS', 'Required commit SHA is missing. Pass --sha <commit>.')
  }
  const required = requiredSha.trim().toLowerCase()
  const actual = (actualFullSha || '').trim().toLowerCase()
  if (!/^[0-9a-f]{7,40}$/.test(required)) {
    throw new GateError('BAD_ARGS', `Invalid SHA format: ${requiredSha}`)
  }
  if (!actual) {
    throw new GateError('GIT_SHA', 'Could not resolve current HEAD SHA')
  }
  const match =
    actual === required ||
    actual.startsWith(required) ||
    required.startsWith(actual)
  if (!match) {
    throw new GateError(
      'GIT_SHA',
      `HEAD SHA does not match required release commit.\n  required: ${requiredSha}\n  HEAD:     ${actualFullSha}`,
    )
  }
  return { headSha: actualFullSha, requiredSha }
}

export function checkWorkingTree(porcelainLines) {
  const lines = (porcelainLines || []).filter((l) => l.length > 0)
  const tracked = []
  const significantUntracked = []
  const ignoredUntracked = []

  for (const line of lines) {
    const xy = line.slice(0, 2)
    const pathPart = line.slice(3)
    // rename: "R  old -> new"
    const rel = pathPart.includes(' -> ') ? pathPart.split(' -> ').pop() : pathPart

    if (xy === '??') {
      if (isSignificantUntracked(rel)) {
        significantUntracked.push(rel)
      } else {
        ignoredUntracked.push(rel)
      }
      continue
    }
    // Any other status (including unmerged) on a path is a tracked change.
    tracked.push(`${xy} ${rel}`)
  }

  if (tracked.length > 0) {
    throw new GateError(
      'DIRTY_TREE',
      `Tracked working-tree changes block release:\n  - ${tracked.join('\n  - ')}`,
    )
  }
  if (significantUntracked.length > 0) {
    throw new GateError(
      'DIRTY_TREE',
      `Unexpected release-significant untracked files block release:\n  - ${significantUntracked.join('\n  - ')}`,
    )
  }
  return { ignoredUntracked }
}

export function formatReport({
  headSha,
  requiredSha,
  project,
  cwd,
  production,
  commitList,
}) {
  const lines = [
    '========================================',
    'CityRoute Release Gate — PASSED',
    '========================================',
    '',
    `Working directory:  ${cwd}`,
    `Vercel project:     ${project.projectName} (${project.projectId})`,
    `Release commit:     ${headSha}`,
    `Required SHA:       ${requiredSha}`,
    '',
    'Current Production (do not overwrite without approval):',
    `  url / id:         ${production.identifier}`,
    `  detail:           ${production.detail || '(none)'}`,
    '',
    'Commits included since compare base (review before deploy):',
  ]
  if (!commitList || commitList.length === 0) {
    lines.push('  (no commits in range — HEAD equals compare base, or empty log)')
  } else {
    for (const c of commitList) {
      lines.push(`  ${c}`)
    }
  }
  lines.push(
    '',
    'Gate does NOT deploy. After approval, from this folder only:',
    `  npx vercel deploy --prod --yes \\`,
    `    -m githubDeployment=1 \\`,
    `    -m githubCommitSha=${headSha}`,
    '',
    'Rollback if needed (record Production URL before upload):',
    '  npx vercel rollback <previous-production-url> --yes',
    '========================================',
  )
  return lines.join('\n')
}

/**
 * Git must run without a shell so Windows cmd.exe does not eat `^` in
 * args like `<sha>^{commit}`. npm/npx still need a shell on Windows (.cmd).
 */
export function resolveShellForCommand(cmd) {
  if (cmd === 'git') return false
  return process.platform === 'win32'
}

export function defaultRun(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    shell: opts.shell ?? resolveShellForCommand(cmd),
    env: { ...process.env, ...(opts.env || {}) },
    windowsHide: true,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  }
}

function readProjectJson(root) {
  const path = resolve(root, '.vercel', 'project.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

function git(root, run, ...gitArgs) {
  const r = run('git', gitArgs, { cwd: root })
  if (r.error) {
    throw new GateError('GIT', `git failed to start: ${r.error.message}`)
  }
  if (r.status !== 0) {
    throw new GateError('GIT', `git ${gitArgs.join(' ')} failed:\n${r.stderr || r.stdout}`)
  }
  return (r.stdout || '').trim()
}

function defaultFetchProduction(run, root) {
  const r = run(
    'npx',
    ['vercel', 'inspect', 'https://www.cityroute.ge'],
    { cwd: root },
  )
  const text = `${r.stdout}\n${r.stderr}`
  if (r.status !== 0 && !/Fetched deployment/i.test(text)) {
    throw new GateError(
      'PRODUCTION_INFO',
      `Could not inspect current Production (www.cityroute.ge).\n${r.stderr || r.stdout}`,
    )
  }
  const idMatch = text.match(/\bid\s+[^\S\n]*([^\s]+)/i)
  const urlMatch = text.match(/\burl\s+[^\S\n]*([^\s]+)/i)
  const nameMatch = text.match(/Fetched deployment "([^"]+)"/i)
  const identifier =
    idMatch?.[1] ||
    nameMatch?.[1] ||
    urlMatch?.[1] ||
    null
  if (!identifier) {
    throw new GateError(
      'PRODUCTION_INFO',
      'Could not parse Production deployment id/url from vercel inspect output.',
    )
  }
  return {
    identifier,
    detail: [
      urlMatch?.[1] ? `url=${urlMatch[1]}` : null,
      idMatch?.[1] ? `id=${idMatch[1]}` : null,
      nameMatch?.[1] ? `host=${nameMatch[1]}` : null,
    ]
      .filter(Boolean)
      .join('; '),
  }
}

/**
 * @param {object} [deps] injectable collaborators for tests
 * @param {string[]} [argv] CLI args without node/script
 */
export async function runReleaseGate(deps = {}, argv = process.argv.slice(2)) {
  const {
    cwd = process.cwd(),
    expectedRoot = EXPECTED_ROOT,
    readVercelProject = readProjectJson,
    run = defaultRun,
    fetchProduction = defaultFetchProduction,
    log = console.log,
    error = console.error,
  } = deps

  const args = parseArgs(argv)
  if (args.help) {
    log(`Usage: node scripts/release-gate.mjs --sha <commit> [--compare <baseSha>]

Checks only. Does not deploy or modify git/Vercel.`)
    return { ok: true, help: true }
  }

  try {
    const dir = checkWorkingDirectory(cwd, expectedRoot)
    const project = checkVercelProject(readVercelProject(cwd))

    const headSha = git(cwd, run, 'rev-parse', 'HEAD')
    const shaCheck = checkGitSha(headSha, args.sha)

    // Ensure required SHA resolves to the same commit as HEAD (handles short SHAs).
    const requiredFull = git(cwd, run, 'rev-parse', `${args.sha}^{commit}`)
    checkGitSha(headSha, requiredFull)

    const statusOut = git(cwd, run, 'status', '--porcelain')
    const porcelain = statusOut ? statusOut.split(/\r?\n/) : []
    const tree = checkWorkingTree(porcelain)

    if (!args.skipNpm) {
      const testRun = run('npm', ['run', 'test:run'], { cwd })
      if (testRun.status !== 0) {
        throw new GateError(
          'TESTS',
          `npm run test:run failed (exit ${testRun.status}).\n${testRun.stderr || testRun.stdout}`,
        )
      }
      const buildRun = run('npm', ['run', 'build'], { cwd })
      if (buildRun.status !== 0) {
        throw new GateError(
          'BUILD',
          `npm run build failed (exit ${buildRun.status}).\n${buildRun.stderr || buildRun.stdout}`,
        )
      }
    }

    const production = await Promise.resolve(fetchProduction(run, cwd))

    let commitList = []
    try {
      const range = `${args.compare}..${headSha}`
      const logOut = git(cwd, run, 'log', '--oneline', range)
      commitList = logOut ? logOut.split(/\r?\n/).filter(Boolean) : []
    } catch (e) {
      throw new GateError(
        'COMMIT_LIST',
        `Could not list commits for ${args.compare}..${headSha}: ${e.message}`,
      )
    }

    const report = formatReport({
      headSha,
      requiredSha: requiredFull,
      project,
      cwd: dir.cwd,
      production,
      commitList,
    })
    log(report)

    return {
      ok: true,
      headSha,
      requiredSha: requiredFull,
      project,
      production,
      commitList,
      ignoredUntracked: tree.ignoredUntracked,
      report,
    }
  } catch (e) {
    const msg =
      e instanceof GateError
        ? `RELEASE GATE FAILED [${e.code}]\n${e.message}`
        : `RELEASE GATE FAILED\n${e?.stack || e}`
    error(msg)
    return { ok: false, error: e }
  }
}

function isMain() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
}

if (isMain()) {
  const result = await runReleaseGate()
  process.exit(result.ok ? 0 : 1)
}
