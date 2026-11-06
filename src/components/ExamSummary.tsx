import { EXAM_FAIL_MINOR_THRESHOLD } from '@/data/exam-errors'
import {
  examSummaryLines,
  formatExamDuration,
  type ExamSessionSummary,
} from '@/lib/exam-session'

type Props = {
  summary: ExamSessionSummary
  onRestart: () => void
  onFinish?: () => void
  onContinue?: () => void
  onReturnToMenu?: () => void
  finalized?: boolean
  error?: string | null
}

export function ExamSummary({
  summary,
  onRestart,
  onFinish,
  onContinue,
  onReturnToMenu,
  finalized = false,
  error,
}: Props) {
  const lines = examSummaryLines(summary)
  const failed = summary.failedMinor || summary.severeTotal > 0

  return (
    <div className="exam-summary-overlay" data-testid="exam-summary">
      <section className="exam-summary" role="dialog" aria-modal="true" aria-labelledby="exam-summary-title">
        <div className="exam-summary__brand">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span>CityRoute</span>
        </div>

        <header className={`exam-summary__header${failed ? ' exam-summary__header--fail' : ''}`}>
          <span className="exam-summary__result-icon" aria-hidden="true">
            {failed ? '!' : '✓'}
          </span>
          <div>
            <h2 id="exam-summary-title">{finalized ? 'გამოცდა დასრულებულია' : 'გამოცდა შეჩერებულია'}</h2>
            <p className="exam-summary__route">{summary.routeName}</p>
          </div>
        </header>

        <div className="exam-summary__totals" aria-label="გამოცდის შედეგები">
          <div className="exam-summary__box exam-summary__box--time">
            <span>დრო</span>
            <strong>{formatExamDuration(summary.elapsedMs)}</strong>
          </div>
          <div className={`exam-summary__box exam-summary__box--minor${summary.failedMinor ? ' exam-summary__box--fail' : ''}`}>
            <span>მცირე შეცდომა</span>
            <strong>{summary.minorTotal} / {EXAM_FAIL_MINOR_THRESHOLD}</strong>
            {summary.failedMinor && <em>ჩაჭრა</em>}
          </div>
          <div className={`exam-summary__box exam-summary__box--severe${summary.severeTotal > 0 ? ' exam-summary__box--fail' : ''}`}>
            <span>მძიმე შეცდომა</span>
            <strong>{summary.severeTotal}</strong>
            {summary.severeTotal > 0 && <em>ჩაჭრა</em>}
          </div>
        </div>
        {summary.passedPinOrders && (
          <p>გავლილი PIN-ები: {summary.passedPinOrders.length}</p>
        )}

        {error && <p role="alert" className="error-text">{error}</p>}

        {lines.length > 0 ? (
          <>
            <h3>შეცდომების დეტალები</h3>
            <ul className="exam-summary__list">
              {lines.map((row) => (
                <li key={row.label}>
                  <span className="exam-summary__item">
                    <span className="exam-summary__item-icon" aria-hidden="true">!</span>
                    {row.label}
                  </span>
                  <span className="exam-summary__counts">
                    {row.minor > 0 && <em className="exam-badge exam-badge--minor">{row.minor}</em>}
                    {row.severe > 0 && <em className="exam-badge exam-badge--severe">{row.severe}</em>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="exam-summary__clean">
            <span className="exam-summary__clean-icon" aria-hidden="true">✓</span>
            შეცდომა არ დაფიქსირებულა
          </p>
        )}

        <div className="exam-summary__actions">
          {onContinue && (
            <button type="button" className="exam-summary__action exam-summary__action--secondary" onClick={onContinue}>
              გაგრძელება
            </button>
          )}
          {finalized ? (
            <>
              {onReturnToMenu && (
                <button
                  type="button"
                  className="exam-summary__action exam-summary__action--secondary"
                  onClick={onReturnToMenu}
                >
                  მარშრუტების არჩევა
                </button>
              )}
              <button type="button" className="exam-summary__action exam-summary__action--primary" onClick={onRestart}>
                ახალი გამოცდა
                <span aria-hidden="true">→</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="exam-summary__action exam-summary__action--primary"
              onClick={onFinish}
            >
              დასრულება
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
