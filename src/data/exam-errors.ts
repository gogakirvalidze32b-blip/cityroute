export const EXAM_FAIL_MINOR_THRESHOLD = 15

/** Header „მძიმე შეცდომა“ button — not shown in grid */
export const SEVERE_QUICK_ERROR_ID = 'severe-quick'

export type ExamErrorTone = 'grey' | 'yellow' | 'green' | 'blue' | 'empty'

export type ExamErrorDef = {
  id: string
  label: string
  tone: ExamErrorTone
  /** false = placeholder cell (.....) */
  scorable: boolean
}

/** 4×7 grid — matches official-style examiner tablet layout */
export const EXAM_ERROR_GRID: ExamErrorDef[] = [
  { id: 'shoulder-check', label: 'მხარზე გახედვა', tone: 'grey', scorable: true },
  { id: 'mirrors', label: 'სარკეები', tone: 'yellow', scorable: true },
  { id: 'observation', label: 'დაკვირვება', tone: 'yellow', scorable: true },
  { id: 'hazard', label: 'საფრთხის გამოვლენა', tone: 'yellow', scorable: true },
  { id: 'priority', label: 'გზის დათმობა/პრიორიტეტი', tone: 'yellow', scorable: true },
  { id: 'tech-check', label: 'ტექნიკური გამართულობის შემოწმება', tone: 'green', scorable: true },
  { id: 'prep-start', label: 'მომზადება მოძრაობის დასაწყებად', tone: 'blue', scorable: true },

  { id: 'clutch-off', label: 'გამორთული გადაბმულობა', tone: 'grey', scorable: true },
  { id: 'gear', label: 'გადაცემა', tone: 'grey', scorable: true },
  { id: 'clutch', label: 'გადაბმულობა', tone: 'yellow', scorable: true },
  { id: 'accelerator', label: 'აქსელერატორი', tone: 'yellow', scorable: true },
  { id: 'braking', label: 'დამუხრუჭება', tone: 'yellow', scorable: true },
  { id: 'speed', label: 'სიჩქარე', tone: 'yellow', scorable: true },
  { id: 'speed-limit', label: 'სიჩქარის ლიმიტის დარღვევა', tone: 'yellow', scorable: true },

  { id: 'indicator', label: 'შუქ-მაჩვენებელი', tone: 'grey', scorable: true },
  { id: 'steering', label: 'საჭის მართვა', tone: 'grey', scorable: true },
  { id: 'instruments', label: 'ხელსაწყოები', tone: 'yellow', scorable: true },
  { id: 'steering-turn', label: 'საჭის ტრიალი', tone: 'yellow', scorable: true },
  { id: 'distance', label: 'დისტანცია', tone: 'yellow', scorable: true },
  { id: 'signs-lights', label: 'საგზაო ნიშანი/შუქნიშანი', tone: 'yellow', scorable: true },
  { id: 'empty-2', label: '.....', tone: 'empty', scorable: false },

  { id: 'stall', label: 'ძრავის ჩაქრობა', tone: 'grey', scorable: true },
  { id: 'lane-position', label: 'გზაზე განლაგება', tone: 'grey', scorable: true },
  { id: 'before-right', label: 'განლაგება მარჯვნივ მოხვევამდე', tone: 'yellow', scorable: true },
  { id: 'after-right', label: 'განლაგება მარჯვნივ მოხვევის შემდეგ', tone: 'yellow', scorable: true },
  { id: 'before-left', label: 'განლაგება მარცხნივ მოხვევამდე', tone: 'yellow', scorable: true },
  { id: 'after-left', label: 'განლაგება მარცხნივ მოხვევის შემდეგ', tone: 'yellow', scorable: true },
  { id: 'empty-3', label: '.....', tone: 'empty', scorable: false },
]

export const EXAM_ERROR_BY_ID = Object.fromEntries(EXAM_ERROR_GRID.map((e) => [e.id, e])) as Record<
  string,
  ExamErrorDef
>
