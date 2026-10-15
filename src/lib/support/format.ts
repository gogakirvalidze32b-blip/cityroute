import { S } from './strings'

const timeFmt = new Intl.DateTimeFormat('ka-GE', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('ka-GE', { day: 'numeric', month: 'long', year: 'numeric' })
const shortFmt = new Intl.DateTimeFormat('ka-GE', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function toDate(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatTime(iso: string): string {
  const d = toDate(iso)
  return d ? timeFmt.format(d) : ''
}

/** Compact "12.10 14:32" used in the admin conversation list. */
export function formatShort(iso: string): string {
  const d = toDate(iso)
  return d ? shortFmt.format(d) : ''
}

/** Local calendar day, used to group messages under a date divider. */
export function dayKey(iso: string): string {
  const d = toDate(iso)
  if (!d) return ''
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = toDate(iso)
  if (!d) return ''
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return S.today
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return S.yesterday
  return dateFmt.format(d)
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
