import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ErrorNote, FullSpinner, useLoad } from '../components/ui'

/** Fullscreen joining screen for projectors. */
export default function JoinDisplay() {
  const { id } = useParams()
  const [qr, setQr] = useState('')
  const c = useLoad(async () => {
    const { data, error } = await supabase.from('classrooms').select('name,join_code,enrollment_open').eq('id', id!).single()
    if (error) throw error
    return data as { name: string; join_code: string; enrollment_open: boolean }
  }, [id])
  const link = c.data ? `${location.origin}/join/${c.data.join_code}` : ''
  useEffect(() => {
    if (!link) return
    let alive = true
    QRCode.toDataURL(link, { margin: 1, width: 360 }).then((u) => { if (alive) setQr(u) }).catch(() => { /* the code itself is still shown */ })
    return () => { alive = false }
  }, [link])
  useEffect(() => { void document.documentElement.requestFullscreen?.().catch(() => {}); return () => { if (document.fullscreenElement) void document.exitFullscreen() } }, [])
  if (c.loading) return <FullSpinner />
  if (c.error || !c.data) return <div className="p-6"><ErrorNote error={c.error ?? 'Not found'} /></div>
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg px-4 pb-8 pt-20 text-center md:px-6">
      <Link to={`/classrooms/${id}`} className="btn btn-secondary fixed right-4 top-4"><X className="h-4 w-4" />Close</Link>
      <p className="text-lg text-muted md:text-2xl">Join classroom</p>
      <h1 className="mt-2 max-w-full text-3xl font-semibold md:text-5xl">{c.data.name}</h1>
      {c.data.enrollment_open ? (
        <>
          <div className="mt-8 max-w-full rounded-2xl border border-line bg-surface px-4 py-4 font-mono text-[clamp(1.75rem,10vw,8rem)] font-bold leading-none tracking-[0.2em] text-accent-fg md:px-10 md:py-8" aria-label={`Joining code ${c.data.join_code.split('').join(' ')}`}>{c.data.join_code}</div>
          <div className="mt-8 flex flex-col items-center gap-6 md:flex-row">
            {qr && <img src={qr} alt="QR code to join" className="h-40 w-40 shrink-0 rounded-lg bg-white p-2 md:h-56 md:w-56" width={224} height={224} />}
            <ol className="text-left text-base text-muted md:text-xl"><li>1. Open <b className="text-fg">{location.host}</b> and log in</li><li>2. Go to <b className="text-fg">Classrooms → Join classroom</b></li><li>3. Enter the code — or scan the QR code</li></ol>
          </div>
        </>
      ) : <p className="mt-8 text-xl text-warn">Enrollment is currently closed.</p>}
    </div>
  )
}
