import { describe, expect, it } from 'vitest'
import { TEMPLATE_JSON, draftProblems, draftToJson, validateExamJson } from '../src/lib/examSchema'
import { computeResults } from '../src/lib/analytics'

const clone = () => JSON.parse(JSON.stringify(TEMPLATE_JSON))

describe('JSON import validation', () => {
  it('accepts the official template', () => {
    const r = validateExamJson(TEMPLATE_JSON)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.exam.questions).toHaveLength(3); expect(r.exam.questions[0].options.filter((o) => o.correct)).toHaveLength(1) }
  })
  it('round-trips draft → JSON → draft', () => {
    const r = validateExamJson(TEMPLATE_JSON); if (!r.ok) throw new Error('x')
    const again = validateExamJson(draftToJson(r.exam)); expect(again.ok).toBe(true)
    expect(draftProblems(r.exam)).toEqual([])
  })
  it('rejects non-objects and bad JSON versions', () => {
    expect(validateExamJson([]).ok).toBe(false)
    const j = clone(); j.schemaVersion = '2.0'
    const r = validateExamJson(j); expect(r.ok).toBe(false)
    expect(validateExamJson({ ...clone(), schemaVersion: '1.7' }).ok).toBe(true)   // same major version stays readable
  })
  it('reports duplicate question ids', () => {
    const j = clone(); j.questions[1].id = 'q1'
    const r = validateExamJson(j); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/duplicate question id/)
  })
  it('rejects unsupported types (e.g. true/false)', () => {
    const j = clone(); j.questions[0].type = 'true_false'
    const r = validateExamJson(j); expect(r.ok).toBe(false)
  })
  it('rejects correct ids that do not exist and wrong counts', () => {
    const j = clone(); j.questions[0].correctOptionIds = ['nope']
    expect(validateExamJson(j).ok).toBe(false)
    const k = clone(); k.questions[0].correctOptionIds = ['q1a', 'q1b']
    const r = validateExamJson(k); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/exactly one/)
  })
  it('validates points, matching structure and never silently drops questions', () => {
    const j = clone(); j.questions[0].points = 0; j.questions[2].pairs = [j.questions[2].pairs[0]]; j.questions[1].text = ' '
    const r = validateExamJson(j); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('analytics', () => {
  it('uses the best submitted attempt and counts statuses', () => {
    const snap = { title: 't', description: '', durationMinutes: 10, passingGrade: 50, questions: [{ id: 'a', type: 'single_choice' as const, text: 'A', points: 1 }, { id: 'b', type: 'single_choice' as const, text: 'B', points: 1 }] }
    const members = [{ user_id: 'u1', profiles: { full_name: 'Ann', email: 'a@x' } }, { user_id: 'u2', profiles: { full_name: 'Bob', email: 'b@x' } }, { user_id: 'u3', profiles: { full_name: 'Cy', email: 'c@x' } }]
    const row = (id: string, user: string, n: number, pctv: number, ok: boolean[]) => ({ id, user_id: user, attempt_number: n, status: 'submitted' as const, started_at: '2026-01-01T10:00:00Z', submitted_at: '2026-01-01T10:10:00Z', score: pctv / 50, max_score: 2, percent: pctv, passed: pctv >= 50,
      student_answers: ok.map((c, i) => ({ question_id: i ? 'b' : 'a', is_answered: true, is_correct: c, points_awarded: c ? 1 : 0 })) })
    const attempts = [row('1', 'u1', 1, 0, [false, false]), row('2', 'u1', 2, 100, [true, true]), row('3', 'u2', 1, 50, [true, false])]
    const r = computeResults(snap, members, attempts, [{ user_id: 'u1' }])
    expect(r.overview).toMatchObject({ enrolled: 3, submitted: 2, notStarted: 1, highest: 100, lowest: 50, average: 75, passRate: 100 })
    expect(r.students.find((s) => s.userId === 'u1')).toMatchObject({ percent: 100, attemptsUsed: 2, attemptsAllowed: 2 })
    expect(r.questionStats[0]).toMatchObject({ correct: 2, percentCorrect: 100 }); expect(r.questionStats[1]).toMatchObject({ correct: 1, incorrect: 1 })
  })
})
