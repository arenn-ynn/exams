import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, Plus, RefreshCw, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { aiStatus, callAi, rpc } from '../lib/api'
import { blankExam, blankQuestion, convertQuestionType, draftProblems, draftToJson, draftToPayload, validateExamJson } from '../lib/examSchema'
import { DraftQuestion, ExamDraft, ExamStatus, QTYPE_LABEL, QType, RunQuestion } from '../lib/types'
import { Badge, Button, Card, Field, FullSpinner, Modal, PageHeader, useFeedback, useLoad, ErrorNote } from '../components/ui'
import QuestionView from '../components/QuestionView'
import AssignModal from '../components/AssignModal'
import { errMsg, uid } from '../lib/utils'

const toRun = (q: DraftQuestion): RunQuestion => ({
  id: q.id, type: q.type, text: q.text || '(empty question)', points: q.points,
  options: q.options.map((o) => ({ id: o.id, text: o.text || '(empty)' })),
  left: q.pairs.map((p) => ({ id: p.id, text: p.left || '(empty)' })), right: q.pairs.map((p) => ({ id: p.id, text: p.right || '(empty)' })),
})

interface DbExam { id: string; title: string; description: string; duration_minutes: number; passing_grade: number; randomize_options: boolean; free_navigation: boolean; status: ExamStatus
  questions: { id: string; type: QType; text: string; points: number; position: number; answer_options: { id: string; text: string; is_correct: boolean; position: number }[]; matching_pairs: { id: string; left_text: string; right_text: string; position: number }[] }[] }

async function loadExam(id: string): Promise<{ draft: ExamDraft; status: ExamStatus }> {
  const { data, error } = await supabase.from('exams').select('id,title,description,duration_minutes,passing_grade,randomize_options,free_navigation,status,questions(id,type,text,points,position,answer_options(id,text,is_correct,position),matching_pairs(id,left_text,right_text,position))').eq('id', id).single()
  if (error) throw new Error(error.code === 'PGRST116' ? 'Examination not found.' : error.message)
  const d = data as unknown as DbExam
  return {
    status: d.status,
    draft: { title: d.title, description: d.description, durationMinutes: d.duration_minutes, passingGrade: Number(d.passing_grade), randomizeOptions: d.randomize_options, freeNavigation: d.free_navigation,
      questions: [...d.questions].sort((a, b) => a.position - b.position).map((q) => ({ id: q.id, type: q.type, text: q.text, points: Number(q.points),
        options: [...q.answer_options].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, text: o.text, correct: o.is_correct })),
        pairs: [...q.matching_pairs].sort((a, b) => a.position - b.position).map((p) => ({ id: p.id, left: p.left_text, right: p.right_text })) })) },
  }
}

export default function ExamEditor() {
  const { id = 'blank' } = useParams()
  const isNew = id === 'blank' || id === 'new'
  const loc = useLocation() as { state?: { draft?: ExamDraft } }
  const nav = useNavigate()
  const { toast, confirm } = useFeedback()
  const [draft, setDraft] = useState<ExamDraft | null>(null)
  const [status, setStatus] = useState<ExamStatus>('draft')
  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)   // read by the navigation blocker; cleared *before* a post-save redirect so that redirect isn't blocked
  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v) }
  const [regen, setRegen] = useState<{ index: number; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [preview, setPreview] = useState<DraftQuestion | 'all' | null>(null)
  const [assign, setAssign] = useState(false)
  const [undo, setUndo] = useState<ExamDraft | null>(null)
  const [ai, setAi] = useState<{ configured: boolean } | null>(null)
  const [instr, setInstr] = useState('')
  const [aiBusy, setAiBusy] = useState<string | null>(null)

  const loaded = useLoad(async () => {
    if (isNew) return { draft: loc.state?.draft ?? blankExam(), status: 'draft' as ExamStatus }
    return loadExam(id)
  }, [id])
  useEffect(() => { if (loaded.data) { setDraft(loaded.data.draft); setStatus(loaded.data.status); setDirty(isNew && !!loc.state?.draft); setUndo(null) } }, [loaded.data]) // eslint-disable-line
  useEffect(() => { void aiStatus().then(setAi) }, [])
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  // In-app navigation (menu, bottom nav, links) would otherwise silently throw the draft away.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirm({ title: 'Discard unsaved changes?', message: 'You have changes that have not been saved. If you leave now they will be lost.', confirmLabel: 'Discard changes', danger: true })
      .then((ok) => { if (ok) { dirtyRef.current = false; blocker.proceed() } else blocker.reset() })
  }, [blocker, confirm])

  const total = useMemo(() => (draft?.questions ?? []).reduce((s, q) => s + (Number(q.points) || 0), 0), [draft])
  if (loaded.loading && !draft) return <FullSpinner />
  if (loaded.error) return <ErrorNote error={loaded.error} />
  if (!draft) return null

  const edit = (fn: (d: ExamDraft) => ExamDraft) => { setDraft(fn(draft)); setDirty(true) }
  const setQ = (qid: string, fn: (q: DraftQuestion) => DraftQuestion) => edit((d) => ({ ...d, questions: d.questions.map((q) => (q.id === qid ? fn(q) : q)) }))
  const move = (i: number, dir: -1 | 1) => edit((d) => { const qs = [...d.questions]; const j = i + dir; if (j < 0 || j >= qs.length) return d; [qs[i], qs[j]] = [qs[j], qs[i]]; return { ...d, questions: qs } })
  const addQ = (t: QType) => { const q = blankQuestion(t); edit((d) => ({ ...d, questions: [...d.questions, q] })); setOpen(q.id) }
  const dup = (q: DraftQuestion, i: number) => edit((d) => {
    const copy: DraftQuestion = { ...q, id: uid(), options: q.options.map((o) => ({ ...o, id: uid() })), pairs: q.pairs.map((p) => ({ ...p, id: uid() })) }
    const qs = [...d.questions]; qs.splice(i + 1, 0, copy); return { ...d, questions: qs }
  })

  async function save(): Promise<string | null> {
    const problems = draftProblems(draft!)
    if (problems.length) { toast(problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : ''), 'error'); return null }
    setSaving(true)
    try {
      const newId = await rpc<string>('save_exam', { p_exam_id: isNew ? null : id, p: draftToPayload(draft!) })
      setDirty(false); toast('Saved.')
      if (isNew) nav(`/examinations/${newId}`, { replace: true }); else loaded.reload()
      return newId
    } catch (e) { toast(errMsg(e), 'error'); return null } finally { setSaving(false) }
  }
  async function publish() {
    const eid = await save(); if (!eid) return
    try { await rpc('set_exam_status', { p_exam: eid, p_status: 'published' }); setStatus('published'); toast('Published. Assign it to a classroom to make it available to students.') } catch (e) { toast(errMsg(e), 'error') }
  }
  async function changeStatus(s: ExamStatus) {
    try { await rpc('set_exam_status', { p_exam: id, p_status: s }); setStatus(s); toast('Status updated.') } catch (e) { toast(errMsg(e), 'error') }
  }

  async function regenerate(i: number, extra: string) {
    const q = draft!.questions[i]
    setAiBusy(q.id)
    try {
      const res = validateExamJson(await callAi({ mode: 'regenerate_question', exam: draftToJson(draft!), questionIndex: i, instruction: extra }))
      if (!res.ok) throw new Error('The AI returned an invalid question: ' + res.errors[0])
      const nq = { ...res.exam.questions[0], id: q.id }
      setUndo(draft); edit((d) => ({ ...d, questions: d.questions.map((x) => (x.id === q.id ? nq : x)) })); toast('Question regenerated. Review it before saving.')
    } catch (e) { toast(errMsg(e), 'error') } finally { setAiBusy(null) }
  }
  async function refine() {
    if (!instr.trim()) return
    setAiBusy('refine')
    try {
      const res = validateExamJson(await callAi({ mode: 'refine', exam: draftToJson(draft!), instruction: instr }))
      if (!res.ok) throw new Error('The AI returned an invalid examination: ' + res.errors[0])
      setUndo(draft); setDraft({ ...res.exam, randomizeOptions: draft!.randomizeOptions, freeNavigation: draft!.freeNavigation }); setDirty(true); setInstr(''); toast('Applied. Review the changes, then save (or undo).')
    } catch (e) { toast(errMsg(e), 'error') } finally { setAiBusy(null) }
  }

  return (
    <>
      <PageHeader title={isNew ? 'New examination' : draft.title || 'Examination'}
        subtitle={<span className="flex flex-wrap items-center gap-2">{!isNew && <Badge tone={status === 'published' ? 'ok' : status === 'archived' ? 'warn' : 'neutral'}>{status}</Badge>}{dirty && <span className="text-warn">Unsaved changes</span>}<span>{draft.questions.length} questions · {total} points</span></span>}
        actions={<>
          <Button onClick={() => setPreview('all')} disabled={!draft.questions.length}><Eye className="h-4 w-4" />Preview</Button>
          <Button onClick={save} loading={saving} disabled={!dirty && !isNew}>Save</Button>
          {status !== 'published' && <Button variant="primary" onClick={publish} loading={saving}>Publish</Button>}
          {status === 'published' && !dirty && <Button variant="primary" onClick={() => setAssign(true)}>Assign to classroom</Button>}
        </>} />

      {isNew && loc.state?.draft && <p className="mb-4 rounded-md bg-accent/10 p-3 text-sm">This draft has not been saved yet. Review and edit it, then click <b>Save</b>. It is never published automatically.</p>}
      {!isNew && status === 'published' && <p className="mb-4 text-sm text-muted">Edits to a published examination do not change classrooms it was already assigned to — each assignment keeps the version it was created with.</p>}

      <Card className="mb-6 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2"><Field label="Title" htmlFor="title"><input id="title" className="input" value={draft.title} maxLength={200} onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))} /></Field></div>
          <div className="md:col-span-2"><Field label="Description" htmlFor="desc"><textarea id="desc" className="input min-h-[80px]" value={draft.description} onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))} /></Field></div>
          <Field label="Duration (minutes)" htmlFor="dur"><input id="dur" type="number" min={1} max={600} className="input" value={draft.durationMinutes} onChange={(e) => edit((d) => ({ ...d, durationMinutes: Math.round(Number(e.target.value)) }))} /></Field>
          <Field label="Passing grade (%)" htmlFor="pg"><input id="pg" type="number" min={0} max={100} className="input" value={draft.passingGrade} onChange={(e) => edit((d) => ({ ...d, passingGrade: Number(e.target.value) }))} /></Field>
          <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={draft.randomizeOptions} onChange={(e) => edit((d) => ({ ...d, randomizeOptions: e.target.checked }))} />Randomize answer options for each attempt <span className="text-muted">(question order never changes)</span></label>
          <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={draft.freeNavigation} onChange={(e) => edit((d) => ({ ...d, freeNavigation: e.target.checked }))} />Let students move freely and return to earlier questions</label>
        </div>
        <p className="mt-3 text-xs text-muted">Students get one attempt by default. You can grant additional attempts to individual students later.</p>
      </Card>

      {ai?.configured && (
        <Card className="mb-6 p-5">
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-accent-fg" />Refine with AI</h2>{undo && <Button size="sm" onClick={() => { setDraft(undo); setUndo(null); setDirty(true) }}><Undo2 className="h-3.5 w-3.5" />Undo last AI change</Button>}</div>
          <div className="flex flex-col gap-2 md:flex-row">
            <input className="input" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder='e.g. "Make the questions harder", "Replace questions 5 and 8", "Add 5 questions about indexing"' onKeyDown={(e) => { if (e.key === 'Enter') void refine() }} aria-label="Instruction for the AI" />
            <Button variant="primary" onClick={refine} loading={aiBusy === 'refine'} disabled={!instr.trim()}>Apply</Button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {draft.questions.length === 0 && <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">No questions yet. Add your first question below.</p>}
        {draft.questions.map((q, i) => {
          const isOpen = open === q.id
          return (
            <Card key={q.id}>
              <div className="flex items-center gap-2 p-3">
                <button className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(isOpen ? null : q.id)} aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="w-6 shrink-0 text-sm tabular-nums text-muted">{i + 1}.</span>
                  <span className="truncate text-sm font-medium">{q.text || <span className="text-muted">Untitled question</span>}</span>
                </button>
                <Badge>{QTYPE_LABEL[q.type]}</Badge><span className="hidden text-xs text-muted sm:inline">{q.points} pt</span>
                <Button size="sm" className="px-2" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button size="sm" className="px-2" onClick={() => move(i, 1)} disabled={i === draft.questions.length - 1} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
              </div>
              {isOpen && (
                <div className="space-y-4 border-t border-line p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
                    <Field label="Question type" htmlFor={`t-${q.id}`}>
                      <select id={`t-${q.id}`} className="input" value={q.type} onChange={(e) => setQ(q.id, (x) => convertQuestionType(x, e.target.value as QType))}>
                        {(Object.keys(QTYPE_LABEL) as QType[]).map((t) => <option key={t} value={t}>{QTYPE_LABEL[t]}</option>)}
                      </select>
                    </Field>
                    <Field label="Points" htmlFor={`p-${q.id}`}><input id={`p-${q.id}`} type="number" min={0.5} step={0.5} className="input" value={q.points} onChange={(e) => setQ(q.id, (x) => ({ ...x, points: Number(e.target.value) }))} /></Field>
                  </div>
                  <Field label="Question" htmlFor={`x-${q.id}`}><textarea id={`x-${q.id}`} className="input min-h-[80px]" value={q.text} onChange={(e) => setQ(q.id, (x) => ({ ...x, text: e.target.value }))} /></Field>

                  {q.type === 'matching' ? (
                    <div>
                      <div className="label">Matching pairs <span className="font-normal text-muted">(left item → its correct right item; the right column is shuffled for students)</span></div>
                      <div className="space-y-2">
                        {q.pairs.map((p, j) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <input className="input" aria-label={`Left item ${j + 1}`} placeholder="Left item" value={p.left} onChange={(e) => setQ(q.id, (x) => ({ ...x, pairs: x.pairs.map((y) => (y.id === p.id ? { ...y, left: e.target.value } : y)) }))} />
                            <span aria-hidden>→</span>
                            <input className="input" aria-label={`Right item ${j + 1}`} placeholder="Matching item" value={p.right} onChange={(e) => setQ(q.id, (x) => ({ ...x, pairs: x.pairs.map((y) => (y.id === p.id ? { ...y, right: e.target.value } : y)) }))} />
                            <Button size="sm" className="px-2" disabled={q.pairs.length <= 2} onClick={() => setQ(q.id, (x) => ({ ...x, pairs: x.pairs.filter((y) => y.id !== p.id) }))} aria-label="Remove pair"><X className="h-4 w-4" /></Button>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" className="mt-2" disabled={q.pairs.length >= 10} onClick={() => setQ(q.id, (x) => ({ ...x, pairs: [...x.pairs, { id: uid(), left: '', right: '' }] }))}><Plus className="h-3.5 w-3.5" />Add pair</Button>
                    </div>
                  ) : (
                    <div>
                      <div className="label">Answer options <span className="font-normal text-muted">({q.type === 'single_choice' ? 'select the one correct answer' : 'tick every correct answer'})</span></div>
                      <div className="space-y-2">
                        {q.options.map((o, j) => (
                          <div key={o.id} className="flex items-center gap-2">
                            <input type={q.type === 'single_choice' ? 'radio' : 'checkbox'} name={`c-${q.id}`} className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" checked={o.correct} aria-label={`Option ${j + 1} is correct`}
                              onChange={(e) => setQ(q.id, (x) => ({ ...x, options: x.options.map((y) => (q.type === 'single_choice' ? { ...y, correct: y.id === o.id } : y.id === o.id ? { ...y, correct: e.target.checked } : y)) }))} />
                            <input className="input" aria-label={`Option ${j + 1} text`} placeholder={`Option ${j + 1}`} value={o.text} onChange={(e) => setQ(q.id, (x) => ({ ...x, options: x.options.map((y) => (y.id === o.id ? { ...y, text: e.target.value } : y)) }))} />
                            <Button size="sm" className="px-2" disabled={q.options.length <= 2} onClick={() => setQ(q.id, (x) => ({ ...x, options: x.options.filter((y) => y.id !== o.id) }))} aria-label="Remove option"><X className="h-4 w-4" /></Button>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" className="mt-2" disabled={q.options.length >= 10} onClick={() => setQ(q.id, (x) => ({ ...x, options: [...x.options, { id: uid(), text: '', correct: false }] }))}><Plus className="h-3.5 w-3.5" />Add option</Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                    <Button size="sm" onClick={() => setPreview(q)}><Eye className="h-3.5 w-3.5" />Preview</Button>
                    <Button size="sm" onClick={() => dup(q, i)}><Copy className="h-3.5 w-3.5" />Duplicate</Button>
                    {ai?.configured && <Button size="sm" onClick={() => setRegen({ index: i, text: '' })} loading={aiBusy === q.id}><RefreshCw className="h-3.5 w-3.5" />Regenerate with AI</Button>}
                    <Button size="sm" variant="danger" className="ml-auto" onClick={async () => { if (await confirm({ title: 'Delete question?', message: `Question ${i + 1} will be removed.`, confirmLabel: 'Delete', danger: true })) edit((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== q.id) })) }}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Add question:</span>
        {(Object.keys(QTYPE_LABEL) as QType[]).map((t) => <Button key={t} size="sm" onClick={() => addQ(t)}><Plus className="h-3.5 w-3.5" />{QTYPE_LABEL[t]}</Button>)}
      </div>
      {!isNew && (
        <div className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6 text-sm">
          {status === 'published' && <Button onClick={() => changeStatus('archived')}>Archive</Button>}
          {status === 'archived' && <Button onClick={() => changeStatus('published')}>Restore (publish)</Button>}
          <Link to="/examinations" className="btn btn-ghost">Back to list</Link>
        </div>
      )}

      <Modal wide open={!!preview} onClose={() => setPreview(null)} title={preview === 'all' ? 'Student preview' : 'Question preview'}>
        {preview === 'all' ? <FullPreview draft={draft} /> : preview ? <QuestionView q={toRun(preview)} answer={undefined} onChange={() => {}} /> : null}
      </Modal>
      <Modal open={regen !== null} onClose={() => setRegen(null)} title="Regenerate this question"
        footer={<><Button onClick={() => setRegen(null)}>Cancel</Button><Button variant="primary" onClick={() => { const r = regen!; setRegen(null); void regenerate(r.index, r.text) }}>Regenerate</Button></>}>
        <Field label="What should change? (optional)" hint="Leave empty for a fresh question on the same topic.">
          <textarea className="input min-h-[96px]" maxLength={500} autoFocus value={regen?.text ?? ''} onChange={(e) => setRegen((r) => (r ? { ...r, text: e.target.value } : r))} />
        </Field>
      </Modal>
      {!isNew && <AssignModal open={assign} onClose={() => setAssign(false)} examId={id} onDone={() => setAssign(false)} />}
    </>
  )
}

function FullPreview({ draft }: { draft: ExamDraft }) {
  const [ans, setAns] = useState<Record<string, import('../lib/types').Answer>>({})
  return (
    <div className="space-y-8">
      <div><h3 className="text-lg font-semibold">{draft.title}</h3><p className="text-sm text-muted">{draft.description}</p><p className="mt-1 text-xs text-muted">{draft.durationMinutes} minutes · pass mark {draft.passingGrade}% · interactive preview, nothing is saved</p></div>
      {draft.questions.map((q, i) => <div key={q.id}><div className="mb-1 text-sm text-muted">Question {i + 1} of {draft.questions.length}</div><QuestionView q={toRun(q)} answer={ans[q.id]} onChange={(a) => setAns({ ...ans, [q.id]: a })} /></div>)}
    </div>
  )
}
