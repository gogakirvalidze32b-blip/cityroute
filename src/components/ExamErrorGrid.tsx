import { EXAM_ERROR_GRID } from '@/data/exam-errors'
import type { ErrorCounts } from '@/lib/exam-session'

type Props = {
  counts: ErrorCounts
  onError: (errorId: string) => void
}

export function ExamErrorGrid({ counts, onError }: Props) {
  return (
    <div className="exam-grid-wrap">
      <div className="exam-grid">
        {EXAM_ERROR_GRID.map((item) => {
          if (!item.scorable) {
            return (
              <div key={item.id} className="exam-cell exam-cell--empty" aria-hidden="true">
                {item.label}
              </div>
            )
          }

          const c = counts[item.id] ?? { minor: 0, severe: 0 }
          const badgeMinor = c.minor > 0 ? c.minor : null
          const badgeSevere = c.severe > 0 ? c.severe : null

          return (
            <button
              key={item.id}
              type="button"
              className={`exam-cell exam-cell--${item.tone}`}
              onClick={() => onError(item.id)}
            >
              <span className="exam-cell__clip" aria-hidden="true">
                📋
              </span>
              <span className="exam-cell__label">{item.label}</span>
              <span className="exam-cell__badges">
                {badgeMinor != null && <em className="exam-badge exam-badge--minor">{badgeMinor}</em>}
                {badgeSevere != null && <em className="exam-badge exam-badge--severe">{badgeSevere}</em>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
