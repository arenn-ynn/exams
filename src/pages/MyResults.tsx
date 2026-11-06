import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Award } from 'lucide-react'
import { rpc } from '../lib/api'
import { StudentAssignment } from '../lib/types'
import { Badge, Empty, ErrorNote, FullSpinner, PageHeader, useLoad } from '../components/ui'
import { fmtDate, fmtDuration } from '../lib/utils'

export default function MyResults() {
  const q = useLoad(async () => (await rpc<StudentAssignment[]>('student_assignments')).filter((a) => a.submitted_count > 0), [])
  return (
    <>
      <PageHeader title="My Results" subtitle="Examinations you completed. Grades appear after your teacher releases results." />
      {q.loading && !q.data ? <FullSpinner /> : q.error ? <ErrorNote error={q.error} retry={q.reload} /> : (q.data ?? []).length === 0 ? (
        <Empty icon={<Award className="h-8 w-8" />} title="No completed examinations" text="After you submit an examination it will be listed here." />
      ) : (
        <>
          <div className="card hidden xl:block"><table className="w-full"><thead className="border-b border-line"><tr><th className="th">Examination</th><th className="th">Classroom</th><th className="th">Completed</th><th className="th">Grade</th><th className="th">Attempts</th><th className="th">Time</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-line">{q.data!.map((a) => (
              <tr key={a.assignment_id}><td className="td font-medium">{a.results_released_at ? <Link className="hover:underline" to={`/results/${a.assignment_id}`}>{a.exam_title}</Link> : a.exam_title}</td><td className="td">{a.classroom_name}</td><td className="td">{a.last_submitted_at ? fmtDate(a.last_submitted_at) : '—'}</td>
                <td className="td tabular-nums">{a.result ? <span className={a.result.passed ? 'text-ok' : 'text-danger'}>{a.result.percent}%</span> : '—'}</td><td className="td">{a.attempts_used}</td><td className="td">{a.result ? fmtDuration(a.result.time_spent_seconds) : '—'}</td>
                <td className="td">{a.results_released_at ? <Badge tone="ok">Released</Badge> : <Badge tone="warn">Awaiting release</Badge>}</td></tr>))}</tbody></table></div>
          <div className="space-y-3 xl:hidden">{q.data!.map((a) => (
            <CardLink key={a.assignment_id} to={a.results_released_at ? `/results/${a.assignment_id}` : null}><div className="flex justify-between gap-2"><span className="font-medium">{a.exam_title}</span>{a.result && <span className={a.result.passed ? 'font-semibold text-ok' : 'font-semibold text-danger'}>{a.result.percent}%</span>}</div>
              <p className="text-xs text-muted">{a.classroom_name} · {a.last_submitted_at ? fmtDate(a.last_submitted_at) : ''} · {a.attempts_used} attempt(s)</p><div className="mt-2">{a.results_released_at ? <Badge tone="ok">Released</Badge> : <Badge tone="warn">Awaiting release</Badge>}</div></CardLink>))}</div>
        </>
      )}
    </>
  )
}

/** A result card: a real link once results are released, otherwise a plain (non-interactive) card instead of a dead "#" link. */
function CardLink({ to, children }: { to: string | null; children: ReactNode }) {
  return to ? <Link to={to} className="card block p-4 transition-colors hover:bg-subtle">{children}</Link> : <div className="card p-4">{children}</div>
}
