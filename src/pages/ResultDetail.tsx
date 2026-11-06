import { Link, useParams } from 'react-router-dom'
import { rpc } from '../lib/api'
import { AttemptDetail } from '../lib/types'
import AttemptDetailView from '../components/AttemptDetailView'
import { ErrorNote, FullSpinner, PageHeader, useLoad } from '../components/ui'

export default function ResultDetail() {
  const { assignmentId = '' } = useParams()
  const q = useLoad(() => rpc<{ title: string; classroom: string; attempts: AttemptDetail[] }>('get_my_result', { p_assignment: assignmentId }), [assignmentId])
  if (q.loading && !q.data) return <FullSpinner />
  if (q.error || !q.data) return <><Link to="/results" className="text-sm text-muted hover:underline">← My results</Link><div className="mt-4"><ErrorNote error={q.error ?? 'Not available'} /></div></>
  return (
    <>
      <Link to="/results" className="text-sm text-muted hover:underline">← My results</Link>
      <PageHeader title={q.data.title} subtitle={q.data.classroom} />
      <div className="space-y-10">{q.data.attempts.map((a) => <AttemptDetailView key={a.attempt.id} d={a} />)}</div>
    </>
  )
}
