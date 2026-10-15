import { EXAM_FAIL_MINOR_THRESHOLD } from '@/data/exam-errors'
import { isExamFailed } from '@/lib/exam-session'
import { formatExamDuration } from '@/lib/exam-session'

type Props = {
  elapsedMs: number
  speedKmh: number
  minorTotal: number
  severeTotal: number
  onRecordSevere: () => void
  showErrors?: boolean
  compact?: boolean
  /**
   * Posted speed limit in km/h. The sign always keeps its place and size in the bar.
   * There is no real data source for this yet, so when it is null/undefined the sign
   * is shown empty ("—") — a number is never invented here.
   */
  speedLimitKmh?: number | null
  /**
   * Engine RPM. There is no real data source for this yet (needs e.g. OBD),
   * so it is only rendered when a real finite number is passed in.
   */
  rpm?: number | null
}

function hudTime(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = m.toString().padStart(2, '0')
  const ss = s.toString().padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function isRealNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Top bar of the exam screen. The <header> uses `display: contents` (see index.css),
 * so its parts are laid out together with the other items of `.exam-topbar`
 * (voice hint, view switch, finish button) in one compact horizontal bar.
 */
export function ExamScoreboard({
  elapsedMs,
  speedKmh,
  minorTotal,
  severeTotal,
  onRecordSevere,
  showErrors = true,
  compact = false,
  speedLimitKmh = null,
  rpm = null,
}: Props) {
  const failed = isExamFailed({ minorTotal, severeTotal })
  const hasLimit = isRealNumber(speedLimitKmh)
  const hasRpm = isRealNumber(rpm)

  return (
    <header className={`exam-hud${compact ? ' exam-hud--compact' : ''}`}>
      <div
        className={`exam-hud__limit${hasLimit ? '' : ' exam-hud__limit--unknown'}`}
        role="img"
        aria-label={hasLimit ? `სიჩქარის ლიმიტი ${speedLimitKmh}` : 'სიჩქარის ლიმიტი უცნობია'}
      >
        <span className="exam-hud__limit-value">{hasLimit ? Math.round(speedLimitKmh) : '—'}</span>
      </div>

      <div className="exam-hud__readout" role="group" aria-label={`დრო ${formatExamDuration(elapsedMs)}`}>
        <div className="exam-hud__time">{hudTime(elapsedMs)}</div>
        <div className="exam-hud__meta">
          {hasRpm && (
            <span className="exam-hud__rpm" aria-label={`ბრუნვა ${Math.round(rpm)} წუთში`}>
              <strong>{Math.round(rpm)}</strong> rpm
            </span>
          )}
          <span className="exam-hud__speed" aria-label={`სიჩქარე ${Math.round(speedKmh)} კილომეტრი საათში`}>
            <strong>{Math.round(speedKmh)}</strong> km/h
          </span>
        </div>
      </div>

      {showErrors && (
        <>
          <div
            className={`exam-hud__minor${failed ? ' exam-hud__minor--fail' : ''}`}
            aria-label="ქვედი შეცდომა"
          >
            <strong>{minorTotal}</strong>
            <span className="exam-hud__minor-cap">/{EXAM_FAIL_MINOR_THRESHOLD}</span>
          </div>

          <button
            type="button"
            className={`exam-hud__severe${severeTotal > 0 ? ' exam-hud__severe--fail' : ''}`}
            onClick={onRecordSevere}
          >
            <span className="exam-hud__severe-label">
              <span className="exam-hud__severe-word">მძიმე</span> <span className="exam-hud__severe-word">შეცდომა</span>
            </span>
            <strong className="exam-hud__severe-count">{severeTotal}</strong>
          </button>
        </>
      )}
    </header>
  )
}
