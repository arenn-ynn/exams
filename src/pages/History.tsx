import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { StudentAssignment } from '../lib/types'
import { Badge, Empty, ErrorNote, FullSpinner, PageHeader, Tabs, useLoad } from '../components/ui'
import { fmtDate } from '../lib/utils'
import { useState } from 'react'

export default function History() {
  const [tab, setTab] = useState<'created' | 'taken'>('created')
  const created = useLoad(async () => {
    const { data, error } = await supabase.from('exams').select('id,title,status,created_at,questions(count)').order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    return data as unknown as { id: string; title: string; status: string; created_at: string; questions: { count: number }[] }[]
  }, [])
  const taken = useLoad(async () => (await rpc<StudentAssignment[]>('student_assignments')).filter((a) => a.attempts_used > 0), [])
  return (
    <>
      <PageHeader title="History" subtitle="A permanent record — archived classrooms and old examinations stay here." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'created', label: 'Examinations created', count: created.data?.length }, { id: 'taken', label: 'Examinations taken', count: taken.data?.length }]} />
      {tab === 'created' ? (created.loading && !created.data ? <FullSpinner /> : created.error ? <ErrorNote error={created.error} /> : (created.data ?? []).length === 0 ? <Empty title="You have not created any examinations" /> : (
        <div className="card divide-y divide-line">{created.data!.map((e) => <Link key={e.id} to={`/examinations/${e.id}`} className="flex items-center gap-3 p-4 hover:bg-subtle"><div className="min-w-0 flex-1"><div className="truncate font-medium">{e.title}</div><div className="text-xs text-muted">Created {fmtDate(e.created_at)} · {e.questions[0]?.count ?? 0} questions</div></div><Badge tone={e.status === 'published' ? 'ok' : e.status === 'archived' ? 'warn' : 'neutral'}>{e.status}</Badge></Link>)}</div>
      )) : (taken.loading && !taken.data ? <FullSpinner /> : taken.error ? <ErrorNote error={taken.error} /> : (taken.data ?? []).length === 0 ? <Empty title="You have not taken any examinations" /> : (
        <div className="card divide-y divide-line">{taken.data!.map((a) => (
          <div key={a.assignment_id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1 basis-56"><div className="font-medium">{a.exam_title}</div><div className="text-xs text-muted">{a.classroom_name}{a.classroom_archived ? ' (archived)' : ''} · {a.last_submitted_at ? fmtDate(a.last_submitted_at) : 'in progress'} · {a.attempts_used} attempt(s)</div></div>
            {a.results_released_at ? <Link to={`/results/${a.assignment_id}`} className="btn btn-secondary btn-sm">{a.result ? `${a.result.percent}% · ` : ''}View result</Link> : <Badge tone="warn">Awaiting release</Badge>}</div>))}</div>
      ))}
    </>
  )
}
