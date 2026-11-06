import { DraftQuestion, ExamDraft, QType } from './types'
import { uid } from './utils'

/** Current JSON schema version. Files with the same MAJOR version (1.x) are accepted. */
export const SCHEMA_VERSION = '1.0'
const TYPES: QType[] = ['single_choice', 'multiple_choice', 'matching']

export type ValidationResult = { ok: true; exam: ExamDraft } | { ok: false; errors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** Problems with an in-editor draft (same rules the database enforces). */
export function draftProblems(d: ExamDraft): string[] {
  const out: string[] = []
  if (!d.title.trim()) out.push('The examination needs a title.')
  if (!Number.isInteger(d.durationMinutes) || d.durationMinutes < 1 || d.durationMinutes > 600) out.push('Duration must be a whole number of minutes between 1 and 600.')
  if (!(d.passingGrade >= 0 && d.passingGrade <= 100)) out.push('Passing grade must be between 0 and 100.')
  d.questions.forEach((q, i) => {
    const n = `Question ${i + 1}`
    if (!q.text.trim()) out.push(`${n}: the question text is empty.`)
    if (!(q.points > 0 && q.points <= 1000)) out.push(`${n}: points must be greater than 0 (max 1000).`)
    if (q.type === 'matching') {
      if (q.pairs.length < 2) out.push(`${n}: a matching question needs at least 2 pairs.`)
      if (q.pairs.some((p) => !p.left.trim() || !p.right.trim())) out.push(`${n}: every matching pair needs text on both sides.`)
    } else {
      if (q.options.length < 2) out.push(`${n}: add at least 2 answer options.`)
      if (q.options.some((o) => !o.text.trim())) out.push(`${n}: an answer option is empty.`)
      const c = q.options.filter((o) => o.correct).length
      if (q.type === 'single_choice' && c !== 1) out.push(`${n}: choose exactly one correct answer.`)
      if (q.type === 'multiple_choice' && c < 1) out.push(`${n}: choose at least one correct answer.`)
    }
  })
  return out
}

export function validateExamJson(input: unknown): ValidationResult {
  const errors: string[] = []
  if (!isObj(input)) return { ok: false, errors: ['The file must contain a single JSON object.'] }

  const sv = input.schemaVersion
  if (typeof sv !== 'string') errors.push('"schemaVersion" is required (for example "1.0").')
  else if (sv.split('.')[0] !== SCHEMA_VERSION.split('.')[0]) errors.push(`Unsupported schemaVersion "${sv}". This version of EXAMINA reads ${SCHEMA_VERSION.split('.')[0]}.x files.`)

  if (!nonEmpty(input.title)) errors.push('"title" must be a non-empty string.')
  else if (input.title.length > 200) errors.push('"title" must be at most 200 characters.')
  if (input.description !== undefined && typeof input.description !== 'string') errors.push('"description" must be a string.')
  const dur = input.durationMinutes
  if (typeof dur !== 'number' || !Number.isInteger(dur) || dur < 1 || dur > 600) errors.push('"durationMinutes" must be a whole number between 1 and 600.')
  const pg = input.passingGrade
  if (typeof pg !== 'number' || pg < 0 || pg > 100) errors.push('"passingGrade" must be a number between 0 and 100 (percent).')
  for (const k of ['randomizeOptions', 'freeNavigation'] as const) {
    if (input[k] !== undefined && typeof input[k] !== 'boolean') errors.push(`"${k}" must be true or false.`)
  }

  const qs = input.questions
  const questions: DraftQuestion[] = []
  if (!Array.isArray(qs) || qs.length === 0) errors.push('"questions" must be a non-empty array.')
  else {
    if (qs.length > 200) errors.push('An examination can contain at most 200 questions.')
    const seen = new Set<string>()
    qs.forEach((raw, i) => {
      const where = (m: string) => `Question ${i + 1}: ${m}`
      if (!isObj(raw)) { errors.push(where('must be an object.')); return }
      const qid = raw.id
      if (!nonEmpty(qid)) errors.push(where('"id" is required and must be a non-empty string.'))
      else if (seen.has(qid)) errors.push(where(`duplicate question id "${qid}". IDs must be unique.`))
      else seen.add(qid)
      const label = nonEmpty(qid) ? `Question ${i + 1} (id "${qid}")` : `Question ${i + 1}`
      const E = (m: string) => errors.push(`${label}: ${m}`)
      if (!TYPES.includes(raw.type as QType)) { E(`"type" must be one of ${TYPES.join(', ')}.`); return }
      const type = raw.type as QType
      if (!nonEmpty(raw.text)) E('"text" must be a non-empty string.')
      if (typeof raw.points !== 'number' || !(raw.points > 0) || raw.points > 1000) E('"points" must be a number greater than 0 (max 1000).')
      const q: DraftQuestion = { id: uid(), type, text: String(raw.text ?? '').trim(), points: Number(raw.points) || 1, options: [], pairs: [] }

      if (type === 'matching') {
        if (!Array.isArray(raw.pairs) || raw.pairs.length < 2 || raw.pairs.length > 10) E('"pairs" must be an array of 2 to 10 items.')
        else {
          const pids = new Set<string>()
          raw.pairs.forEach((p, j) => {
            if (!isObj(p)) { E(`pair ${j + 1} must be an object.`); return }
            if (!nonEmpty(p.id)) E(`pair ${j + 1}: "id" is required.`)
            else if (pids.has(p.id)) E(`pair ${j + 1}: duplicate pair id "${p.id}".`)
            else pids.add(p.id)
            if (!nonEmpty(p.left)) E(`pair ${j + 1}: "left" must be a non-empty string.`)
            if (!nonEmpty(p.right)) E(`pair ${j + 1}: "right" must be a non-empty string.`)
            q.pairs.push({ id: uid(), left: String(p.left ?? '').trim(), right: String(p.right ?? '').trim() })
          })
        }
      } else {
        if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 10) E('"options" must be an array of 2 to 10 items.')
        else {
          const ids = new Set<string>()
          raw.options.forEach((o, j) => {
            if (!isObj(o)) { E(`option ${j + 1} must be an object.`); return }
            if (!nonEmpty(o.id)) E(`option ${j + 1}: "id" is required.`)
            else if (ids.has(o.id)) E(`option ${j + 1}: duplicate option id "${o.id}".`)
            else ids.add(o.id)
            if (!nonEmpty(o.text)) E(`option ${j + 1}: "text" must be a non-empty string.`)
          })
          const cor = raw.correctOptionIds
          if (!Array.isArray(cor) || cor.length === 0) E('"correctOptionIds" must be a non-empty array.')
          else {
            const unknown = cor.filter((c) => typeof c !== 'string' || !ids.has(c))
            if (unknown.length) E(`"correctOptionIds" references unknown option id(s): ${unknown.map(String).join(', ')}.`)
            if (new Set(cor).size !== cor.length) E('"correctOptionIds" contains duplicates.')
            if (type === 'single_choice' && cor.length !== 1) E('a single_choice question must have exactly one correct option.')
            if (type === 'multiple_choice' && cor.length >= (raw.options as unknown[]).length) E('a multiple_choice question cannot have every option correct.')
          }
          const corSet = new Set(Array.isArray(cor) ? cor.map(String) : [])
          q.options = (raw.options as unknown[]).filter(isObj).map((o) => ({ id: uid(), text: String(o.text ?? '').trim(), correct: corSet.has(String(o.id)) }))
        }
      }
      questions.push(q)
    })
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    exam: {
      title: String(input.title).trim(), description: typeof input.description === 'string' ? input.description : '',
      durationMinutes: dur as number, passingGrade: pg as number,
      randomizeOptions: input.randomizeOptions === undefined ? true : (input.randomizeOptions as boolean),
      freeNavigation: input.freeNavigation === undefined ? true : (input.freeNavigation as boolean),
      questions,
    },
  }
}

export function parseExamText(text: string): ValidationResult {
  let data: unknown
  try { data = JSON.parse(text) } catch (e) {
    return { ok: false, errors: [`The file is not valid JSON: ${(e as Error).message}`] }
  }
  return validateExamJson(data)
}

/** Draft → schema-v1 JSON (used when sending the exam to the AI and for the downloadable template). */
export function draftToJson(d: ExamDraft) {
  return {
    schemaVersion: SCHEMA_VERSION, title: d.title, description: d.description, durationMinutes: d.durationMinutes,
    passingGrade: d.passingGrade, randomizeOptions: d.randomizeOptions, freeNavigation: d.freeNavigation,
    questions: d.questions.map((q, i) => {
      const id = `q${i + 1}`
      if (q.type === 'matching') return { id, type: q.type, text: q.text, points: q.points, pairs: q.pairs.map((p, j) => ({ id: `${id}p${j + 1}`, left: p.left, right: p.right })) }
      const opts = q.options.map((o, j) => ({ id: `${id}o${j + 1}`, text: o.text, correct: o.correct }))
      return { id, type: q.type, text: q.text, points: q.points, options: opts.map(({ id: oid, text }) => ({ id: oid, text })), correctOptionIds: opts.filter((o) => o.correct).map((o) => o.id) }
    }),
  }
}

/** Draft → payload for the save_exam() database function. */
export function draftToPayload(d: ExamDraft) {
  return {
    title: d.title, description: d.description, durationMinutes: d.durationMinutes, passingGrade: d.passingGrade,
    randomizeOptions: d.randomizeOptions, freeNavigation: d.freeNavigation,
    questions: d.questions.map((q) => ({
      type: q.type, text: q.text, points: q.points,
      options: q.type === 'matching' ? [] : q.options.map((o) => ({ text: o.text, correct: o.correct })),
      pairs: q.type === 'matching' ? q.pairs.map((p) => ({ left: p.left, right: p.right })) : [],
    })),
  }
}

export const blankQuestion = (type: QType = 'single_choice'): DraftQuestion => ({
  id: uid(), type, text: '', points: 1,
  options: type === 'matching' ? [] : [{ id: uid(), text: '', correct: type === 'single_choice' }, { id: uid(), text: '', correct: false }],
  pairs: type === 'matching' ? [{ id: uid(), left: '', right: '' }, { id: uid(), left: '', right: '' }] : [],
})

export const blankExam = (): ExamDraft => ({
  title: '', description: '', durationMinutes: 60, passingGrade: 50, randomizeOptions: true, freeNavigation: true, questions: [],
})

export function convertQuestionType(q: DraftQuestion, type: QType): DraftQuestion {
  if (q.type === type) return q
  if (type === 'matching') return { ...q, type, options: [], pairs: q.pairs.length >= 2 ? q.pairs : blankQuestion('matching').pairs }
  const options = q.options.length >= 2 ? q.options : blankQuestion(type).options
  let fixed = options
  if (type === 'single_choice') {
    const first = options.findIndex((o) => o.correct)
    fixed = options.map((o, i) => ({ ...o, correct: i === (first >= 0 ? first : 0) }))
  }
  return { ...q, type, options: fixed, pairs: [] }
}

export const TEMPLATE_JSON = {
  schemaVersion: SCHEMA_VERSION,
  title: 'Introduction to Databases — Midterm',
  description: 'Covers relational basics, keys and indexing.',
  durationMinutes: 45,
  passingGrade: 60,
  randomizeOptions: true,
  freeNavigation: true,
  questions: [
    { id: 'q1', type: 'single_choice', text: 'Which key uniquely identifies a row in a table?', points: 2,
      options: [{ id: 'q1a', text: 'Primary key' }, { id: 'q1b', text: 'Foreign key' }, { id: 'q1c', text: 'Index' }, { id: 'q1d', text: 'View' }],
      correctOptionIds: ['q1a'] },
    { id: 'q2', type: 'multiple_choice', text: 'Select all SQL aggregate functions.', points: 3,
      options: [{ id: 'q2a', text: 'COUNT' }, { id: 'q2b', text: 'SUM' }, { id: 'q2c', text: 'JOIN' }, { id: 'q2d', text: 'AVG' }],
      correctOptionIds: ['q2a', 'q2b', 'q2d'] },
    { id: 'q3', type: 'matching', text: 'Match each SQL command with its purpose.', points: 4,
      pairs: [{ id: 'q3p1', left: 'SELECT', right: 'Read data' }, { id: 'q3p2', left: 'INSERT', right: 'Add rows' }, { id: 'q3p3', left: 'DELETE', right: 'Remove rows' }] },
  ],
}
