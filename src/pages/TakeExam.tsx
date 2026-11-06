import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Cloud, CloudOff, Clock, Grid3x3 } from 'lucide-react'
import { rpc } from '../lib/api'
import { Answer, RunQuestion, StudentAssignment } from '../lib/types'
import { Badge, Button, Card, ErrorNote, FullSpinner, Modal, useFeedback, useLoad } from '../components/ui'
import QuestionView, { isAnswered } from '../components/QuestionView'
import { cx, errMsg, fmtClock, fmtDateTime, windowState } from '../lib/utils'
import { assignedStatus } from './Examinations'

interface AttemptData {
  attempt: { id: string; assignment_id: string; status: 'in_progress' | 'submitted'; deadline_at: string; attempt_number: number }
  server_now: string
  exam?: { title: string; description: string; durationMinutes: number; freeNavigation: boolean; questions: RunQuestion[] }
  shuffle?: Record<string, string[]>
  answers?: Record<string, Answer>
}

export default function TakeExam() {
  const { assignmentId = '' } = useParams()
  const { toast } = useFeedback()
  const brief = useLoad(async () => (await rpc<StudentAssignment[]>('student_assignments')).find((a) => a.assignment_id === assignmentId) ?? null, [assignmentId])
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [done, setDone] = useState(false)

  async function start() {
    setStarting(true)
    try { setAttemptId(await rpc<string>('start_attempt', { p_assignment: assignmentId })) } catch (e) { toast(errMsg(e), 'error'); brief.reload() } finally { setStarting(false) }
  }

  if (brief.loading && !brief.data) return <FullSpinner />
  if (brief.error) return <div className="p-6"><ErrorNote error={brief.error} retry={brief.reload} /></div>
  if (!brief.data) return <div className="mx-auto max-w-md p-6 text-center"><p>This examination was not found, or you are not a member of its classroom.</p><Link to="/" className="btn btn-primary mt-4">Dashboard</Link></div>
  const a = brief.data

  if (done) return (
    <div className="mx-auto mt-16 max-w-md p-6 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-ok" />
      <h1 className="mt-4 text-xl font-semibold">Your answers were submitted</h1>
      <p className="mt-2 text-sm text-muted">Your result will be visible once your teacher releases the results. You will get a notification.</p>
      <Link to="/" className="btn btn-primary mt-6">Back to dashboard</Link>
    </div>
  )
  if (attemptId) return <Runner attemptId={attemptId} onFinished={() => { setAttemptId(null); setDone(true) }} />

  const s = assignedStatus(a)
  const w = windowState(a.starts_at, a.closes_at)
  const canStart = (s.action === 'start' || s.action === 'resume') && !a.classroom_archived
  return (
    <div className="mx-auto max-w-xl p-4 md:p-8">
      <Link to="/examinations" className="text-sm text-muted hover:underline">← Examinations</Link>
      <Card className="mt-3 p-6">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{a.exam_title}</h1><Badge tone={s.tone}>{s.label}</Badge></div>
        <p className="mt-1 text-sm text-muted">{a.classroom_name}</p>
        {a.description && <p className="mt-3 whitespace-pre-wrap text-sm">{a.description}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Questions</dt><dd className="font-medium">{a.question_count}</dd></div>
          <div><dt className="text-muted">Duration</dt><dd className="font-medium">{a.duration_minutes} minutes</dd></div>
          <div><dt className="text-muted">Opens</dt><dd className="font-medium">{fmtDateTime(a.starts_at)}</dd></div>
          <div><dt className="text-muted">Closes</dt><dd className="font-medium">{fmtDateTime(a.closes_at)}</dd></div>
          <div className="col-span-2"><dt className="text-muted">Attempts</dt><dd className="font-medium">{a.attempts_used} used · {Math.max(0, a.attempts_allowed - a.attempts_used)} remaining</dd></div>
        </dl>
        <ul className="mt-5 list-disc space-y-1 pl-5 text-xs text-muted">
          <li>The timer is controlled by the server. Your answers are saved automatically; if you refresh or lose connection you can continue.</li>
          <li>When time runs out your attempt is submitted automatically.</li>
          <li>Results stay hidden until your teacher releases them.</li>
        </ul>
        {w === 'upcoming' && a.attempts_allowed === 1 && <p className="mt-4 rounded-md bg-subtle p-3 text-sm">This examination has not opened yet. It starts {fmtDateTime(a.starts_at)}.</p>}
        {canStart && <Button variant="primary" className="mt-5 w-full min-h-[48px]" loading={starting} onClick={start}>{s.action === 'resume' ? 'Resume examination' : 'Start examination'}</Button>}
        {s.action === 'result' && <Link to={`/results/${a.assignment_id}`} className="btn btn-primary mt-5 w-full">View result</Link>}
      </Card>
    </div>
  )
}

type SaveState = 'saved' | 'saving' | 'offline'

function Runner({ attemptId, onFinished }: { attemptId: string; onFinished: () => void }) {
  const { toast } = useFeedback()
  const [data, setData] = useState<AttemptData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [idx, setIdx] = useState(0)
  const [save, setSave] = useState<SaveState>('saved')
  const [grid, setGrid] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const offset = useRef(0)                       // serverTime - clientTime (ms)
  const pending = useRef<Record<string, Answer>>({})
  const flushing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const submittedRef = useRef(false)
  const aliveRef = useRef(true)
  const finishedRef = useRef(onFinished)       // parent passes a fresh arrow every render; reading it via a ref keeps flush/submit identities stable
  finishedRef.current = onFinished
  const key = `examina:pending:${attemptId}`
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; clearTimeout(timer.current) } }, [])

  const persistPending = () => { try { localStorage.setItem(key, JSON.stringify(pending.current)) } catch { /* storage full/blocked */ } }

  const load = useCallback(async () => {
    try {
      const d = await rpc<AttemptData>('get_attempt', { p_attempt: attemptId })
      offset.current = new Date(d.server_now).getTime() - Date.now()
      if (d.attempt.status !== 'in_progress') { localStorage.removeItem(key); finishedRef.current(); return }
      let local: Record<string, Answer> = {}
      try { local = JSON.parse(localStorage.getItem(key) || '{}') } catch { /* ignore */ }
      pending.current = local
      setAnswers({ ...(d.answers ?? {}), ...local })
      setData(d)
      if (Object.keys(local).length) { setSave('saving'); void flush() }
    } catch (e) { setError(errMsg(e)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId])
  useEffect(() => { void load() }, [load])

  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current) return
    flushing.current = true
    try {
      while (Object.keys(pending.current).length) {
        const entries = Object.entries(pending.current)
        for (const [qid, ans] of entries) {
          const res = await rpc<{ status: string; server_now?: string }>('save_answer', { p_attempt: attemptId, p_question: qid, p_answer: ans })
          if (res.status === 'expired' || res.status === 'submitted') { localStorage.removeItem(key); pending.current = {}; finishedRef.current(); return }
          if (res.server_now) offset.current = new Date(res.server_now).getTime() - Date.now()
          if (pending.current[qid] === ans) delete pending.current[qid]
          persistPending()
        }
      }
      setSave('saved')
    } catch {
      setSave('offline')
      clearTimeout(timer.current); timer.current = setTimeout(() => { void flush() }, 4000)   // retry with the saved progress kept locally
    } finally { flushing.current = false }
  }, [attemptId, key])

  useEffect(() => {
    const on = () => { setSave('saving'); void flush() }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)   // NOTE: must not clear the pending-save timer here (that silently dropped debounced saves)
  }, [flush])

  function change(q: RunQuestion, a: Answer) {
    setAnswers((prev) => ({ ...prev, [q.id]: a }))
    pending.current[q.id] = a; persistPending(); setSave('saving')
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush() }, 500)
  }

  const submit = useCallback(async (auto: boolean) => {
    if (submittedRef.current) return
    setSubmitting(true)
    try {
      await rpc('submit_attempt', { p_attempt: attemptId, p_answers: Object.keys(pending.current).length ? pending.current : null })
      submittedRef.current = true; localStorage.removeItem(key); finishedRef.current()
    } catch (e) {
      setSubmitting(false)
      if (auto) { if (aliveRef.current) setTimeout(() => { if (aliveRef.current) void submit(true) }, 3000) }   // keep trying until the server accepts it
      else toast('Could not submit — check your connection and try again. Your answers are kept.', 'error')
      void e
    }
  }, [attemptId, key, toast])

  // The clock lives in <Countdown> so that only the timer re-renders each second, not the whole question UI.
  const deadline = data ? new Date(data.attempt.deadline_at).getTime() : 0
  const autoRef = useRef(false)
  const expire = useCallback(() => { if (!autoRef.current) { autoRef.current = true; void submit(true) } }, [submit])

  const qs = data?.exam?.questions ?? []
  const free = data?.exam?.freeNavigation !== false
  const q = qs[idx]
  const answeredCount = useMemo(() => qs.filter((x) => isAnswered(x, answers[x.id])).length, [qs, answers])

  if (error) return <div className="p-6"><ErrorNote error={error} retry={() => { setError(null); void load() }} /></div>
  if (!data || !q) return <FullSpinner label="Loading your examination…" />

  const nav = (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-4">
      {qs.map((x, i) => (
        <button key={x.id} disabled={!free && i !== idx} onClick={() => { setIdx(i); setGrid(false) }} aria-label={`Question ${i + 1}${isAnswered(x, answers[x.id]) ? ', answered' : ', not answered'}`} aria-current={i === idx}
          className={cx('flex h-11 items-center justify-center rounded-md border text-sm font-medium tabular-nums', i === idx ? 'border-accent bg-accent text-white' : isAnswered(x, answers[x.id]) ? 'border-accent/40 bg-accent/10 text-accent-fg' : 'border-line hover:bg-subtle', !free && i !== idx && 'opacity-40')}>{i + 1}</button>
      ))}
    </div>
  )

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{data.exam!.title}</div>
            <div className="flex items-center gap-1 text-xs text-muted" role="status" aria-live="polite">
              {save === 'offline' ? <><CloudOff className="h-3.5 w-3.5 text-warn" /><span className="text-warn">Offline — answers kept, will sync</span></> : save === 'saving' ? <><Cloud className="h-3.5 w-3.5" />Saving…</> : <><Cloud className="h-3.5 w-3.5 text-ok" />All answers saved</>}</div></div>
          <Countdown deadline={deadline} offset={offset} onExpire={expire} pill />
          <Button variant="primary" className="hidden md:inline-flex" onClick={() => setConfirming(true)}>Submit</Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-6 px-4 py-5 md:py-8">
        <main className="min-w-0 flex-1">
          <div translate="no" className="mb-3 text-sm text-muted">Question {idx + 1} of {qs.length} · {answeredCount} answered</div>
          <Card className="p-4 md:p-6"><QuestionView q={q} answer={answers[q.id]} onChange={(a) => change(q, a)} order={data.shuffle?.[q.id]} /></Card>
          <div className="mt-4 flex items-center gap-2 pb-24 md:pb-0">
            {free && <Button className="min-h-[48px] flex-1 md:flex-none" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button>}
            {idx < qs.length - 1
              ? <Button variant="primary" className="min-h-[48px] flex-1 md:flex-none" onClick={() => setIdx(idx + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
              : <Button variant="primary" className="min-h-[48px] flex-1 md:flex-none" onClick={() => setConfirming(true)}>Review & submit</Button>}
          </div>
        </main>
        <aside className="hidden w-56 shrink-0 md:block"><div className="card sticky top-20 p-3"><div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Questions</div>{nav}
          <div translate="no" className="mt-3 text-xs text-muted">{answeredCount}/{qs.length} answered</div></div></aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <Button className="min-h-[48px] flex-1" onClick={() => setGrid(true)} disabled={!free}><Grid3x3 className="h-4 w-4" />{answeredCount}/{qs.length}</Button>
        <Button variant="primary" className="min-h-[48px] flex-1" onClick={() => setConfirming(true)}>Submit</Button>
      </div>

      <Modal open={grid} onClose={() => setGrid(false)} title="Jump to question">{nav}</Modal>
      <Modal open={confirming} onClose={() => setConfirming(false)} title="Submit examination?"
        footer={<><Button onClick={() => setConfirming(false)} disabled={submitting}>Keep working</Button><Button variant="primary" loading={submitting} onClick={() => submit(false)}>Submit now</Button></>}>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-subtle p-3"><div translate="no" className="text-xl font-semibold tabular-nums">{answeredCount}/{qs.length}</div><div className="text-xs text-muted">Answered</div></div>
            <div className="rounded-md bg-subtle p-3"><div translate="no" className="text-xl font-semibold tabular-nums">{qs.length - answeredCount}/{qs.length}</div><div className="text-xs text-muted">Unanswered</div></div>
            <div className="rounded-md bg-subtle p-3"><div className="text-xl font-semibold tabular-nums"><Countdown deadline={deadline} offset={offset} /></div><div className="text-xs text-muted">Time left</div></div>
          </div>
          {qs.length - answeredCount > 0 && <p className="flex items-start gap-2 text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Unanswered: {qs.map((x, i) => (isAnswered(x, answers[x.id]) ? null : i + 1)).filter(Boolean).join(', ')}</p>}
          <p className="text-muted">After submitting you cannot change your answers.{save === 'offline' && ' You appear to be offline; submitting needs a connection.'}</p>
        </div>
      </Modal>
    </div>
  )
}

/** Ticks locally against the server-synchronised deadline. Re-renders only itself, and only when the displayed second changes. */
function Countdown({ deadline, offset, onExpire, pill }: { deadline: number; offset: { current: number }; onExpire?: () => void; pill?: boolean }) {
  const calc = () => (deadline - (Date.now() + offset.current)) / 1000
  const [secs, setSecs] = useState(() => Math.ceil(calc()))
  const expireRef = useRef(onExpire)
  expireRef.current = onExpire
  const fired = useRef(false)
  useEffect(() => {
    const tick = () => {
      const r = calc()
      setSecs(Math.ceil(r))
      if (r <= 0 && !fired.current) { fired.current = true; expireRef.current?.() }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline])
  if (!pill) return <span translate="no">{fmtClock(secs)}</span>
  return (
    <div translate="no" className={cx('flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-lg font-semibold tabular-nums', secs < 300 ? 'bg-danger/10 text-danger' : 'bg-subtle')} role="timer" aria-label={`Time remaining ${fmtClock(secs)}`}>
      <Clock className="h-4 w-4" />{fmtClock(secs)}
    </div>
  )
}
