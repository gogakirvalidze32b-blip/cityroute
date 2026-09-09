import { EXAM_ERROR_GRID, EXAM_FAIL_MINOR_THRESHOLD, SEVERE_QUICK_ERROR_ID } from '@/data/exam-errors'
import { formatDuration } from '@/lib/route-nav'

export type ErrorCounts = Record<string, { minor: number; severe: number }>

export type ExamSessionSummary = {
  routeId: string
  routeName: string
  startedAt: number
  finishedAt: number
  elapsedMs: number
  minorTotal: number
  severeTotal: number
  failedMinor: boolean
  counts: ErrorCounts
}

function emptyCounts(): ErrorCounts {
  const counts: ErrorCounts = {}
  for (const e of EXAM_ERROR_GRID) {
    if (e.scorable) counts[e.id] = { minor: 0, severe: 0 }
  }
  counts[SEVERE_QUICK_ERROR_ID] = { minor: 0, severe: 0 }
  return counts
}

export function createExamSession(routeId: string, routeName: string) {
  return {
    routeId,
    routeName,
    startedAt: Date.now(),
    counts: emptyCounts(),
    minorTotal: 0,
    severeTotal: 0,
  }
}

export type ExamSession = ReturnType<typeof createExamSession>

export function isExamFailed(session: Pick<ExamSession, 'minorTotal' | 'severeTotal'>): boolean {
  return session.minorTotal >= EXAM_FAIL_MINOR_THRESHOLD || session.severeTotal >= 1
}

export function recordExamError(session: ExamSession, errorId: string, asSevere: boolean): ExamSession {
  const bucket = session.counts[errorId]
  if (!bucket) return session

  const counts = { ...session.counts, [errorId]: { ...bucket } }
  if (asSevere) {
    counts[errorId].severe += 1
    return {
      ...session,
      counts,
      severeTotal: session.severeTotal + 1,
    }
  }

  counts[errorId].minor += 1
  return {
    ...session,
    counts,
    minorTotal: session.minorTotal + 1,
  }
}

export function finishExamSession(session: ExamSession): ExamSessionSummary {
  const finishedAt = Date.now()
  return {
    routeId: session.routeId,
    routeName: session.routeName,
    startedAt: session.startedAt,
    finishedAt,
    elapsedMs: finishedAt - session.startedAt,
    minorTotal: session.minorTotal,
    severeTotal: session.severeTotal,
    failedMinor: isExamFailed(session),
    counts: session.counts,
  }
}

export function recordSevereQuick(session: ExamSession): ExamSession {
  return recordExamError(session, SEVERE_QUICK_ERROR_ID, true)
}

export function examSummaryLines(summary: ExamSessionSummary): { label: string; minor: number; severe: number }[] {
  const gridLines = EXAM_ERROR_GRID.filter((e) => e.scorable)
    .map((e) => ({
      label: e.label,
      minor: summary.counts[e.id]?.minor ?? 0,
      severe: summary.counts[e.id]?.severe ?? 0,
    }))
    .filter((row) => row.minor > 0 || row.severe > 0)

  const quick = summary.counts[SEVERE_QUICK_ERROR_ID]?.severe ?? 0
  if (quick > 0) {
    gridLines.unshift({ label: 'მძიმე შეცდომა (ღილაკი)', minor: 0, severe: quick })
  }

  return gridLines
}

const historyKey = (routeId: string) => `cityroute-exam-${routeId}`

export function saveExamSummary(summary: ExamSessionSummary) {
  const key = historyKey(summary.routeId)
  const prev = loadExamHistory(summary.routeId)
  localStorage.setItem(key, JSON.stringify([summary, ...prev].slice(0, 10)))
}

export function loadExamHistory(routeId: string): ExamSessionSummary[] {
  try {
    const raw = localStorage.getItem(historyKey(routeId))
    if (!raw) return []
    return JSON.parse(raw) as ExamSessionSummary[]
  } catch {
    return []
  }
}

export function formatExamDuration(ms: number) {
  return formatDuration(ms)
}
