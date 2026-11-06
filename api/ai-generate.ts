import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUser } from './_auth.js'

const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase()
const model = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-5-5')
const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY

const TIMEOUT_MS = 55_000          // stay under the function's 60 s maxDuration so we can answer with a clean error instead of being killed
const LIMIT = 12, WINDOW_MS = 10 * 60_000
const hits = new Map<string, number[]>()
/** Best-effort per-user throttle (per warm serverless instance): stops a single account from burning provider credits. */
function throttled(userId: string): number {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= LIMIT) { hits.set(userId, recent); return Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) }
  recent.push(now); hits.set(userId, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k)
  return 0
}
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
async function providerError(r: Response): Promise<HttpError> {
  console.error('AI provider error', r.status, (await r.text()).slice(0, 500))   // details stay in server logs, not in the browser
  return new HttpError(502, `The AI provider returned an error (${r.status}). Please try again.`)
}

const SCHEMA = `{
  "schemaVersion": "1.0", "title": string, "description": string, "durationMinutes": integer 1-600, "passingGrade": number 0-100,
  "questions": [
    { "id": "q1", "type": "single_choice", "text": string, "points": number>0,
      "options": [{"id": "q1a", "text": string}, ...2-6 items], "correctOptionIds": [exactly ONE option id] },
    { "id": "q2", "type": "multiple_choice", "text": string, "points": number>0,
      "options": [{"id": "q2a", "text": string}, ...3-6 items], "correctOptionIds": [one or more option ids, never all] },
    { "id": "q3", "type": "matching", "text": string, "points": number>0,
      "pairs": [{"id": "q3p1", "left": string, "right": string}, ...3-6 items; each left matches ONLY its own right] }
  ]
}`
const SYSTEM = `You are an expert examination author. Respond with ONE valid JSON object and nothing else (no Markdown, no commentary).
The object MUST follow this schema exactly:
${SCHEMA}
Rules: only the three question types shown are allowed. Question ids are unique ("q1","q2",...). Option ids unique within a question. Every id in correctOptionIds must exist in options. Questions must be factually correct, unambiguous and have no duplicates. Write all text in the requested language.`

const clamp = (n: unknown, lo: number, hi: number, d: number) => { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d }
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)

function buildPrompt(b: Record<string, unknown>): string {
  const mode = b.mode
  if (mode === 'generate') {
    const types = Array.isArray(b.types) ? b.types.filter((t) => ['single_choice', 'multiple_choice', 'matching'].includes(String(t))) : []
    return `Create an examination.
Topic: ${str(b.topic, 300)}
Number of questions: ${clamp(b.count, 1, 40, 10)}
Difficulty: ${str(b.difficulty, 20) || 'Mixed'}${b.difficulty === 'Mixed' ? ' (balanced mix of easy, medium and hard)' : ''}
Language: ${str(b.language, 40) || 'English'}
Allowed question types: ${(types.length ? types : ['single_choice', 'multiple_choice', 'matching']).join(', ')} (use a sensible variety of the allowed types)
Points per question: ${clamp(b.points, 0.5, 100, 1)}
Duration (minutes): ${clamp(b.durationMinutes, 1, 600, 45)}; passingGrade: ${clamp(b.passingGrade, 0, 100, 50)}
Description to use (improve if empty): ${str(b.description, 1000) || '(write a short one)'}
Additional requirements: ${str(b.extra, 2000) || 'none'}`
  }
  const exam = JSON.stringify(b.exam ?? {}).slice(0, 60000)
  if (mode === 'refine') return `Here is the current examination as JSON:\n${exam}\n\nApply this instruction and return the COMPLETE updated examination JSON (keep everything not affected by the instruction unchanged):\n${str(b.instruction, 1000)}`
  if (mode === 'regenerate_question') {
    const i = clamp(b.questionIndex, 0, 500, 0)
    return `Here is an examination as JSON:\n${exam}\n\nWrite ONE replacement for question number ${i + 1} (index ${i}). It must cover the same topic area but be a different question that does not duplicate any other question. ${str(b.instruction, 1000) ? 'Extra instruction: ' + str(b.instruction, 1000) : ''}\nReturn a complete examination JSON object with the same title/description/duration/passingGrade whose "questions" array contains ONLY the single new question.`
  }
  throw new HttpError(400, 'Unknown mode')
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e <= s) throw new Error('The AI did not return JSON.')
  return JSON.parse(text.slice(s, e + 1))
}

async function ask(prompt: string): Promise<string> {
  if (provider === 'openai') {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    const r = await fetch(`${base}/chat/completions`, {
      signal: AbortSignal.timeout(TIMEOUT_MS), method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
    })
    if (!r.ok) throw await providerError(r)
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    return j.choices?.[0]?.message?.content ?? ''
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    signal: AbortSignal.timeout(TIMEOUT_MS), method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8000, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!r.ok) throw await providerError(r)
  const j = (await r.json()) as { content?: { type: string; text?: string }[] }
  return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await getUser(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Please log in again.' })
  if (req.method === 'GET') return res.status(200).json({ configured: Boolean(apiKey), provider, model })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!apiKey) {
    const name = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
    return res.status(503).json({ error: `AI is not configured. Set ${name} (and optionally AI_PROVIDER / AI_MODEL) in the server environment variables and redeploy.` })
  }
  const wait = throttled(user.id)
  if (wait) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ error: `Too many AI requests. Please wait ${Math.ceil(wait / 60)} minute(s) and try again.` }) }
  try {
    const prompt = buildPrompt((req.body ?? {}) as Record<string, unknown>)
    return res.status(200).json({ exam: extractJson(await ask(prompt)) })
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return res.status(504).json({ error: 'The AI took too long to answer. Try fewer questions or a simpler request.' })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'AI request failed.' })
  }
}
