export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export const uid = () => crypto.randomUUID()

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export const fmtDate = (s: string | Date) => new Date(s).toLocaleDateString([], { dateStyle: 'medium' })
export const fmtDateTime = (s: string | Date) => new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${r.toString().padStart(2, '0')}s`
  return `${r}s`
}
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = m.toString().padStart(2, '0'), rr = r.toString().padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`
}
export const pct = (n: number) => `${Math.round(n * 10) / 10}%`

/** Value for <input type="datetime-local"> in the user's local time zone. */
export function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export type AssignState = 'upcoming' | 'open' | 'closed'
export function windowState(starts: string, closes: string, now = Date.now()): AssignState {
  if (now < new Date(starts).getTime()) return 'upcoming'
  if (now > new Date(closes).getTime()) return 'closed'
  return 'open'
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export'
