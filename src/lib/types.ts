export type QType = 'single_choice' | 'multiple_choice' | 'matching'
export const QTYPE_LABEL: Record<QType, string> = {
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  matching: 'Matching',
}
export interface DraftOption { id: string; text: string; correct: boolean }
export interface DraftPair { id: string; left: string; right: string }
export interface DraftQuestion { id: string; type: QType; text: string; points: number; options: DraftOption[]; pairs: DraftPair[] }
export interface ExamDraft {
  title: string; description: string; durationMinutes: number; passingGrade: number
  randomizeOptions: boolean; freeNavigation: boolean; questions: DraftQuestion[]
}
export type ExamStatus = 'draft' | 'published' | 'archived'

/** What a student sees while taking an exam: no correct answers. */
export interface RunQuestion {
  id: string; type: QType; text: string; points: number
  options: { id: string; text: string }[]
  left: { id: string; text: string }[]
  right: { id: string; text: string }[]
}
export interface Answer { selected?: string[]; matches?: Record<string, string> }

export interface Profile { id: string; full_name: string; email: string | null; avatar_url: string | null }

export interface StudentAssignment {
  assignment_id: string; classroom_id: string; classroom_name: string; classroom_archived: boolean
  exam_title: string; description: string; duration_minutes: number; question_count: number
  starts_at: string; closes_at: string; results_released_at: string | null
  attempts_used: number; attempts_allowed: number; submitted_count: number
  in_progress_attempt_id: string | null; last_submitted_at: string | null
  result: null | { score: number; max_score: number; percent: number; passed: boolean; time_spent_seconds: number }
}

export interface AttemptDetail {
  attempt: { id: string; attempt_number: number; score: number; max_score: number; percent: number; passed: boolean; started_at: string; submitted_at: string; auto_submitted: boolean }
  passing_grade: number
  questions: {
    id: string; type: QType; text: string; points: number; awarded: number; is_correct: boolean; is_answered: boolean
    options: { text: string; correct: boolean; selected: boolean }[]
    pairs: { left: string; right: string; chosen: string | null }[]
  }[]
}
