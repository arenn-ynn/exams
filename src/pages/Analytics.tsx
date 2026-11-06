import { Link } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Badge, Empty, ErrorNote, FullSpinner, PageHeader, useLoad } from '../components/ui'
import { fmtDateTime, windowState } from '../lib/utils'
import { useAuth } from '../lib/auth'

interface Row { id: string; starts_at: string; closes_at: string; results_released_at: string | null; classrooms: { name: string; archived: boolean }; exam_versions: { snapshot: { title: string } } }

export default function Analytics() {
  const { user } = useAuth()
  const q = useLoad(async () => {
    const { data, error } = await supabase.from('assignments').select('id,starts_at,closes_at,results_released_at,classrooms!inner(name,archived,owner_id),exam_versions(snapshot)').eq('classrooms.owner_id', user!.id).order('starts_at', { ascending: false }).limit(100)
    if (error) throw error
    return data as unknown as Row[]
  }, [user?.id])
  return (
    <>
      <PageHeader title="Examination Analytics" subtitle="Results for every examination you assigned to a classroom you manage." />
      {q.loading && !q.data ? <FullSpinner /> : q.error ? <ErrorNote error={q.error} retry={q.reload} /> : (q.data ?? []).length === 0 ? (
        <Empty icon={<BarChart3 className="h-8 w-8" />} title="Nothing to analyse yet" text="Assign an examination to one of your classrooms. Once students submit, their results appear here." action={<Link to="/classrooms" className="btn btn-primary">Go to classrooms</Link>} />
      ) : (
        <div className="card divide-y divide-line">
          {q.data!.map((a) => { const w = windowState(a.starts_at, a.closes_at); return (
            <Link key={a.id} to={`/analytics/${a.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-subtle">
              <div className="min-w-0 flex-1 basis-60"><div className="font-medium">{a.exam_versions.snapshot.title}</div><div className="text-xs text-muted">{a.classrooms.name} · {fmtDateTime(a.starts_at)}</div></div>
              <Badge tone={w === 'open' ? 'ok' : w === 'upcoming' ? 'accent' : 'neutral'}>{w === 'open' ? 'Active' : w === 'upcoming' ? 'Upcoming' : 'Completed'}</Badge>
              {a.results_released_at ? <Badge tone="ok">Released</Badge> : <Badge tone="warn">Not released</Badge>}
            </Link>) })}
        </div>
      )}
    </>
  )
}
