import { FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BarChart3, CalendarPlus, Copy, Maximize2, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Badge, Button, Card, Empty, ErrorNote, Field, FullSpinner, Modal, PageHeader, Tabs, useFeedback, useLoad } from '../components/ui'
import AssignModal from '../components/AssignModal'
import { AssignedRow } from './Examinations'
import { Avatar } from '../components/AppLayout'
import { errMsg, fmtDateTime, toLocalInput, windowState } from '../lib/utils'
import { StudentAssignment } from '../lib/types'

interface Cls { id: string; name: string; description: string; join_code: string; enrollment_open: boolean; archived: boolean; owner_id: string; created_at: string }
interface Asg { id: string; starts_at: string; closes_at: string; results_released_at: string | null; exam_versions: { snapshot: { title: string; durationMinutes: number; questions: unknown[] }; version_number: number } }
interface Mem { user_id: string; joined_at: string; profiles: { full_name: string; email: string | null; avatar_url: string | null } | null }
interface Ann { id: string; title: string; message: string; published_at: string }

export default function ClassroomDetail() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const { toast, confirm } = useFeedback()
  const [tab, setTab] = useState<'exams' | 'members' | 'news' | 'settings'>('exams')
  const [assign, setAssign] = useState(false)
  const [resched, setResched] = useState<Asg | null>(null)

  const c = useLoad(async () => {
    const { data, error } = await supabase.from('classrooms').select('*').eq('id', id).single()
    if (error) throw new Error('Classroom not found.')
    return data as Cls
  }, [id])
  const owner = !!c.data && c.data.owner_id === user?.id

  const asg = useLoad(async () => {
    if (!c.data) return null
    if (owner) {
      const { data, error } = await supabase.from('assignments').select('id,starts_at,closes_at,results_released_at,exam_versions(version_number,snapshot)').eq('classroom_id', id).order('starts_at', { ascending: false })
      if (error) throw error
      return { owner: data as unknown as Asg[], student: [] as StudentAssignment[] }
    }
    const all = await rpc<StudentAssignment[]>('student_assignments')
    return { owner: [] as Asg[], student: all.filter((a) => a.classroom_id === id) }
  }, [c.data?.id, owner])
  const members = useLoad(async () => {
    if (!owner) return [] as Mem[]
    const { data, error } = await supabase.from('classroom_members').select('user_id,joined_at,profiles(full_name,email,avatar_url)').eq('classroom_id', id).order('joined_at')
    if (error) throw error
    return data as unknown as Mem[]
  }, [c.data?.id, owner])
  const news = useLoad(async () => {
    const { data, error } = await supabase.from('announcements').select('id,title,message,published_at').eq('classroom_id', id).order('published_at', { ascending: false }).limit(50)
    if (error) throw error
    return data as Ann[]
  }, [id])

  const [annTitle, setAnnTitle] = useState(''); const [annMsg, setAnnMsg] = useState(''); const [posting, setPosting] = useState(false)
  const [sName, setSName] = useState<string | null>(null); const [sDesc, setSDesc] = useState<string | null>(null)

  if (c.loading && !c.data) return <FullSpinner />
  if (c.error || !c.data) return <ErrorNote error={c.error ?? 'Not found'} />
  const cl = c.data
  const link = `${location.origin}/join/${cl.join_code}`

  const copy = async (text: string, msg: string) => { try { await navigator.clipboard.writeText(text); toast(msg) } catch { toast('Copy failed', 'error') } }
  async function patch(p: Partial<Cls>) { const { error } = await supabase.from('classrooms').update(p).eq('id', id); if (error) toast(error.message, 'error'); else { toast('Saved.'); c.reload() } }
  async function regen() {
    if (!(await confirm({ title: 'Regenerate joining code?', message: 'The old code and invitation link stop working. Existing members are not affected.', confirmLabel: 'Regenerate' }))) return
    try { await rpc('regenerate_join_code', { p_classroom: id }); toast('New code generated.'); c.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function post(e: FormEvent) {
    e.preventDefault(); setPosting(true)
    const { error } = await supabase.from('announcements').insert({ classroom_id: id, title: annTitle, message: annMsg })
    setPosting(false)
    if (error) return toast(error.message, 'error')
    setAnnTitle(''); setAnnMsg(''); toast('Announcement published.'); news.reload()
  }
  async function removeMember(m: Mem) {
    if (!(await confirm({ title: 'Remove member?', message: `${m.profiles?.full_name || 'This member'} will lose access to this classroom. Their past attempts are kept.`, confirmLabel: 'Remove', danger: true }))) return
    const { error } = await supabase.from('classroom_members').delete().eq('classroom_id', id).eq('user_id', m.user_id)
    if (error) toast(error.message, 'error'); else { toast('Member removed.'); members.reload() }
  }
  async function leave() {
    if (!(await confirm({ title: 'Leave classroom?', message: 'You will no longer see its examinations. You can rejoin with the code while enrollment is open.', confirmLabel: 'Leave', danger: true }))) return
    const { error } = await supabase.from('classroom_members').delete().eq('classroom_id', id).eq('user_id', user!.id)
    if (error) toast(error.message, 'error'); else nav('/classrooms')
  }
  async function delAssignment(a: Asg) {
    if (!(await confirm({ title: 'Remove assignment?', message: 'Only possible while nobody has started it.', confirmLabel: 'Remove', danger: true }))) return
    const { error, count } = await supabase.from('assignments').delete({ count: 'exact' }).eq('id', a.id)
    if (error) toast(error.message, 'error'); else if (!count) toast('This assignment already has attempts, so it cannot be removed.', 'error'); else { toast('Removed.'); asg.reload() }
  }
  async function reschedule() {
    if (!resched) return
    const f = document.getElementById('rs-start') as HTMLInputElement, t = document.getElementById('rs-end') as HTMLInputElement
    const s = new Date(f.value), e = new Date(t.value)
    if (!f.value || !t.value || isNaN(s.getTime()) || isNaN(e.getTime())) { toast('Please enter both an opening and a closing time.', 'error'); return }
    if (e <= s) { toast('The window must close after it opens.', 'error'); return }
    try { await rpc('update_assignment_schedule', { p_assignment: resched.id, p_starts: s.toISOString(), p_closes: e.toISOString() }); toast('Schedule updated.'); setResched(null); asg.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function deleteClassroom() {
    if (!(await confirm({ title: 'Delete classroom?', message: 'Only possible if no examination was ever assigned to it. Otherwise archive it to keep the history.', confirmLabel: 'Delete', danger: true }))) return
    const { error, count } = await supabase.from('classrooms').delete({ count: 'exact' }).eq('id', id)
    if (error || !count) toast('This classroom has assigned examinations, so it can only be archived.', 'error'); else nav('/classrooms')
  }

  return (
    <>
      <PageHeader title={cl.name} subtitle={<span className="flex flex-wrap items-center gap-2">{cl.description}{cl.archived && <Badge tone="warn">Archived</Badge>}{owner && !cl.enrollment_open && <Badge>Enrollment closed</Badge>}</span>}
        actions={owner && !cl.archived ? <Button variant="primary" onClick={() => setAssign(true)}><CalendarPlus className="h-4 w-4" />Assign examination</Button> : undefined} />

      {owner && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
          <div><div className="text-xs uppercase tracking-wide text-muted">Joining code</div><div className="font-mono text-2xl font-bold tracking-[0.2em]">{cl.join_code}</div></div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => copy(cl.join_code, 'Code copied.')}><Copy className="h-3.5 w-3.5" />Copy code</Button>
            <Button size="sm" onClick={() => copy(link, 'Invitation link copied.')}><Copy className="h-3.5 w-3.5" />Copy link</Button>
            <Link className="btn btn-secondary btn-sm" to={`/classrooms/${id}/join-display`}><Maximize2 className="h-3.5 w-3.5" />Fullscreen</Link>
          </div>
        </Card>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'exams', label: 'Examinations', count: owner ? asg.data?.owner.length : asg.data?.student.length }, ...(owner ? [{ id: 'members' as const, label: 'Members', count: members.data?.length }] : []), { id: 'news', label: 'Announcements', count: news.data?.length }, { id: 'settings', label: 'Settings' }]} />

      {tab === 'exams' && (asg.loading && !asg.data ? <FullSpinner /> : asg.error ? <ErrorNote error={asg.error} retry={asg.reload} /> : owner ? (
        (asg.data?.owner.length ?? 0) === 0 ? <Empty title="No examinations assigned yet" text="This classroom is reusable: assign as many examinations to it as you like, on any date." action={!cl.archived && <Button variant="primary" onClick={() => setAssign(true)}>Assign examination</Button>} /> : (
          <div className="card divide-y divide-line">
            {asg.data!.owner.map((a) => {
              const w = windowState(a.starts_at, a.closes_at)
              return (
                <div key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.exam_versions.snapshot.title}</span>
                      <Badge tone={w === 'open' ? 'ok' : w === 'upcoming' ? 'accent' : 'neutral'}>{w === 'open' ? 'Active' : w === 'upcoming' ? 'Upcoming' : 'Completed'}</Badge>
                      {a.results_released_at && <Badge tone="ok">Results released</Badge>}</div>
                    <p className="mt-0.5 text-xs text-muted">{fmtDateTime(a.starts_at)} → {fmtDateTime(a.closes_at)} · {a.exam_versions.snapshot.questions.length} questions · {a.exam_versions.snapshot.durationMinutes} min · version {a.exam_versions.version_number}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Link to={`/analytics/${a.id}`} className="btn btn-secondary btn-sm"><BarChart3 className="h-3.5 w-3.5" />Results</Link>
                    <Button size="sm" onClick={() => setResched(a)}>Reschedule</Button>
                    <Button size="sm" variant="danger" onClick={() => delAssignment(a)} aria-label="Remove assignment"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (asg.data?.student.length ?? 0) === 0 ? <Empty title="No examinations yet" text="Examinations your teacher assigns will appear here." /> : <div className="card divide-y divide-line">{asg.data!.student.map((a) => <AssignedRow key={a.assignment_id} a={a} />)}</div>)}

      {tab === 'members' && owner && (members.loading && !members.data ? <FullSpinner /> : (members.data ?? []).length === 0 ? <Empty title="No members yet" text="Share the joining code or invitation link. Students join once and stay for every examination." /> : (
        <div className="card divide-y divide-line">{members.data!.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 p-3"><Avatar url={m.profiles?.avatar_url} name={m.profiles?.full_name || m.profiles?.email || '?'} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{m.profiles?.full_name || 'Unnamed'}</div><div className="truncate text-xs text-muted">{m.profiles?.email} · joined {fmtDateTime(m.joined_at)}</div></div>
            <Button size="sm" variant="danger" onClick={() => removeMember(m)}>Remove</Button></div>))}</div>
      ))}

      {tab === 'news' && (
        <div className="space-y-4">
          {owner && !cl.archived && (
            <Card className="p-4"><form onSubmit={post} className="space-y-3">
              <Field label="Title" htmlFor="at"><input id="at" className="input" value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} maxLength={200} required /></Field>
              <Field label="Message" htmlFor="am"><textarea id="am" className="input min-h-[80px]" value={annMsg} onChange={(e) => setAnnMsg(e.target.value)} maxLength={5000} required /></Field>
              <Button type="submit" variant="primary" loading={posting}>Publish announcement</Button></form></Card>)}
          {(news.data ?? []).length === 0 ? <Empty title="No announcements" /> : news.data!.map((a) => (
            <Card key={a.id} className="p-4"><div className="flex items-baseline justify-between gap-2"><h3 className="font-medium">{a.title}</h3><span className="shrink-0 text-xs text-muted">{fmtDateTime(a.published_at)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm">{a.message}</p>
              {owner && <Button size="sm" className="mt-2" onClick={async () => { const { error } = await supabase.from('announcements').delete().eq('id', a.id); if (error) toast(error.message, 'error'); else { toast('Announcement deleted.'); news.reload() } }}>Delete</Button>}</Card>))}
        </div>
      )}

      {tab === 'settings' && (owner ? (
        <Card className="max-w-xl space-y-4 p-5">
          <Field label="Name" htmlFor="sn"><input id="sn" className="input" value={sName ?? cl.name} onChange={(e) => setSName(e.target.value)} /></Field>
          <Field label="Description" htmlFor="sd"><textarea id="sd" className="input" value={sDesc ?? cl.description} onChange={(e) => setSDesc(e.target.value)} /></Field>
          <Button variant="primary" onClick={() => patch({ name: sName ?? cl.name, description: sDesc ?? cl.description })}>Save changes</Button>
          <hr className="border-line" />
          <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={!cl.enrollment_open} onChange={(e) => patch({ enrollment_open: !e.target.checked })} />Close enrollment (nobody new can join)</label>
          <div className="flex flex-wrap gap-2"><Button onClick={regen}><RefreshCw className="h-4 w-4" />Regenerate joining code</Button>
            <Button onClick={() => patch({ archived: !cl.archived })}>{cl.archived ? 'Unarchive classroom' : 'Archive classroom'}</Button>
            <Button variant="danger" onClick={deleteClassroom}>Delete classroom</Button></div>
        </Card>
      ) : <Card className="max-w-xl p-5"><p className="mb-3 text-sm text-muted">You joined this classroom as a member.</p><Button variant="danger" onClick={leave}>Leave classroom</Button></Card>)}

      <AssignModal open={assign} onClose={() => setAssign(false)} classroomId={id} onDone={asg.reload} />
      <Modal open={!!resched} onClose={() => setResched(null)} title="Reschedule" footer={<><Button onClick={() => setResched(null)}>Cancel</Button><Button variant="primary" onClick={reschedule}>Save</Button></>}>
        {resched && <div className="space-y-4"><Field label="Opens" htmlFor="rs-start"><input id="rs-start" type="datetime-local" className="input" defaultValue={toLocalInput(new Date(resched.starts_at))} /></Field><Field label="Window closes" htmlFor="rs-end"><input id="rs-end" type="datetime-local" className="input" defaultValue={toLocalInput(new Date(resched.closes_at))} /></Field></div>}
      </Modal>
    </>
  )
}
