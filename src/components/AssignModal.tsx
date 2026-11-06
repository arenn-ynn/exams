import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Field, Modal, useFeedback } from './ui'
import { errMsg, toLocalInput } from '../lib/utils'

interface ExamOpt { id: string; title: string; duration_minutes: number }
interface ClassOpt { id: string; name: string }

/** Assign an existing published examination to a classroom with its own schedule. Either id may be fixed by the caller. */
export default function AssignModal({ open, onClose, examId, classroomId, onDone }: { open: boolean; onClose: () => void; examId?: string; classroomId?: string; onDone: () => void }) {
  const { toast } = useFeedback()
  const { user } = useAuth()
  const uid = user?.id
  const [exams, setExams] = useState<ExamOpt[]>([])
  const [classes, setClasses] = useState<ClassOpt[]>([])
  const [ex, setEx] = useState(examId ?? '')
  const [cl, setCl] = useState(classroomId ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [endTouched, setEndTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || !uid) return
    let alive = true
    setLoaded(false)
    const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0)
    setStart(toLocalInput(d)); setEndTouched(false); setEx(examId ?? ''); setCl(classroomId ?? '')
    Promise.all([
      supabase.from('exams').select('id, title, duration_minutes').eq('owner_id', uid).eq('status', 'published').order('title'),
      // only classrooms the user OWNS: classrooms they merely joined as a student are readable too, but can't be assigned to
      supabase.from('classrooms').select('id, name').eq('owner_id', uid).eq('archived', false).order('name'),
    ]).then(([e, c]) => {
      if (!alive) return
      if (e.error || c.error) toast(errMsg(e.error ?? c.error), 'error')
      setExams((e.data as ExamOpt[]) ?? []); setClasses((c.data as ClassOpt[]) ?? []); setLoaded(true)
    }).catch((err) => { if (alive) { toast(errMsg(err), 'error'); setLoaded(true) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, examId, classroomId, uid])

  const dur = exams.find((x) => x.id === ex)?.duration_minutes ?? 60
  useEffect(() => {
    if (!endTouched && start) setEnd(toLocalInput(new Date(new Date(start).getTime() + dur * 60000)))
  }, [start, dur, endTouched])

  async function submit() {
    if (!ex || !cl || !start) return toast('Choose an examination, a classroom and a start time.', 'error')
    setBusy(true)
    try {
      await rpc('assign_exam', { p_classroom: cl, p_exam: ex, p_starts: new Date(start).toISOString(), p_closes: end ? new Date(end).toISOString() : null })
      toast('Examination assigned.'); onDone(); onClose()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Assign examination" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!loaded}>Assign</Button></>}>
      <div className="space-y-4">
        {!examId && (
          <Field label="Examination" htmlFor="as-exam" hint={loaded && exams.length === 0 ? 'You have no published examinations yet. Publish one first.' : 'Only published examinations can be assigned.'}>
            <select id="as-exam" className="input" value={ex} onChange={(e) => setEx(e.target.value)}><option value="">Select…</option>{exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
          </Field>
        )}
        {!classroomId && (
          <Field label="Classroom" htmlFor="as-class" hint={loaded && classes.length === 0 ? 'Create a classroom first.' : 'The same examination can be assigned to many classrooms.'}>
            <select id="as-class" className="input" value={cl} onChange={(e) => setCl(e.target.value)}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        )}
        <Field label="Opens (date and time)" htmlFor="as-start"><input id="as-start" type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Window closes" htmlFor="as-end" hint={`Students must start before this time and cannot work past it. Each student gets ${dur} minutes once started (the examination's duration), but never beyond this time.`}>
          <input id="as-end" type="datetime-local" className="input" value={end} onChange={(e) => { setEnd(e.target.value); setEndTouched(true) }} />
        </Field>
      </div>
    </Modal>
  )
}
