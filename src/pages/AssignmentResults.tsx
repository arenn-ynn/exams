import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, FileText, Radio, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { AttemptRow, computeResults, GrantRow, gradeBuckets, MemberRow, Snapshot, StudentResult } from '../lib/analytics'
import { exportCsv, exportPdf, ReportMeta } from '../lib/exports'
import { AttemptDetail } from '../lib/types'
import { Badge, Button, Card, ErrorNote, Field, FullSpinner, Modal, PageHeader, Stat, useFeedback, useLoad } from '../components/ui'
import AttemptDetailView from '../components/AttemptDetailView'
import { errMsg, fmtDateTime, fmtDuration, pct } from '../lib/utils'

interface Bundle {
  assignment: { id: string; classroom_id: string; starts_at: string; closes_at: string; results_released_at: string | null; classrooms: { name: string }; exam_versions: { snapshot: Snapshot; version_number: number } }
  members: MemberRow[]; attempts: AttemptRow[]; grants: GrantRow[]
}

async function fetchBundle(id: string): Promise<Bundle> {
  await rpc('finalize_expired', { p_assignment: id })
  const a = await supabase.from('assignments').select('id,classroom_id,starts_at,closes_at,results_released_at,classrooms(name),exam_versions(version_number,snapshot)').eq('id', id).single()
  if (a.error) throw new Error('Assignment not found.')
  const asg = a.data as unknown as Bundle['assignment']
  const [m, t, g] = await Promise.all([
    supabase.from('classroom_members').select('user_id,profiles(full_name,email)').eq('classroom_id', asg.classroom_id),
    supabase.from('attempts').select('id,user_id,attempt_number,status,started_at,submitted_at,score,max_score,percent,passed,student_answers(question_id,is_answered,is_correct,points_awarded)').eq('assignment_id', id),
    supabase.from('attempt_grants').select('user_id').eq('assignment_id', id),
  ])
  for (const r of [m, t, g]) if (r.error) throw r.error
  return { assignment: asg, members: m.data as unknown as MemberRow[], attempts: t.data as unknown as AttemptRow[], grants: g.data as GrantRow[] }
}

export default function AssignmentResults() {
  const { assignmentId = '' } = useParams()
  const { toast } = useFeedback()
  const b = useLoad(() => fetchBundle(assignmentId), [assignmentId])
  const [live, setLive] = useState(false)
  const [releaseWarn, setReleaseWarn] = useState<{ total: number; submitted: number; in_progress: number; not_started: number } | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [grantFor, setGrantFor] = useState<StudentResult | null>(null)
  const [reason, setReason] = useState('')
  const [detailFor, setDetailFor] = useState<StudentResult | null>(null)
  const [detail, setDetail] = useState<{ id: string; data: AttemptDetail | null; err?: string }[]>([])

  // Live progress while students are taking the exam (RLS limits events to the classroom owner).
  // Events are coalesced: when a whole class submits at once we refetch once, not once per student.
  const reloadRef = useRef(b.reload)
  reloadRef.current = b.reload
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const ch = supabase.channel(`attempts-${assignmentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts', filter: `assignment_id=eq.${assignmentId}` }, () => {
        clearTimeout(timer); timer = setTimeout(() => reloadRef.current(), 1500)
      })
      .subscribe((s) => setLive(s === 'SUBSCRIBED'))
    return () => { clearTimeout(timer); void supabase.removeChannel(ch) }
  }, [assignmentId])

  const computed = useMemo(() => (b.data ? computeResults(b.data.assignment.exam_versions.snapshot, b.data.members, b.data.attempts, b.data.grants) : null), [b.data])
  if (b.loading && !b.data) return <FullSpinner />
  if (b.error || !b.data || !computed) return <ErrorNote error={b.error ?? 'Not found'} retry={b.reload} />
  const { assignment: a } = b.data
  const snap = a.exam_versions.snapshot
  const { students, overview: o, questionStats } = computed
  const meta: ReportMeta = { examTitle: snap.title, classroom: a.classrooms.name, startsAt: a.starts_at, passingGrade: snap.passingGrade, releasedAt: a.results_released_at }

  async function release(force: boolean) {
    setReleasing(true)
    try {
      const r = await rpc<{ released: boolean; total: number; submitted: number; in_progress: number; not_started: number }>('release_results', { p_assignment: assignmentId, p_force: force })
      if (!r.released) setReleaseWarn(r); else { setReleaseWarn(null); toast('Results released. Students were notified.'); b.reload() }
    } catch (e) { toast(errMsg(e), 'error') } finally { setReleasing(false) }
  }
  async function grant() {
    if (!grantFor) return
    try { await rpc('grant_attempt', { p_assignment: assignmentId, p_user: grantFor.userId, p_reason: reason }); toast(`Additional attempt granted to ${grantFor.name}.`); setGrantFor(null); setReason(''); b.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function openDetail(s: StudentResult) {
    setDetailFor(s); setDetail([])
    const mine = b.data!.attempts.filter((x) => x.user_id === s.userId && x.status === 'submitted').sort((x, y) => x.attempt_number - y.attempt_number)
    const res = await Promise.all(mine.map(async (x) => { try { return { id: x.id, data: await rpc<AttemptDetail>('get_attempt_detail', { p_attempt: x.id }) } } catch (e) { return { id: x.id, data: null, err: errMsg(e) } } }))
    setDetail(res)
  }
  const maxCount = Math.max(1, ...gradeBuckets(students.filter((s) => s.percent !== null).map((s) => s.percent!)).map((x) => x.count))
  const statusBadge = (s: StudentResult) => s.status === 'submitted' ? <Badge tone="ok">Submitted</Badge> : s.status === 'started' ? <Badge tone="accent">In progress</Badge> : <Badge>Not started</Badge>

  return (
    <>
      <Link to="/analytics" className="text-sm text-muted hover:underline">← All analytics</Link>
      <PageHeader title={snap.title} subtitle={<span className="flex flex-wrap items-center gap-2">{a.classrooms.name} · opens {fmtDateTime(a.starts_at)} · closes {fmtDateTime(a.closes_at)}{live && <Badge tone="ok"><Radio className="h-3 w-3" />Live</Badge>}</span>}
        actions={<>
          <Button onClick={() => exportCsv(meta, students)}><Download className="h-4 w-4" />CSV</Button>
          <Button onClick={() => exportPdf(meta, o, students, questionStats).catch((e) => toast(errMsg(e), 'error'))}><FileText className="h-4 w-4" />PDF</Button>
          {a.results_released_at ? <Badge tone="ok">Released {fmtDateTime(a.results_released_at)}</Badge> : <Button variant="primary" loading={releasing} onClick={() => release(false)}><Send className="h-4 w-4" />Release results</Button>}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Enrolled" value={o.enrolled} /><Stat label="Not started" value={o.notStarted} /><Stat label="In progress" value={o.inProgress} /><Stat label="Submitted" value={`${o.submitted}/${o.enrolled}`} />
        <Stat label="Average" value={o.average === null ? '—' : pct(o.average)} /><Stat label="Highest / lowest" value={o.highest === null ? '—' : `${pct(o.highest)} / ${pct(o.lowest!)}`} />
        <Stat label="Pass rate" value={o.passRate === null ? '—' : pct(o.passRate)} sub={`pass mark ${snap.passingGrade}%`} /><Stat label="Avg. completion time" value={o.avgTimeSeconds === null ? '—' : fmtDuration(o.avgTimeSeconds)} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5"><h2 className="mb-4 font-semibold">Grade distribution</h2>
          <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Histogram of grades">{gradeBuckets(students.filter((s) => s.percent !== null).map((s) => s.percent!)).map((x) => (
            <div key={x.label} className="flex flex-1 flex-col items-center justify-end gap-1"><span className="text-[10px] tabular-nums text-muted">{x.count || ''}</span><div className="w-full rounded-t bg-accent" style={{ height: `${(x.count / maxCount) * 100}%`, minHeight: x.count ? 4 : 1, opacity: x.count ? 1 : 0.2 }} /><span className="text-[9px] text-muted">{x.label.split('–')[0]}</span></div>))}</div></Card>
        <Card className="p-5"><h2 className="mb-3 font-semibold">Hardest questions</h2>
          {o.submitted === 0 ? <p className="text-sm text-muted">Shown once students submit.</p> : <ol className="space-y-2 text-sm">{[...questionStats].sort((x, y) => x.percentCorrect - y.percentCorrect).slice(0, 5).map((q) => (
            <li key={q.id} className="flex items-center gap-3"><span className="w-7 text-muted">Q{q.index}</span><span className="min-w-0 flex-1 truncate">{q.text}</span><span className="tabular-nums">{Math.round(q.percentCorrect)}%</span></li>))}</ol>}</Card>
      </div>

      <h2 className="mb-2 font-semibold">Students</h2>
      <div className="card mb-8 hidden xl:block"><table className="w-full">
        <thead className="border-b border-line"><tr><th className="th">Name</th><th className="th">Status</th><th className="th">Grade</th><th className="th">Correct</th><th className="th">Incorrect</th><th className="th">Unanswered</th><th className="th">Time</th><th className="th">Attempts</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-line">{students.length === 0 && <tr><td className="td text-muted" colSpan={9}>No members in this classroom yet.</td></tr>}
          {students.map((s) => (
            <tr key={s.userId}>
              <td className="td"><div className="font-medium">{s.name}</div><div className="text-xs text-muted">{s.email}</div></td><td className="td">{statusBadge(s)}</td>
              <td className="td tabular-nums">{s.percent === null ? '—' : <span className={s.passed ? 'text-ok' : 'text-danger'}>{s.percent}%</span>}{s.score !== null && <span className="ml-1 text-xs text-muted">({s.score}/{s.maxScore})</span>}</td>
              <td className="td tabular-nums">{s.status === 'submitted' ? s.correct : '—'}</td><td className="td tabular-nums">{s.status === 'submitted' ? s.incorrect : '—'}</td><td className="td tabular-nums">{s.status === 'submitted' ? s.unanswered : '—'}</td>
              <td className="td tabular-nums">{s.timeSpentSeconds === null ? '—' : fmtDuration(s.timeSpentSeconds)}</td><td className="td tabular-nums">{s.attemptsUsed}/{s.attemptsAllowed}</td>
              <td className="td"><div className="flex justify-end gap-1.5">{s.status === 'submitted' && <Button size="sm" onClick={() => openDetail(s)}>Details</Button>}<Button size="sm" onClick={() => setGrantFor(s)}>Grant attempt</Button></div></td>
            </tr>))}</tbody></table></div>
      {/* Below xl the 9-column table cannot fit without sideways scrolling, so each student becomes a card. */}
      <div className="mb-8 space-y-3 xl:hidden">
        {students.length === 0 && <Card className="p-4 text-sm text-muted">No members in this classroom yet.</Card>}
        {students.map((s) => (
          <Card key={s.userId} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="font-medium">{s.name}</div><div className="text-xs text-muted">{s.email}</div></div>
              <div className="shrink-0">{statusBadge(s)}</div>
            </div>
            <div className="mt-3 flex items-baseline gap-2 tabular-nums">
              <span className="text-2xl font-semibold">{s.percent === null ? '—' : <span className={s.passed ? 'text-ok' : 'text-danger'}>{s.percent}%</span>}</span>
              {s.score !== null && <span className="text-xs text-muted">({s.score}/{s.maxScore})</span>}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-sm sm:grid-cols-5">
              <div><dt className="text-xs text-muted">Correct</dt><dd className="tabular-nums">{s.status === 'submitted' ? s.correct : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Incorrect</dt><dd className="tabular-nums">{s.status === 'submitted' ? s.incorrect : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Unanswered</dt><dd className="tabular-nums">{s.status === 'submitted' ? s.unanswered : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Time</dt><dd className="tabular-nums">{s.timeSpentSeconds === null ? '—' : fmtDuration(s.timeSpentSeconds)}</dd></div>
              <div><dt className="text-xs text-muted">Attempts</dt><dd className="tabular-nums">{s.attemptsUsed}/{s.attemptsAllowed}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.status === 'submitted' && <Button size="sm" className="min-h-[40px] flex-1 sm:flex-none" onClick={() => openDetail(s)}>Details</Button>}
              <Button size="sm" className="min-h-[40px] flex-1 sm:flex-none" onClick={() => setGrantFor(s)}>Grant attempt</Button>
            </div>
          </Card>))}
      </div>

      <h2 className="mb-2 font-semibold">Question analysis</h2>
      <div className="card divide-y divide-line">{questionStats.map((q) => (
        <div key={q.id} className="p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm"><span className="mr-2 text-muted">Q{q.index}</span>{q.text}</p><span className="shrink-0 text-sm font-semibold tabular-nums">{Math.round(q.percentCorrect)}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${Math.round(q.percentCorrect)} percent answered correctly`}><div className={q.percentCorrect < 50 ? 'h-full bg-danger' : q.percentCorrect < 75 ? 'h-full bg-warn' : 'h-full bg-ok'} style={{ width: `${q.percentCorrect}%` }} /></div>
          <p className="mt-1.5 text-xs text-muted">{q.answered} answered · {q.correct} correct · {q.incorrect} incorrect · {q.skipped} skipped</p></div>))}
        {o.submitted === 0 && <p className="p-4 text-sm text-muted">No submissions yet — statistics appear as students submit.</p>}</div>

      <Modal open={!!releaseWarn} onClose={() => setReleaseWarn(null)} title="Not everyone has submitted"
        footer={<><Button onClick={() => setReleaseWarn(null)}>Wait</Button><Button variant="primary" loading={releasing} onClick={() => release(true)}>Release anyway</Button></>}>
        {releaseWarn && <div className="space-y-2 text-sm"><p>Only <b>{releaseWarn.submitted}</b> of <b>{releaseWarn.total}</b> students have submitted ({releaseWarn.in_progress} in progress, {releaseWarn.not_started} not started).</p><p className="text-muted">After release, students see their grades and correct answers. Students who have not finished may still see results for what they submit later.</p></div>}
      </Modal>
      <Modal open={!!grantFor} onClose={() => setGrantFor(null)} title={`Grant additional attempt — ${grantFor?.name ?? ''}`}
        footer={<><Button onClick={() => setGrantFor(null)}>Cancel</Button><Button variant="primary" onClick={grant} disabled={!reason.trim()}>Grant attempt</Button></>}>
        <div className="space-y-3"><p className="text-sm text-muted">Their previous attempts and grades are kept. They are notified and now have {grantFor ? grantFor.attemptsAllowed + 1 : ''} attempts in total ({grantFor?.attemptsUsed} used). Granted attempts ignore the original time window.</p>
          <Field label="Reason (recorded)" htmlFor="gr"><textarea id="gr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Lost connection during the exam" /></Field></div>
      </Modal>
      <Modal wide open={!!detailFor} onClose={() => setDetailFor(null)} title={`Result — ${detailFor?.name ?? ''}`}>
        {detail.length === 0 ? <FullSpinner /> : <div className="space-y-8">{detail.map((d) => d.data ? <AttemptDetailView key={d.id} d={d.data} /> : <ErrorNote key={d.id} error={d.err ?? 'Could not load'} />)}</div>}
      </Modal>
    </>
  )
}
