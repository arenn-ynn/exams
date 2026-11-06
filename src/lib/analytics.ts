import { QType } from './types'

export interface SnapshotQuestion { id: string; type: QType; text: string; points: number }
export interface Snapshot { title: string; description: string; durationMinutes: number; passingGrade: number; questions: SnapshotQuestion[] }
export interface MemberRow { user_id: string; profiles: { full_name: string; email: string | null } | null }
export interface AnswerRow { question_id: string; is_answered: boolean | null; is_correct: boolean | null; points_awarded: number | null }
export interface AttemptRow {
  id: string; user_id: string; attempt_number: number; status: 'in_progress' | 'submitted'
  started_at: string; submitted_at: string | null; score: number | null; max_score: number | null; percent: number | null; passed: boolean | null
  student_answers: AnswerRow[]
}
export interface GrantRow { user_id: string }

export interface StudentResult {
  userId: string; name: string; email: string
  status: 'not_started' | 'started' | 'submitted'
  best: AttemptRow | null; attemptsUsed: number; attemptsAllowed: number
  correct: number; incorrect: number; unanswered: number; answered: number
  percent: number | null; score: number | null; maxScore: number | null; passed: boolean | null; timeSpentSeconds: number | null
}
export interface QuestionStat { id: string; index: number; text: string; type: QType; answered: number; correct: number; incorrect: number; skipped: number; percentCorrect: number }
export interface Overview {
  enrolled: number; started: number; submitted: number; notStarted: number; inProgress: number
  average: number | null; highest: number | null; lowest: number | null; passRate: number | null; avgTimeSeconds: number | null
}

/** A student's "grade" is their best submitted attempt (highest percent; ties → most recent). */
export function computeResults(snap: Snapshot, members: MemberRow[], attempts: AttemptRow[], grants: GrantRow[]) {
  const nq = snap.questions.length
  const students: StudentResult[] = members.map((m) => {
    const mine = attempts.filter((a) => a.user_id === m.user_id)
    const submitted = mine.filter((a) => a.status === 'submitted')
    const best = submitted.length
      ? [...submitted].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || b.attempt_number - a.attempt_number)[0]
      : null
    const allowed = 1 + grants.filter((g) => g.user_id === m.user_id).length
    const status: StudentResult['status'] = best ? 'submitted' : mine.length ? 'started' : 'not_started'
    let correct = 0, answered = 0
    if (best) for (const r of best.student_answers) { if (r.is_correct) correct++; if (r.is_answered) answered++ }
    return {
      userId: m.user_id, name: m.profiles?.full_name || m.profiles?.email || 'Unknown', email: m.profiles?.email ?? '',
      status, best, attemptsUsed: mine.length, attemptsAllowed: allowed,
      correct, answered, incorrect: best ? answered - correct : 0, unanswered: best ? nq - answered : 0,
      percent: best?.percent ?? null, score: best?.score ?? null, maxScore: best?.max_score ?? null, passed: best?.passed ?? null,
      timeSpentSeconds: best?.submitted_at ? (new Date(best.submitted_at).getTime() - new Date(best.started_at).getTime()) / 1000 : null,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const done = students.filter((s) => s.status === 'submitted')
  const pcts = done.map((s) => s.percent ?? 0)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const overview: Overview = {
    enrolled: students.length, submitted: done.length,
    started: students.filter((s) => s.status !== 'not_started').length,
    notStarted: students.filter((s) => s.status === 'not_started').length,
    inProgress: students.filter((s) => s.status === 'started').length,
    average: mean(pcts), highest: pcts.length ? Math.max(...pcts) : null, lowest: pcts.length ? Math.min(...pcts) : null,
    passRate: done.length ? (done.filter((s) => s.passed).length / done.length) * 100 : null,
    avgTimeSeconds: mean(done.map((s) => s.timeSpentSeconds ?? 0)),
  }

  const questionStats: QuestionStat[] = snap.questions.map((q, index) => {
    let answered = 0, correct = 0
    for (const s of done) {
      const row = s.best!.student_answers.find((r) => r.question_id === q.id)
      if (row?.is_answered) answered++
      if (row?.is_correct) correct++
    }
    return { id: q.id, index: index + 1, text: q.text, type: q.type, answered, correct, incorrect: answered - correct, skipped: done.length - answered,
             percentCorrect: done.length ? (correct / done.length) * 100 : 0 }
  })
  return { students, overview, questionStats }
}

export function gradeBuckets(percents: number[]): { label: string; count: number }[] {
  const b = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`, count: 0 }))
  for (const p of percents) b[Math.min(9, Math.floor(p / 10))].count++
  return b
}
