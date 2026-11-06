import { Answer, RunQuestion, QTYPE_LABEL } from '../lib/types'
import { cx } from '../lib/utils'

/** Renders one question for answering (used by the exam runner and the editor's preview). */
export default function QuestionView({ q, answer, onChange, order, readOnly }: {
  q: RunQuestion; answer?: Answer; onChange?: (a: Answer) => void; order?: string[]; readOnly?: boolean
}) {
  const sort = <T extends { id: string }>(items: T[]) => {
    if (!order?.length) return items
    const pos = new Map(order.map((id, i) => [id, i]))
    return [...items].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
  }
  const selected = answer?.selected ?? []
  const matches = answer?.matches ?? {}
  const multi = q.type === 'multiple_choice'

  function toggle(id: string) {
    if (readOnly || !onChange) return
    if (multi) onChange({ selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] })
    else onChange({ selected: [id] })
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{QTYPE_LABEL[q.type]} · {q.points} {q.points === 1 ? 'point' : 'points'}</div>
      <p className="whitespace-pre-wrap text-base font-medium leading-relaxed md:text-lg" id={`q-${q.id}`}>{q.text}</p>
      {multi && <p className="mt-1 text-sm text-muted">Select all that apply.</p>}

      {q.type === 'matching' ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">Match each item on the left with the correct item on the right.</p>
          {q.left.map((l) => {
            const usedElsewhere = new Set(Object.entries(matches).filter(([k]) => k !== l.id).map(([, v]) => v))
            return (
              <div key={l.id} className="rounded-lg border border-line p-3 md:flex md:items-center md:gap-4">
                <div className="mb-2 font-medium md:mb-0 md:w-1/2">{l.text}</div>
                <select className="input md:w-1/2" aria-label={`Match for ${l.text}`} disabled={readOnly} value={matches[l.id] ?? ''}
                  onChange={(e) => { const m = { ...matches }; if (e.target.value) m[l.id] = e.target.value; else delete m[l.id]; onChange?.({ matches: m }) }}>
                  <option value="">Choose…</option>
                  {sort(q.right).map((r) => <option key={r.id} value={r.id} disabled={usedElsewhere.has(r.id)}>{r.text}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-4 space-y-2" role={multi ? 'group' : 'radiogroup'} aria-labelledby={`q-${q.id}`}>
          {sort(q.options).map((o) => {
            const on = selected.includes(o.id)
            return (
              <label key={o.id} className={cx('flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                on ? 'border-accent bg-accent/10' : 'border-line hover:bg-subtle', readOnly && 'cursor-default')}>
                <input type={multi ? 'checkbox' : 'radio'} name={`opt-${q.id}`} className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" checked={on} onChange={() => toggle(o.id)} disabled={readOnly} />
                <span className="text-sm md:text-base">{o.text}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const isAnswered = (q: RunQuestion, a?: Answer) =>
  q.type === 'matching' ? Object.keys(a?.matches ?? {}).length > 0 : (a?.selected?.length ?? 0) > 0
