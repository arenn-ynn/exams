import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { aiStatus, callAi } from '../lib/api'
import { validateExamJson } from '../lib/examSchema'
import { Button, Card, ErrorNote, Field, FullSpinner, PageHeader, useFeedback, useLoad } from '../components/ui'
import { QTYPE_LABEL, QType } from '../lib/types'
import { errMsg } from '../lib/utils'

export default function AiGenerate() {
  const nav = useNavigate()
  const { toast } = useFeedback()
  const status = useLoad(aiStatus, [])
  const [f, setF] = useState({ topic: '', count: 10, difficulty: 'Mixed', language: 'English', points: 1, description: '', extra: '', durationMinutes: 45, passingGrade: 50 })
  const [types, setTypes] = useState<QType[]>(['single_choice', 'multiple_choice', 'matching'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!f.topic.trim()) return setError('Enter a topic.')
    if (!types.length) return setError('Select at least one question type.')
    setBusy(true)
    try {
      const raw = await callAi({ mode: 'generate', ...f, types })
      const res = validateExamJson(raw)
      if (!res.ok) throw new Error('The AI response did not match the required format: ' + res.errors.slice(0, 3).join(' '))
      nav('/examinations/blank', { state: { draft: res.exam } })
    } catch (err) { setError(errMsg(err)); toast('Generation failed', 'error') } finally { setBusy(false) }
  }

  if (status.loading) return <FullSpinner />
  if (!status.data?.configured) return (
    <>
      <PageHeader title="Create with AI" />
      <ErrorNote error="AI generation is not configured on this deployment. Add AI_PROVIDER and the matching API key (ANTHROPIC_API_KEY or OPENAI_API_KEY) to the server environment variables — on Vercel under Project → Settings → Environment Variables, locally in .env with “npx vercel dev” — then redeploy. See the README section “AI configuration”." />
      <p className="mt-4 text-sm text-muted">In the meantime you can <Link className="text-accent-fg hover:underline" to="/examinations/import">import a JSON file</Link> generated with any external AI.</p>
    </>
  )
  return (
    <>
      <PageHeader title="Create with AI" subtitle={`Using ${status.data.provider} · ${status.data.model}. The result opens as an unsaved draft for you to review.`} />
      <form onSubmit={submit}>
        <Card className="space-y-4 p-5">
          <Field label="Topic" htmlFor="topic" hint="Be specific, e.g. “Photosynthesis for grade 9 biology” or “SQL joins and indexing”."><input id="topic" className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} maxLength={300} required /></Field>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Questions" htmlFor="count"><input id="count" type="number" min={1} max={40} className="input" value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} /></Field>
            <Field label="Difficulty" htmlFor="diff"><select id="diff" className="input" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{['Easy', 'Medium', 'Hard', 'Mixed'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Language" htmlFor="lang"><input id="lang" className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} /></Field>
            <Field label="Points / question" htmlFor="pts"><input id="pts" type="number" min={0.5} step={0.5} className="input" value={f.points} onChange={(e) => setF({ ...f, points: Number(e.target.value) })} /></Field>
          </div>
          <fieldset><legend className="label">Question types</legend>
            <div className="flex flex-wrap gap-x-5">{(Object.keys(QTYPE_LABEL) as QType[]).map((t) => (
              <label key={t} className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={types.includes(t)} onChange={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])} />{QTYPE_LABEL[t]}</label>))}</div>
          </fieldset>
          <Field label="Examination description (optional)" htmlFor="desc"><textarea id="desc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Duration (minutes)" htmlFor="dur"><input id="dur" type="number" min={1} max={600} className="input" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} /></Field>
              <Field label="Passing grade (%)" htmlFor="pg"><input id="pg" type="number" min={0} max={100} className="input" value={f.passingGrade} onChange={(e) => setF({ ...f, passingGrade: Number(e.target.value) })} /></Field>
              <div className="md:col-span-2"><Field label="Additional requirements" htmlFor="extra" hint="E.g. “Focus on chapters 3–5”, “Use real-world scenarios”, “Avoid trick questions”."><textarea id="extra" className="input min-h-[80px]" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} maxLength={2000} /></Field></div>
            </div>
          </details>
          {error && <ErrorNote error={error} />}
          <Button type="submit" variant="primary" loading={busy}><Sparkles className="h-4 w-4" />{busy ? 'Generating… this can take up to a minute' : 'Generate examination'}</Button>
        </Card>
      </form>
    </>
  )
}
