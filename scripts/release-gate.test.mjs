/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest'
import {
  EXPECTED_ROOT,
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NAME,
  EXPECTED_ORG_ID,
  checkWorkingDirectory,
  checkVercelProject,
  checkGitSha,
  checkWorkingTree,
  isSignificantUntracked,
  parseArgs,
  runReleaseGate,
  GateError,
} from './release-gate.mjs'

const VALID_PROJECT = {
  projectId: EXPECTED_PROJECT_ID,
  orgId: EXPECTED_ORG_ID,
  projectName: EXPECTED_PROJECT_NAME,
}

const HEAD = '332d75d3c103f77d67fe76733f419572f41d8628'

function mockRun(overrides = {}) {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    if (overrides[key]) return overrides[key]
    if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { status: 0, stdout: HEAD + '\n', stderr: '' }
    }
    if (cmd === 'git' && args[0] === 'rev-parse' && String(args[1]).includes('{commit}')) {
      return { status: 0, stdout: HEAD + '\n', stderr: '' }
    }
    if (cmd === 'git' && args[0] === 'status') {
      return { status: 0, stdout: '', stderr: '' }
    }
    if (cmd === 'git' && args[0] === 'log') {
      return {
        status: 0,
        stdout: '332d75d Strengthen resume coverage\naa2fc38 Fit home menu\n',
        stderr: '',
      }
    }
    if (cmd === 'npm' && args[0] === 'run' && args[1] === 'test:run') {
      return { status: 0, stdout: 'ok\n', stderr: '' }
    }
    if (cmd === 'npm' && args[0] === 'run' && args[1] === 'build') {
      return { status: 0, stdout: 'built\n', stderr: '' }
    }
    return { status: 0, stdout: '', stderr: '' }
  }
}

describe('release-gate helpers', () => {
  it('accepts the official working directory', () => {
    expect(checkWorkingDirectory(EXPECTED_ROOT).cwd).toBeTruthy()
  })

  it('rejects a wrong working directory', () => {
    expect(() => checkWorkingDirectory('C:\\Users\\For Home\\Desktop\\cityroute')).toThrow(
      GateError,
    )
    try {
      checkWorkingDirectory('C:\\Users\\For Home\\Desktop\\other')
    } catch (e) {
      expect(e.code).toBe('WRONG_DIRECTORY')
    }
  })

  it('accepts the expected Vercel project', () => {
    expect(checkVercelProject(VALID_PROJECT).projectId).toBe(EXPECTED_PROJECT_ID)
  })

  it('rejects wrong Vercel project id or name', () => {
    expect(() =>
      checkVercelProject({ ...VALID_PROJECT, projectId: 'prj_WRONG' }),
    ).toThrow(/projectId/)
    expect(() =>
      checkVercelProject({ ...VALID_PROJECT, projectName: 'other-app' }),
    ).toThrow(/projectName/)
  })

  it('matches full and short SHAs', () => {
    expect(checkGitSha(HEAD, HEAD).headSha).toBe(HEAD)
    expect(checkGitSha(HEAD, '332d75d').headSha).toBe(HEAD)
  })

  it('rejects a mismatched SHA', () => {
    expect(() => checkGitSha(HEAD, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toThrow(
      /does not match/,
    )
  })

  it('rejects tracked changes and significant untracked files', () => {
    expect(() => checkWorkingTree([' M src/App.tsx'])).toThrow(/Tracked/)
    expect(() => checkWorkingTree(['?? src/evil.ts'])).toThrow(/untracked/)
    expect(() => checkWorkingTree(['?? package.json'])).toThrow(/untracked/)
    // audit noise is allowed
    expect(checkWorkingTree(['?? scripts/full-audio-audit.report.json']).ignoredUntracked).toHaveLength(
      1,
    )
    expect(isSignificantUntracked('supabase/.temp/cli-latest')).toBe(false)
  })

  it('parses --sha', () => {
    expect(parseArgs(['--sha', HEAD]).sha).toBe(HEAD)
  })
})

describe('runReleaseGate', () => {
  it('passes for correct SHA, directory, and clean tree (no real deploy)', async () => {
    const log = vi.fn()
    const result = await runReleaseGate(
      {
        cwd: EXPECTED_ROOT,
        readVercelProject: () => VALID_PROJECT,
        run: mockRun(),
        fetchProduction: async () => ({
          identifier: 'dpl_JBMAcB45h5fZ8W9XktxDG7bMBDv6',
          detail: 'url=cityroute-e3wlm4ntf-gogas-projects-8280b2a8.vercel.app',
        }),
        log,
        error: vi.fn(),
      },
      ['--sha', HEAD],
    )

    expect(result.ok).toBe(true)
    expect(result.headSha).toBe(HEAD)
    expect(result.production.identifier).toContain('dpl_')
    expect(result.commitList.length).toBeGreaterThan(0)
    expect(log.mock.calls[0][0]).toMatch(/Release Gate — PASSED/)
    expect(log.mock.calls[0][0]).toMatch(/does NOT deploy/)
  })

  it('fails for wrong SHA without deploying', async () => {
    const error = vi.fn()
    const run = mockRun()
    const result = await runReleaseGate(
      {
        cwd: EXPECTED_ROOT,
        readVercelProject: () => VALID_PROJECT,
        run,
        fetchProduction: async () => ({ identifier: 'dpl_x', detail: '' }),
        log: vi.fn(),
        error,
      },
      ['--sha', '1111111111111111111111111111111111111111'],
    )
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('GIT_SHA')
    expect(error.mock.calls[0][0]).toMatch(/GIT_SHA/)
  })

  it('fails for wrong directory or Vercel project id', async () => {
    const badDir = await runReleaseGate(
      {
        cwd: 'C:\\Users\\For Home\\Desktop\\cityroute-wrong',
        readVercelProject: () => VALID_PROJECT,
        run: mockRun(),
        fetchProduction: async () => ({ identifier: 'dpl_x', detail: '' }),
        log: vi.fn(),
        error: vi.fn(),
      },
      ['--sha', HEAD],
    )
    expect(badDir.ok).toBe(false)
    expect(badDir.error.code).toBe('WRONG_DIRECTORY')

    const badProject = await runReleaseGate(
      {
        cwd: EXPECTED_ROOT,
        readVercelProject: () => ({ ...VALID_PROJECT, projectId: 'prj_OTHER' }),
        run: mockRun(),
        fetchProduction: async () => ({ identifier: 'dpl_x', detail: '' }),
        log: vi.fn(),
        error: vi.fn(),
      },
      ['--sha', HEAD],
    )
    expect(badProject.ok).toBe(false)
    expect(badProject.error.code).toBe('VERCEL_PROJECT')
  })

  it('fails when the working tree has tracked changes', async () => {
    const run = mockRun({
      'git status --porcelain': {
        status: 0,
        stdout: ' M src/index.css\n',
        stderr: '',
      },
    })
    const result = await runReleaseGate(
      {
        cwd: EXPECTED_ROOT,
        readVercelProject: () => VALID_PROJECT,
        run,
        fetchProduction: async () => ({ identifier: 'dpl_x', detail: '' }),
        log: vi.fn(),
        error: vi.fn(),
      },
      ['--sha', HEAD],
    )
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('DIRTY_TREE')
  })

  it('fails when tests or build fail (still no deploy)', async () => {
    const failTests = mockRun({
      'npm run test:run': { status: 1, stdout: '', stderr: 'test failed\n' },
    })
    const testsResult = await runReleaseGate(
      {
        cwd: EXPECTED_ROOT,
        readVercelProject: () => VALID_PROJECT,
        run: failTests,
        fetchProduction: async () => ({ identifier: 'dpl_x', detail: '' }),
        log: vi.fn(),
        error: vi.fn(),
      },
      ['--sha', HEAD],
    )
    expect(testsResult.ok).toBe(false)
    expect(testsResult.error.code).toBe('TESTS')

    const failBuild = mockRun({
      'npm run build': { status: 1, stdout: '', stderr: 'build failed\n' },
    })
    const buildResult = await runReleaseGate(
      {
        cwd: EXPECTED_ROOT,
        readVercelProject: () => VALID_PROJECT,
        run: failBuild,
        fetchProduction: async () => ({ identifier: 'dpl_x', detail: '' }),
        log: vi.fn(),
        error: vi.fn(),
      },
      ['--sha', HEAD],
    )
    expect(buildResult.ok).toBe(false)
    expect(buildResult.error.code).toBe('BUILD')
  })
})
