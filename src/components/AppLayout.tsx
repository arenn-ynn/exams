import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Award, BarChart3, Bell, FileText, GraduationCap, History, LayoutDashboard, LogOut, Menu, School, Settings } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { cx } from '../lib/utils'
import { Modal } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/examinations', label: 'Examinations', icon: FileText },
  { to: '/classrooms', label: 'Classrooms', icon: School },
  { to: '/analytics', label: 'Examination Analytics', icon: BarChart3 },
  { to: '/results', label: 'My Results', icon: Award },
  { to: '/history', label: 'History', icon: History },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]
const BOTTOM = ['/', '/examinations', '/classrooms', '/results']

function useUnread() {
  const { user } = useAuth()
  const uid = user?.id            // depend on the id, not the object: the object changes on every token refresh / tab focus
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!uid) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      void supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
        .then(({ count, error }) => { if (alive && !error) setN(count ?? 0) })
    }
    const load = () => { clearTimeout(timer); timer = setTimeout(run, 150) }   // coalesce bursts of realtime events
    run()
    void supabase.rpc('generate_my_reminders').then(({ error }) => { if (!error && alive) run() })
    const ch = supabase.channel(`notif-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, load)
      .subscribe()
    window.addEventListener('examina:notifications', load)
    return () => { alive = false; clearTimeout(timer); void supabase.removeChannel(ch); window.removeEventListener('examina:notifications', load) }
  }, [uid])
  return n
}

function Logo() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white"><GraduationCap className="h-4 w-4" /></span>
      EXAMINA
    </div>
  )
}

export default function AppLayout() {
  const { profile, user, signOut } = useAuth()
  const unread = useUnread()
  const [more, setMore] = useState(false)
  const loc = useLocation()
  useEffect(() => { setMore(false); window.scrollTo(0, 0) }, [loc.pathname])

  const item = (n: (typeof NAV)[number], onClick?: () => void) => (
    <NavLink key={n.to} to={n.to} end={n.end} onClick={onClick}
      className={({ isActive }) => cx('flex min-h-[40px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
        isActive ? 'bg-accent/10 text-accent-fg' : 'text-muted hover:bg-subtle hover:text-fg')}>
      <n.icon className="h-4 w-4" />
      <span className="min-w-0 flex-1 truncate">{n.label}</span>
      {n.to === '/notifications' && unread > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-white" aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  )

  return (
    <div className="min-h-full md:flex">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface p-3 md:flex">
        <div className="px-3 py-3"><Logo /></div>
        <nav className="mt-3 flex flex-1 flex-col gap-0.5" aria-label="Main">{NAV.map((n) => item(n))}</nav>
        <NavLink to="/settings" className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-subtle">
          <Avatar url={profile?.avatar_url} name={profile?.full_name || user?.email || '?'} />
          <div className="min-w-0 text-left text-sm"><div className="truncate font-medium">{profile?.full_name || 'Account'}</div><div className="truncate text-xs text-muted">{user?.email}</div></div>
        </NavLink>
        <button onClick={() => void signOut()} className="mt-1 flex min-h-[40px] items-center gap-3 rounded-md px-3 text-sm font-medium text-muted transition-colors hover:bg-subtle hover:text-fg"><LogOut className="h-4 w-4" />Sign out</button>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <Logo />
        <NavLink to="/notifications" className="relative flex h-11 w-11 items-center justify-center rounded-md hover:bg-subtle" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">{unread}</span>}
        </NavLink>
      </header>

      <main className="min-w-0 flex-1 md:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-10"><Outlet /></div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 grid w-full grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Primary">
        {NAV.filter((n) => BOTTOM.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex min-h-[56px] min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium', isActive ? 'text-accent-fg' : 'text-muted')}>
            <n.icon className="h-5 w-5 shrink-0" /><span className="max-w-full truncate">{n.label.replace('Examinations', 'Exams').replace('My Results', 'Results')}</span>
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className="flex min-h-[56px] min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium text-muted"><Menu className="h-5 w-5 shrink-0" />More</button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="Menu"><div className="flex flex-col gap-1">{NAV.map((n) => item(n, () => setMore(false)))}
        <button onClick={() => { setMore(false); void signOut() }} className="mt-2 flex min-h-[44px] items-center gap-3 rounded-md border-t border-line px-3 pt-2 text-sm font-medium text-muted transition-colors hover:bg-subtle hover:text-fg"><LogOut className="h-4 w-4" />Sign out</button></div></Modal>
    </div>
  )
}

export function Avatar({ url, name, size = 32 }: { url?: string | null; name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return url
    ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="flex shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent-fg" style={{ width: size, height: size }} aria-hidden>{initials}</span>
}
