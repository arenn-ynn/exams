import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, CalendarPlus, Copy, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Badge, Button, Empty, ErrorNote, FullSpinner, PageHeader, Tabs, useFeedback, useLoad } from '../components/ui'
import AssignModal from '../components/AssignModal'
import { errMsg, fmtDate, fmtDateTime, windowState } from '../lib/utils'
import { ExamStatus, StudentAssignment } from '../lib/types'

interface ExamRow { id: string; title: string; description: string; status: ExamStatus; duration_minutes: number; passing_grade: number; updated_at: string; questions: { count: number }[] }
const PAGE = 30
const tone = { draft: 'neutral', published: 'ok', archived: 'warn' } as const

export default function Examinations() {
  const { user } = useAuth()
  const nav = useNavigate()
  const { toast, confirm } = useFeedback()
  const [tab, setTab] = useState<'mine' | 'assigned'>('mine')
  const [limit, setLimit] = useState(PAGE)
  const [assignFor, setAssignFor] = useState<string | null>(null)

  const mine = useLoad(async () => {
    const { data, error } = await supabase.from('exams').select('id,title,description,status,duration_minutes,passing_grade,updated_at,questions(count)')
      .eq('owner_id', user!.id).order('updated_at', { ascending: false }).range(0, limit - 1)
    if (error) throw error
    return data as unknown as ExamRow[]
  }, [user?.id, limit])
  const assigned = useLoad(() => rpc<StudentAssignment[]>('student_assignments'), [])

  async function setStatus(id: string, s: ExamStatus) {
    try { await rpc('set_exam_status', { p_exam: id, p_status: s }); toast(s === 'archived' ? 'Examination archived.' : 'Status updated.'); mine.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function duplicate(id: string) {
    try {
      const { data, error } = await supabase.from('exams').select('title,description,duration_minutes,passing_grade,randomize_options,free_navigation,questions(type,text,points,position,answer_options(text,is_correct,position),matching_pairs(left_text,right_text,position))').eq('id', id).single()
      if (error) throw error
      type Q = { type: string; text: string; points: number; position: number; answer_options: { text: string; is_correct: boolean; position: number }[]; matching_pairs: { left_text: string; right_text: string; position: number }[] }
      const d = data as unknown as { title: string; description: string; duration_minutes: number; passing_grade: number; randomize_options: boolean; free_navigation: boolean; questions: Q[] }
      const newId = await rpc<string>('save_exam', { p_exam_id: null, p: {
        title: `${d.title} (copy)`, description: d.description, durationMinutes: d.duration_minutes, passingGrade: d.passing_grade, randomizeOptions: d.randomize_options, freeNavigation: d.free_navigation,
        questions: [...d.questions].sort((a, b) => a.position - b.position).map((q) => ({ type: q.type, text: q.text, points: q.points,
          options: [...q.answer_options].sort((a, b) => a.position - b.position).map((o) => ({ text: o.text, correct: o.is_correct })),
          pairs: [...q.matching_pairs].sort((a, b) => a.position - b.position).map((p) => ({ left: p.left_text, right: p.right_text })) })) } })
      toast('Duplicated as a new draft.'); nav(`/examinations/${newId}`)
    } catch (e) { toast(errMsg(e), 'error') }
  }
  async function remove(r: ExamRow) {
    if (!(await confirm({ title: 'Delete examination?', message: `"${r.title}" and its questions will be permanently deleted. Examinations that were already assigned cannot be deleted — archive them instead.`, confirmLabel: 'Delete', danger: true }))) return
    const { error } = await supabase.from('exams').delete().eq('id', r.id)
    if (error) toast(/foreign key|violates/i.test(error.message) ? 'This examination has been assigned to a classroom, so it cannot be deleted. Archive it instead.' : error.message, 'error')
    else { toast('Deleted.'); mine.reload() }
  }

  const rows = mine.data ?? []
  return (
    <>
      <PageHeader title="Examinations" subtitle="Examinations you created are independent of classrooms until you assign them." actions={<Link to="/examinations/new" className="btn btn-primary"><Plus className="h-4 w-4" />Create examination</Link>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mine', label: 'Created by me', count: mine.data?.length }, { id: 'assigned', label: 'Assigned to me', count: assigned.data?.length }]} />

      {tab === 'mine' && (mine.loading && !mine.data ? <FullSpinner /> : mine.error ? <ErrorNote error={mine.error} retry={mine.reload} /> : rows.length === 0 ? (
        <Empty icon={<FileText className="h-8 w-8" />} title="No examinations yet" text="Create one with AI or import a JSON file, then assign it to any of your classrooms." action={<Link to="/examinations/new" className="btn btn-primary">Create examination</Link>} />
      ) : (
        <>
          <div className="card divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="flex items-center gap-2"><Link to={`/examinations/${r.id}`} className="truncate font-medium hover:underline">{r.title}</Link><Badge tone={tone[r.status]}>{r.status}</Badge></div>
                  <p className="mt-0.5 text-xs text-muted">{r.questions[0]?.count ?? 0} questions · {r.duration_minutes} min · pass {r.passing_grade}% · edited {fmtDate(r.updated_at)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.status === 'published' && <Button size="sm" onClick={() => setAssignFor(r.id)}><CalendarPlus className="h-3.5 w-3.5" />Assign</Button>}
                  <Link to={`/examinations/${r.id}`} className="btn btn-secondary btn-sm"><Pencil className="h-3.5 w-3.5" />Edit</Link>
                  <Button size="sm" onClick={() => duplicate(r.id)} aria-label={`Duplicate ${r.title}`}><Copy className="h-3.5 w-3.5" /></Button>
                  {r.status !== 'archived' && <Button size="sm" onClick={() => setStatus(r.id, 'archived')} aria-label={`Archive ${r.title}`}><Archive className="h-3.5 w-3.5" /></Button>}
                  {r.status === 'archived' && <Button size="sm" onClick={() => setStatus(r.id, 'published')}>Restore</Button>}
                  <Button size="sm" variant="danger" onClick={() => remove(r)} aria-label={`Delete ${r.title}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
          {rows.length >= limit && <div className="mt-4 text-center"><Button onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>}
        </>
      ))}

      {tab === 'assigned' && (assigned.loading && !assigned.data ? <FullSpinner /> : assigned.error ? <ErrorNote error={assigned.error} retry={assigned.reload} /> : (assigned.data ?? []).length === 0 ? (
        <Empty icon={<FileText className="h-8 w-8" />} title="Nothing assigned to you" text="Examinations assigned to classrooms you have joined will appear here." action={<Link to="/classrooms" className="btn btn-primary">Join a classroom</Link>} />
      ) : (
        <div className="card divide-y divide-line">
          {assigned.data!.map((a) => <AssignedRow key={a.assignment_id} a={a} />)}
        </div>
      ))}
      <AssignModal open={!!assignFor} onClose={() => setAssignFor(null)} examId={assignFor ?? undefined} onDone={() => setAssignFor(null)} />
    </>
  )
}

export function assignedStatus(a: StudentAssignment): { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; action: 'start' | 'resume' | 'result' | 'none' } {
  if (a.results_released_at && a.submitted_count > 0) return { label: 'Result released', tone: 'ok', action: 'result' }
  if (a.in_progress_attempt_id) return { label: 'In progress', tone: 'accent', action: 'resume' }
  const hasLeft = a.attempts_used < a.attempts_allowed
  if (a.submitted_count > 0 && !hasLeft) return { label: 'Submitted · awaiting release', tone: 'warn', action: 'none' }
  const w = windowState(a.starts_at, a.closes_at)
  if (hasLeft && a.attempts_allowed > 1) return { label: 'Additional attempt available', tone: 'accent', action: 'start' }
  if (w === 'upcoming') return { label: 'Upcoming', tone: 'neutral', action: 'none' }
  if (w === 'open') return { label: 'Open now', tone: 'ok', action: 'start' }
  return { label: a.submitted_count ? 'Completed' : 'Missed', tone: a.submitted_count ? 'neutral' : 'danger', action: 'none' }
}

export function AssignedRow({ a }: { a: StudentAssignment }) {
  const s = assignedStatus(a)
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.exam_title}</span><Badge tone={s.tone}>{s.label}</Badge></div>
        <p className="mt-0.5 text-xs text-muted">{a.classroom_name} · {a.question_count} questions · {a.duration_minutes} min · opens {fmtDateTime(a.starts_at)}</p>
      </div>
      {s.action === 'result' ? <Link to={`/results/${a.assignment_id}`} className="btn btn-secondary btn-sm">View result</Link>
        : s.action !== 'none' ? <Link to={`/take/${a.assignment_id}`} className="btn btn-primary btn-sm">{s.action === 'resume' ? 'Resume' : 'Open'}</Link>
        : <Link to={`/take/${a.assignment_id}`} className="btn btn-ghost btn-sm">Details</Link>}
    </div>
  )
}
