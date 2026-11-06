import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { Button, Empty, ErrorNote, FullSpinner, PageHeader, useLoad } from '../components/ui'
import { cx, fmtDateTime } from '../lib/utils'

interface N { id: string; type: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }
const PAGE = 20
const ping = () => window.dispatchEvent(new Event('examina:notifications'))

export default function Notifications() {
  const nav = useNavigate()
  const [limit, setLimit] = useState(PAGE)
  const q = useLoad(async () => {
    const { data, error } = await supabase.from('notifications').select('id,type,title,body,link,read_at,created_at').order('created_at', { ascending: false }).range(0, limit - 1)
    if (error) throw error
    return data as N[]
  }, [limit])
  async function open(n: N) {
    if (!n.read_at) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); ping() }
    if (n.link) nav(n.link); else q.reload()
  }
  async function markAll() { await rpc('mark_all_notifications_read'); ping(); q.reload() }
  const unread = (q.data ?? []).filter((n) => !n.read_at).length
  return (
    <>
      <PageHeader title="Notifications" actions={<Button onClick={markAll} disabled={unread === 0}>Mark all as read</Button>} />
      {q.loading && !q.data ? <FullSpinner /> : q.error ? <ErrorNote error={q.error} retry={q.reload} /> : (q.data ?? []).length === 0 ? <Empty icon={<Bell className="h-8 w-8" />} title="You're all caught up" text="Announcements, new examinations, released results and other classroom events show up here." /> : (
        <>
          <div className="card divide-y divide-line">{q.data!.map((n) => (
            <button key={n.id} onClick={() => open(n)} className={cx('flex w-full items-start gap-3 p-4 text-left hover:bg-subtle', !n.read_at && 'bg-accent/5')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent')} aria-label={n.read_at ? 'Read' : 'Unread'} />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{n.title}</span>{n.body && <span className="block text-sm text-muted">{n.body}</span>}<span className="mt-0.5 block text-xs text-muted">{fmtDateTime(n.created_at)}</span></span></button>))}</div>
          {q.data!.length >= limit && <div className="mt-4 text-center"><Button onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>}
        </>
      )}
    </>
  )
}
