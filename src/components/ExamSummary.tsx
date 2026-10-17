import { EXAM_FAIL_MINOR_THRESHOLD } from '@/data/exam-errors'
import {
  examSummaryLines,
  formatExamDuration,
  type ExamSessionSummary,
} from '@/lib/exam-session'

type Props = {
  summary: ExamSessionSummary
  onRestart: () => void
  /** Mid-route stop kept progress — continue from the next unhandled PIN. */
  onContinue?: () => void
}

export function ExamSummary({ summary, onRestart, onContinue }: Props) {
  const lines = examSummaryLines(summary)

  return (
    <div className="exam-summary-overlay" data-testid="exam-summary">
      <div className="exam-summary">
        <p className="exam-summary__route">{summary.routeName}</p>
        <h2>სესია დასრულდა</h2>
        <p className="exam-summary__time">{formatExamDuration(summary.elapsedMs)}</p>

        <div className="exam-summary__totals">
          <div className={`exam-summary__box exam-summary__box--minor${summary.failedMinor ? ' exam-summary__box--fail' : ''}`}>
            <span>ქვედი შეცდომა</span>
            <strong>
              {summary.minorTotal} / {EXAM_FAIL_MINOR_THRESHOLD}
            </strong>
            {summary.failedMinor && <em>ჩაჭრა</em>}
          </div>
          <div className={`exam-summary__box exam-summary__box--severe${summary.severeTotal > 0 ? ' exam-summary__box--fail' : ''}`}>
            <span>მძიმე შეცდომა</span>
            <strong>{summary.severeTotal}</strong>
            {summary.severeTotal > 0 && <em>ჩაჭრა</em>}
          </div>
        </div>

        {lines.length > 0 ? (
          <>
            <h3>დაუშვა შეცდომები</h3>
            <ul className="exam-summary__list">
              {lines.map((row) => (
                <li key={row.label}>
                  <span>{row.label}</span>
                  <span className="exam-summary__counts">
                    {row.minor > 0 && <em className="exam-badge exam-badge--minor">{row.minor}</em>}
                    {row.severe > 0 && <em className="exam-badge exam-badge--severe">{row.severe}</em>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="exam-summary__clean">შეცდომა არ ჩაწერილა</p>
        )}

        {onContinue && (
          <button type="button" className="nav-start-btn" onClick={onContinue}>
            გაგრძელება
          </button>
        )}
        <button type="button" className="nav-start-btn" onClick={onRestart}>
          თავიდან
        </button>
      </div>
    </div>
  )
}
