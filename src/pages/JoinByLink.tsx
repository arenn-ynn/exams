import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { rpc } from '../lib/api'
import { errMsg } from '../lib/utils'
import AuthShell from '../components/AuthShell'
import { FullSpinner } from '../components/ui'

export default function JoinByLink() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return; ran.current = true
    rpc<string>('join_classroom', { p_code: code }).then((id) => nav(`/classrooms/${id}`, { replace: true })).catch((e) => setError(errMsg(e)))
  }, [code, nav])
  if (!error) return <FullSpinner label="Joining classroom…" />
  return <AuthShell title="Could not join" subtitle={error}><Link to="/classrooms" className="btn btn-primary w-full">Go to classrooms</Link></AuthShell>
}
