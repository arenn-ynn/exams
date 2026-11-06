import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import { AttemptDetail } from '../lib/types'
import { Badge } from './ui'
import { fmtDateTime, fmtDuration } from '../lib/utils'

export default function AttemptDetailView({ d }: { d: AttemptDetail }) {
  const a = d.attempt
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={a.passed ? 'ok' : 'danger'}>{a.passed ? 'Passed' : 'Not passed'}</Badge>
        <span className="font-semibold">{a.percent}%</span>
        <span className="text-muted">({a.score}/{a.max_score} points · pass mark {d.passing_grade}%)</span>
        <span className="text-muted">· Attempt {a.attempt_number} · {fmtDateTime(a.submitted_at)} · {fmtDuration((new Date(a.submitted_at).getTime() - new Date(a.started_at).getTime()) / 1000)}{a.auto_submitted ? ' · auto-submitted at deadline' : ''}</span>
      </div>
      <ol className="space-y-3">
        {d.questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-line p-4">
            <div className="flex items-start gap-2">
              {!q.is_answered ? <MinusCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-label="Unanswered" /> : q.is_correct ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-label="Correct" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-label="Incorrect" />}
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2"><p className="font-medium">{i + 1}. {q.text}</p><span className="shrink-0 text-sm tabular-nums text-muted">{q.awarded}/{q.points}</span></div>
                {q.type === 'matching' ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.pairs.map((p, j) => {
                      const ok = p.chosen === p.right
                      return <li key={j} className="flex flex-wrap gap-x-2"><span className="font-medium">{p.left}</span> → <span className={ok ? 'text-ok' : 'text-danger'}>{p.chosen ?? 'no answer'}</span>{!ok && <span className="text-muted">(correct: {p.right})</span>}</li>
                    })}
                  </ul>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.options.map((o, j) => (
                      <li key={j} className={o.correct ? 'text-ok' : o.selected ? 'text-danger' : 'text-muted'}>
                        {o.selected ? '☑' : '☐'} {o.text}{o.correct && <span className="ml-1 text-xs">(correct)</span>}{o.selected && !o.correct && <span className="ml-1 text-xs">(your choice)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
