import { EXAM_ERROR_GRID } from '@/data/exam-errors'
import type { ErrorCounts } from '@/lib/exam-session'

type Props = {
  counts: ErrorCounts
  onError: (errorId: string) => void
}

/** Inline clipboard icon (no emoji font needed on the car's Android WebView). */
function ClipIcon() {
  return (
    <svg className="exam-cell__clip" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9 2h6a1 1 0 0 1 1 1v1h2.5A1.5 1.5 0 0 1 20 5.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-15A1.5 1.5 0 0 1 5.5 4H8V3a1 1 0 0 1 1-1Zm.5 2v1.5h5V4h-5ZM7 9v1.6h10V9H7Zm0 3.7v1.6h10v-1.6H7Zm0 3.7V18h6.5v-1.6H7Z"
      />
    </svg>
  )
}

export function ExamErrorGrid({ counts, onError }: Props) {
  return (
    <div className="exam-grid-wrap">
      <div className="exam-grid">
        {EXAM_ERROR_GRID.map((item) => {
          if (!item.scorable) {
            return (
              <div key={item.id} className="exam-cell exam-cell--empty" aria-hidden="true">
                <ClipIcon />
                <span className="exam-cell__label exam-cell__label--dash">- - - -</span>
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
              <ClipIcon />
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
