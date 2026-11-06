import { ChangeEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ClipboardCopy, Download, Upload } from 'lucide-react'
import { PageHeader, Button, Card, Field, useFeedback, Badge } from '../components/ui'
import { parseExamText, SCHEMA_VERSION, TEMPLATE_JSON } from '../lib/examSchema'
import { buildExternalPrompt } from '../lib/examPrompt'
import { downloadBlob } from '../lib/utils'
import { ExamDraft, QTYPE_LABEL } from '../lib/types'

export default function ImportJson() {
  const nav = useNavigate()
  const { toast } = useFeedback()
  const [opts, setOpts] = useState({ count: 20, difficulty: 'Mixed', language: 'English', points: 1, durationMinutes: 45, passingGrade: 50, types: ['single_choice', 'multiple_choice', 'matching'] })
  const [exam, setExam] = useState<ExamDraft | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [fileName, setFileName] = useState('')

  const prompt = buildExternalPrompt({ ...opts, types: opts.types })
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(prompt); toast('Prompt copied. Paste it into ChatGPT or Claude after uploading your PDFs.') }
    catch { toast('Copy failed — select the prompt text below and copy it manually.', 'error') }
  }
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setFileName(f.name); setExam(null); setErrors([])
    if (f.size > 2_000_000) return setErrors(['The file is larger than 2 MB.'])
    const res = parseExamText(await f.text())
    if (res.ok) setExam(res.exam); else setErrors(res.errors)
    e.target.value = ''
  }
  const toggleType = (t: string) => setOpts((o) => ({ ...o, types: o.types.includes(t) ? o.types.filter((x) => x !== t) : [...o.types, t] }))

  return (
    <>
      <PageHeader title="Import JSON" subtitle={`Generate an examination with ChatGPT, Claude or any AI, then import the JSON (schema v${SCHEMA_VERSION}).`} />
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="font-semibold">1. Copy the AI prompt</h2>
          <p className="mt-1 text-sm text-muted">Adjust the settings, copy the prompt, open ChatGPT or Claude, <b>upload your PDF documents</b>, paste the prompt, and save the JSON it returns as a <code className="font-mono">.json</code> file.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Questions" htmlFor="n"><input id="n" type="number" min={1} max={100} className="input" value={opts.count} onChange={(e) => setOpts({ ...opts, count: Number(e.target.value) })} /></Field>
            <Field label="Difficulty" htmlFor="d"><select id="d" className="input" value={opts.difficulty} onChange={(e) => setOpts({ ...opts, difficulty: e.target.value })}>{['Easy', 'Medium', 'Hard', 'Mixed'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Language" htmlFor="l"><input id="l" className="input" value={opts.language} onChange={(e) => setOpts({ ...opts, language: e.target.value })} /></Field>
            <Field label="Points / question" htmlFor="p"><input id="p" type="number" min={0.5} step={0.5} className="input" value={opts.points} onChange={(e) => setOpts({ ...opts, points: Number(e.target.value) })} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {(['single_choice', 'multiple_choice', 'matching'] as const).map((t) => (
              <label key={t} className="flex min-h-[36px] items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={opts.types.includes(t)} onChange={() => toggleType(t)} />{QTYPE_LABEL[t]}</label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={copyPrompt} disabled={opts.types.length === 0}><ClipboardCopy className="h-4 w-4" />Copy AI prompt</Button>
            <Button onClick={() => downloadBlob(new Blob([JSON.stringify(TEMPLATE_JSON, null, 2)], { type: 'application/json' }), 'examina-template.json')}><Download className="h-4 w-4" />Download JSON template</Button>
          </div>
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Show prompt text</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-subtle p-3 font-mono text-xs">{prompt}</pre></details>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">2. Upload the JSON file</h2>
          <label className="mt-3 flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-sm text-muted hover:bg-subtle focus-within:outline focus-within:outline-2">
            <Upload className="h-5 w-5" />{fileName || 'Choose a .json file'}
            <input type="file" accept=".json,application/json" className="sr-only" onChange={onFile} />
          </label>
          {errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
              <div className="mb-2 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{errors.length} problem{errors.length > 1 ? 's' : ''} found — nothing was imported</div>
              <ul className="list-disc space-y-1 pl-5">{errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul>
              {errors.length > 40 && <p className="mt-2">…and {errors.length - 40} more.</p>}
              <p className="mt-3 text-fg">Fix the file (or ask the AI to correct these errors) and upload it again.</p>
            </div>
          )}
        </Card>

        {exam && (
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">3. Preview</h2><Badge tone="ok"><Check className="h-3 w-3" />Valid</Badge></div>
            <div className="mt-3"><div className="text-lg font-medium">{exam.title}</div><p className="text-sm text-muted">{exam.description}</p>
              <p className="mt-1 text-xs text-muted">{exam.questions.length} questions · {exam.questions.reduce((s, q) => s + q.points, 0)} points · {exam.durationMinutes} min · pass mark {exam.passingGrade}%</p></div>
            <ol className="mt-4 max-h-96 space-y-2 overflow-y-auto text-sm">
              {exam.questions.map((q, i) => (
                <li key={q.id} className="rounded-md border border-line p-3">
                  <div className="flex justify-between gap-2"><span className="font-medium">{i + 1}. {q.text}</span><Badge>{QTYPE_LABEL[q.type]} · {q.points}pt</Badge></div>
                  {q.type === 'matching' ? <ul className="mt-1 text-muted">{q.pairs.map((p) => <li key={p.id}>{p.left} → {p.right}</li>)}</ul>
                    : <ul className="mt-1 text-muted">{q.options.map((o) => <li key={o.id} className={o.correct ? 'font-medium text-ok' : ''}>{o.correct ? '✓' : '•'} {o.text}</li>)}</ul>}
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => nav('/examinations/blank', { state: { draft: exam } })}>Import and open in editor</Button>
              <Link to="/examinations" className="btn btn-ghost">Cancel</Link>
            </div>
            <p className="mt-2 text-xs text-muted">The examination opens as an unsaved draft. It is saved only when you click Save, and never published automatically.</p>
          </Card>
        )}
      </div>
    </>
  )
}
