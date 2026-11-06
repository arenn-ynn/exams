import { downloadBlob, fmtDateTime, fmtDuration, slug } from './utils'
import { Overview, QuestionStat, StudentResult } from './analytics'

export interface ReportMeta { examTitle: string; classroom: string; startsAt: string; passingGrade: number; releasedAt: string | null }

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutralise spreadsheet formula injection (cells starting with = + - @) and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const statusLabel = (s: StudentResult['status']) => (s === 'submitted' ? 'Submitted' : s === 'started' ? 'In progress' : 'Not started')

export function exportCsv(meta: ReportMeta, students: StudentResult[]) {
  const head = ['Name', 'Email', 'Status', 'Grade (%)', 'Score', 'Max score', 'Passed', 'Correct', 'Incorrect', 'Unanswered', 'Time spent (min)', 'Attempts used', 'Attempts allowed']
  const rows = students.map((s) => [
    s.name, s.email, statusLabel(s.status), s.percent ?? '', s.score ?? '', s.maxScore ?? '',
    s.passed === null ? '' : s.passed ? 'Yes' : 'No', s.status === 'submitted' ? s.correct : '', s.status === 'submitted' ? s.incorrect : '',
    s.status === 'submitted' ? s.unanswered : '', s.timeSpentSeconds === null ? '' : (s.timeSpentSeconds / 60).toFixed(1), s.attemptsUsed, s.attemptsAllowed,
  ])
  const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')   // BOM → Excel opens UTF-8 correctly
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${slug(meta.examTitle)}-${slug(meta.classroom)}-results.csv`)
}

export async function exportPdf(meta: ReportMeta, overview: Overview, students: StudentResult[], questions: QuestionStat[]) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableMod.default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  doc.setFontSize(18); doc.text(meta.examTitle, 40, 50)
  doc.setFontSize(10); doc.setTextColor(100)
  doc.text(`Classroom: ${meta.classroom}   |   Opens: ${fmtDateTime(meta.startsAt)}   |   Pass mark: ${meta.passingGrade}%`, 40, 68)
  doc.text(`Report generated ${fmtDateTime(new Date())}${meta.releasedAt ? `   |   Results released ${fmtDateTime(meta.releasedAt)}` : '   |   Results not yet released'}`, 40, 82)
  doc.setTextColor(0)
  const f = (n: number | null, d = 1) => (n === null ? '—' : n.toFixed(d))
  autoTable(doc, {
    startY: 100, theme: 'grid', styles: { fontSize: 9 }, headStyles: { fillColor: [37, 99, 235] },
    head: [['Enrolled', 'Started', 'Submitted', 'Not started', 'Average', 'Highest', 'Lowest', 'Pass rate', 'Avg time']],
    body: [[overview.enrolled, overview.started, overview.submitted, overview.notStarted, `${f(overview.average)}%`, `${f(overview.highest)}%`,
            `${f(overview.lowest)}%`, overview.passRate === null ? '—' : `${f(overview.passRate, 0)}%`, overview.avgTimeSeconds === null ? '—' : fmtDuration(overview.avgTimeSeconds)]],
  })
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
  doc.setFontSize(12); doc.text('Student results', 40, y)
  autoTable(doc, {
    startY: y + 8, styles: { fontSize: 8.5 }, headStyles: { fillColor: [37, 99, 235] }, margin: { left: 40, right: 40 },
    head: [['Name', 'Status', 'Grade', 'Score', 'Correct', 'Incorrect', 'Unanswered', 'Time', 'Attempts']],
    body: students.map((s) => [s.name, statusLabel(s.status), s.percent === null ? '—' : `${s.percent}%${s.passed ? '' : ' (fail)'}`,
      s.score === null ? '—' : `${s.score}/${s.maxScore}`, s.status === 'submitted' ? s.correct : '—', s.status === 'submitted' ? s.incorrect : '—',
      s.status === 'submitted' ? s.unanswered : '—', s.timeSpentSeconds === null ? '—' : fmtDuration(s.timeSpentSeconds), `${s.attemptsUsed}/${s.attemptsAllowed}`]),
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
  if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50 }
  doc.setFontSize(12); doc.text('Question analysis', 40, y)
  autoTable(doc, {
    startY: y + 8, styles: { fontSize: 8.5 }, headStyles: { fillColor: [37, 99, 235] }, margin: { left: 40, right: 40 },
    columnStyles: { 1: { cellWidth: W - 80 - 240 } },
    head: [['#', 'Question', 'Answered', 'Correct', 'Incorrect', '% correct']],
    body: questions.map((q) => [q.index, q.text.length > 110 ? q.text.slice(0, 107) + '…' : q.text, q.answered, q.correct, q.incorrect, `${Math.round(q.percentCorrect)}%`]),
  })
  doc.save(`${slug(meta.examTitle)}-${slug(meta.classroom)}-report.pdf`)
}
