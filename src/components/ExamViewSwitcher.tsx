export type ExamDriveView = 'map' | 'panel'

type Props = {
  view: ExamDriveView
  onChange: (view: ExamDriveView) => void
}

function MapIcon() {
  return (
    <svg className="exam-view-switch__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9 3 3 5.2v15.6L9 18.6l6 2.4 6-2.2V3.2L15 5.4 9 3Zm.75 2.55 4.5 1.8v11.1l-4.5-1.8V5.55Z"
      />
    </svg>
  )
}

function PanelIcon() {
  return (
    <svg className="exam-view-switch__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9 2h6a1 1 0 0 1 1 1v1h2.5A1.5 1.5 0 0 1 20 5.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-15A1.5 1.5 0 0 1 5.5 4H8V3a1 1 0 0 1 1-1Zm.5 2v1.5h5V4h-5ZM7 9v1.6h10V9H7Zm0 3.7v1.6h10v-1.6H7Zm0 3.7V18h6.5v-1.6H7Z"
      />
    </svg>
  )
}

export function ExamViewSwitcher({ view, onChange }: Props) {
  return (
    <div className="exam-view-switch" role="tablist" aria-label="გამოცდის ხედის არჩევა">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'map'}
        aria-label="რუკა"
        className={`exam-view-switch__btn${view === 'map' ? ' exam-view-switch__btn--active' : ''}`}
        onClick={() => onChange('map')}
      >
        <MapIcon />
        <span className="exam-view-switch__text">რუკა</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'panel'}
        aria-label="პანელი"
        className={`exam-view-switch__btn${view === 'panel' ? ' exam-view-switch__btn--active' : ''}`}
        onClick={() => onChange('panel')}
      >
        <PanelIcon />
        <span className="exam-view-switch__text">პანელი</span>
      </button>
    </div>
  )
}
