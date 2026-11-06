import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn, Plus, School, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Badge, Button, Empty, ErrorNote, Field, FullSpinner, Modal, PageHeader, useFeedback, useLoad } from '../components/ui'
import { errMsg } from '../lib/utils'

interface Cls { id: string; name: string; description: string; archived: boolean; enrollment_open: boolean; join_code: string; classroom_members: { count: number }[] }

export function JoinModal({ open, onClose, initial = '' }: { open: boolean; onClose: () => void; initial?: string }) {
  const nav = useNavigate()
  const { toast } = useFeedback()
  const [code, setCode] = useState(initial)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { const id = await rpc<string>('join_classroom', { p_code: code }); toast('You joined the classroom.'); onClose(); nav(`/classrooms/${id}`) }
    catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Join a classroom">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Joining code" htmlFor="jc" hint="Ask the classroom owner for the code. You only join once — every examination assigned to the classroom appears automatically."><input id="jc" className="input font-mono uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} autoFocus required /></Field>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Join</Button></div>
      </form>
    </Modal>
  )
}

export default function Classrooms() {
  const { user } = useAuth()
  const nav = useNavigate()
  const { toast } = useFeedback()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [busy, setBusy] = useState(false)
  const list = useLoad(async () => {
    const { data, error } = await supabase.from('classrooms').select('id,name,description,archived,enrollment_open,join_code,owner_id,classroom_members(count)').order('created_at', { ascending: false })
    if (error) throw error
    return data as unknown as (Cls & { owner_id: string })[]
  }, [])
  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { const id = await rpc<string>('create_classroom', { p_name: name, p_description: desc }); toast('Classroom created.'); nav(`/classrooms/${id}`) }
    catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  const mine = (list.data ?? []).filter((c) => c.owner_id === user?.id)
  const joined = (list.data ?? []).filter((c) => c.owner_id !== user?.id)
  const card = (c: Cls, owner: boolean) => (
    <Link key={c.id} to={`/classrooms/${c.id}`} className="card block p-4 transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{c.name}</h3>{c.archived && <Badge tone="warn">Archived</Badge>}</div>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{c.description || 'No description'}</p>
      {owner && <div className="mt-3 flex items-center gap-3 text-xs text-muted"><span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{c.classroom_members[0]?.count ?? 0} members</span><span className="font-mono">{c.join_code}</span>{!c.enrollment_open && <Badge>Closed</Badge>}</div>}
    </Link>
  )
  return (
    <>
      <PageHeader title="Classrooms" subtitle="A classroom is a persistent group. Join once, then take every examination assigned to it." actions={<><Button onClick={() => setJoining(true)}><LogIn className="h-4 w-4" />Join classroom</Button><Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Create classroom</Button></>} />
      {list.loading && !list.data ? <FullSpinner /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : (
        <div className="space-y-8">
          <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Managed by me</h2>
            {mine.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{mine.map((c) => card(c, true))}</div>
              : <Empty icon={<School className="h-8 w-8" />} title="You have not created a classroom" text="Create one for each group of students (e.g. “Class 10A”) and reuse it for every examination." action={<Button variant="primary" onClick={() => setCreating(true)}>Create classroom</Button>} />}</section>
          <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Joined</h2>
            {joined.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{joined.map((c) => card(c, false))}</div>
              : <Empty icon={<Users className="h-8 w-8" />} title="You have not joined a classroom" text="Enter a joining code from your teacher." action={<Button onClick={() => setJoining(true)}>Join classroom</Button>} />}</section>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Create classroom">
        <form onSubmit={create} className="space-y-4">
          <Field label="Name" htmlFor="cn"><input id="cn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus /></Field>
          <Field label="Description (optional)" htmlFor="cd"><textarea id="cd" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Create</Button></div>
        </form>
      </Modal>
      <JoinModal open={joining} onClose={() => setJoining(false)} />
    </>
  )
}
