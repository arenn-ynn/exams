import { Link } from 'react-router-dom'
import { Award, Bell, CalendarClock, FilePlus2, LogIn, School, Users } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Badge, Card, Empty, ErrorNote, FullSpinner, PageHeader, useLoad } from '../components/ui'
import { JoinModal } from './Classrooms'
import { AssignedRow } from './Examinations'
import { fmtDate } from '../lib/utils'
import { StudentAssignment } from '../lib/types'

interface Overview {
  exams: { id: string; title: string; status: string; updated_at: string }[]
  classes: { id: string; name: string; owner_id: string; archived: boolean }[]
  asg: StudentAssignment[]
  notes: { id: string; title: string; body: string; link: string | null; created_at: string }[]
}

export default function Dashboard() {
  const { user, profile } = useAuth()
  const [joining, setJoining] = useState(false)
  const q = useLoad<Overview>(async () => {
    const [e, c, a, n] = await Promise.all([
      supabase.from('exams').select('id,title,status,updated_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('classrooms').select('id,name,owner_id,archived').order('created_at', { ascending: false }).limit(50),
      rpc<StudentAssignment[]>('student_assignments'),
      supabase.from('notifications').select('id,title,body,link,created_at').is('read_at', null).order('created_at', { ascending: false }).limit(4),
    ])
    for (const r of [e, c, n]) if (r.error) throw r.error
    return { exams: e.data as Overview['exams'], classes: c.data as Overview['classes'], asg: a, notes: n.data as Overview['notes'] }
  }, [])
  if (q.loading && !q.data) return <FullSpinner />
  if (q.error || !q.data) return <ErrorNote error={q.error ?? 'Failed to load'} retry={q.reload} />
  const d = q.data
  const managed = d.classes.filter((c) => c.owner_id === user?.id), joined = d.classes.filter((c) => c.owner_id !== user?.id)
  const now = Date.now()
  const upcoming = d.asg.filter((a) => a.submitted_count === 0 && new Date(a.closes_at).getTime() > now).sort((x, y) => +new Date(x.starts_at) - +new Date(y.starts_at)).slice(0, 4)
  const completed = d.asg.filter((a) => a.submitted_count > 0).slice(0, 4)
  const results = d.asg.filter((a) => a.result).slice(0, 4)
  const empty = d.exams.length === 0 && d.classes.length === 0

  return (
    <>
      <PageHeader title={`Hello${profile?.full_name ? ', ' + profile.full_name.split(' ')[0] : ''}`} subtitle="Here is what is happening across your examinations and classrooms." />
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[{ to: '/examinations/new', icon: FilePlus2, label: 'Create examination' }, { to: '/classrooms', icon: School, label: 'Create classroom' }, { to: '', icon: LogIn, label: 'Join classroom' }, { to: '/results', icon: Award, label: 'View results' }].map((x) => x.to
          ? <Link key={x.label} to={x.to} className="card flex min-h-[64px] items-center gap-3 p-4 text-sm font-medium transition-colors hover:border-accent"><x.icon className="h-5 w-5 text-accent-fg" />{x.label}</Link>
          : <button key={x.label} onClick={() => setJoining(true)} className="card flex min-h-[64px] items-center gap-3 p-4 text-left text-sm font-medium transition-colors hover:border-accent"><x.icon className="h-5 w-5 text-accent-fg" />{x.label}</button>)}
      </div>
      {empty && <div className="mb-8"><Empty icon={<School className="h-8 w-8" />} title="Welcome to EXAMINA" text="Create an examination and a classroom to run your own exams, or join a classroom with a code to take examinations." action={<div className="flex flex-wrap justify-center gap-2"><Link to="/examinations/new" className="btn btn-primary">Create examination</Link><button className="btn btn-secondary" onClick={() => setJoining(true)}>Join classroom</button></div>} /></div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Upcoming examinations" icon={<CalendarClock className="h-4 w-4" />} to="/examinations">{upcoming.length ? <div className="divide-y divide-line">{upcoming.map((a) => <AssignedRow key={a.assignment_id} a={a} />)}</div> : <p className="p-4 text-sm text-muted">No upcoming examinations.</p>}</Section>
        <Section title="Important notifications" icon={<Bell className="h-4 w-4" />} to="/notifications">{d.notes.length ? <div className="divide-y divide-line">{d.notes.map((n) => <Link key={n.id} to={n.link ?? '/notifications'} className="block p-4 hover:bg-subtle"><div className="text-sm font-medium">{n.title}</div><div className="text-xs text-muted">{n.body}</div></Link>)}</div> : <p className="p-4 text-sm text-muted">No unread notifications.</p>}</Section>
        <Section title="Recently created examinations" to="/examinations">{d.exams.length ? <div className="divide-y divide-line">{d.exams.map((e) => <Link key={e.id} to={`/examinations/${e.id}`} className="flex items-center justify-between gap-2 p-4 hover:bg-subtle"><span className="truncate text-sm font-medium">{e.title}</span><Badge tone={e.status === 'published' ? 'ok' : e.status === 'archived' ? 'warn' : 'neutral'}>{e.status}</Badge></Link>)}</div> : <p className="p-4 text-sm text-muted">You haven't created any examinations.</p>}</Section>
        <Section title="Latest results" icon={<Award className="h-4 w-4" />} to="/results">{results.length ? <div className="divide-y divide-line">{results.map((a) => <Link key={a.assignment_id} to={`/results/${a.assignment_id}`} className="flex items-center justify-between gap-2 p-4 hover:bg-subtle"><span className="min-w-0"><span className="block truncate text-sm font-medium">{a.exam_title}</span><span className="text-xs text-muted">{a.classroom_name}</span></span><span className={a.result!.passed ? 'font-semibold text-ok' : 'font-semibold text-danger'}>{a.result!.percent}%</span></Link>)}</div> : <p className="p-4 text-sm text-muted">Released results will appear here.</p>}</Section>
        <Section title="Classrooms I manage" icon={<School className="h-4 w-4" />} to="/classrooms">{managed.length ? <div className="divide-y divide-line">{managed.slice(0, 5).map((c) => <Link key={c.id} to={`/classrooms/${c.id}`} className="block p-4 text-sm font-medium hover:bg-subtle">{c.name}{c.archived && <span className="ml-2 text-xs text-muted">archived</span>}</Link>)}</div> : <p className="p-4 text-sm text-muted">You don't manage any classrooms.</p>}</Section>
        <Section title="Classrooms I joined" icon={<Users className="h-4 w-4" />} to="/classrooms">{joined.length ? <div className="divide-y divide-line">{joined.slice(0, 5).map((c) => <Link key={c.id} to={`/classrooms/${c.id}`} className="block p-4 text-sm font-medium hover:bg-subtle">{c.name}</Link>)}</div> : <p className="p-4 text-sm text-muted">You haven't joined any classrooms.</p>}</Section>
        <Section title="Recently completed" to="/history">{completed.length ? <div className="divide-y divide-line">{completed.map((a) => <div key={a.assignment_id} className="flex items-center justify-between gap-2 p-4 text-sm"><span className="truncate font-medium">{a.exam_title}</span><span className="shrink-0 text-xs text-muted">{a.last_submitted_at ? fmtDate(a.last_submitted_at) : ''}</span></div>)}</div> : <p className="p-4 text-sm text-muted">Nothing completed yet.</p>}</Section>
      </div>
      <JoinModal open={joining} onClose={() => setJoining(false)} />
    </>
  )
}

function Section({ title, icon, to, children }: { title: string; icon?: React.ReactNode; to: string; children: React.ReactNode }) {
  return <Card><div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2><Link to={to} className="text-xs text-accent-fg hover:underline">View all</Link></div>{children}</Card>
}
