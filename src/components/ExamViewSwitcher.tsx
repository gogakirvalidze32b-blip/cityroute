export type ExamDriveView = 'map' | 'panel'

type Props = {
  view: ExamDriveView
  onChange: (view: ExamDriveView) => void
}

export function ExamViewSwitcher({ view, onChange }: Props) {
  return (
    <div className="exam-view-switch" role="tablist" aria-label="გამოცდის ხედის არჩევა">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'map'}
        className={`exam-view-switch__btn${view === 'map' ? ' exam-view-switch__btn--active' : ''}`}
        onClick={() => onChange('map')}
      >
        <span className="exam-view-switch__icon" aria-hidden="true">
          🗺️
        </span>
        <span>რუკა</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'panel'}
        className={`exam-view-switch__btn${view === 'panel' ? ' exam-view-switch__btn--active' : ''}`}
        onClick={() => onChange('panel')}
      >
        <span className="exam-view-switch__icon" aria-hidden="true">
          📋
        </span>
        <span>პანელი</span>
      </button>
    </div>
  )
}
