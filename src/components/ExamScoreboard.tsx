import { EXAM_FAIL_MINOR_THRESHOLD } from '@/data/exam-errors'
import { isExamFailed } from '@/lib/exam-session'
import { formatExamDuration } from '@/lib/exam-session'

type Props = {
  elapsedMs: number
  speedKmh: number
  /** current posted limit; undefined = no sign, null = limit unknown (NEEDS_VERIFICATION) */
  speedLimitKmh?: number | null
  minorTotal: number
  severeTotal: number
  onRecordSevere: () => void
  showErrors?: boolean
  compact?: boolean
}

function hudTimeParts(ms: number) {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  if (h > 0) {
    return {
      head: `${h}:${m.toString().padStart(2, '0')}`,
      tail: s.toString().padStart(2, '0'),
    }
  }

  return {
    head: String(m),
    tail: s.toString().padStart(2, '0'),
  }
}

export function ExamScoreboard({
  elapsedMs,
  speedKmh,
  speedLimitKmh,
  minorTotal,
  severeTotal,
  onRecordSevere,
  showErrors = true,
  compact = false,
}: Props) {
  const failed = isExamFailed({ minorTotal, severeTotal })
  const time = hudTimeParts(elapsedMs)
  const showLimit = speedLimitKmh !== undefined

  return (
    <header className={`exam-hud${compact ? ' exam-hud--compact' : ''}${showLimit ? ' exam-hud--with-limit' : ''}`}>
      <div className="exam-hud__zone exam-hud__time" aria-label={`დრო ${formatExamDuration(elapsedMs)}`}>
        <div className="exam-hud__time-inner">
          <span className="exam-hud__time-head">{time.head}</span>
          <span className="exam-hud__time-sep">:</span>
          <span className="exam-hud__time-tail">{time.tail}</span>
        </div>
      </div>

      <div className="exam-hud__zone exam-hud__speed" aria-label={`სიჩქარე ${Math.round(speedKmh)} კილომეტრი საათში`}>
        <div className="exam-hud__speed-inner">
          <strong>{Math.round(speedKmh)}</strong>
          <span>კმ/სთ</span>
        </div>
        {showLimit && (
          <div
            className={`exam-hud__limit${speedLimitKmh == null ? ' exam-hud__limit--unknown' : ''}`}
            role="img"
            aria-label={speedLimitKmh == null ? 'სიჩქარის ლიმიტი უცნობია' : `სიჩქარის ლიმიტი ${speedLimitKmh}`}
          >
            {speedLimitKmh == null ? '–' : speedLimitKmh}
          </div>
        )}
      </div>

      {showErrors && (
        <>
          <div
            className={`exam-hud__zone exam-hud__minor${failed ? ' exam-hud__minor--fail' : ''}`}
            aria-label="ქვედი შეცდომა"
          >
            <strong>{minorTotal}</strong>
            <span className="exam-hud__minor-cap">/{EXAM_FAIL_MINOR_THRESHOLD}</span>
          </div>

          <button
            type="button"
            className={`exam-hud__zone exam-hud__severe${severeTotal > 0 ? ' exam-hud__severe--fail' : ''}`}
            onClick={onRecordSevere}
          >
            <span className="exam-hud__severe-label">
              <span className="exam-hud__severe-word">მძიმე</span>
              <span className="exam-hud__severe-word">შეცდომა</span>
            </span>
            <strong className="exam-hud__severe-count">{severeTotal}</strong>
          </button>
        </>
      )}
    </header>
  )
}
