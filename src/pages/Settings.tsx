import { ChangeEvent, FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { deleteAccount } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ACCENT_SWATCH, ACCENTS, Theme, useTheme } from '../lib/theme'
import { Button, Card, Field, PageHeader, Tabs, useFeedback } from '../components/ui'
import PasswordInput from '../components/PasswordInput'
import { Avatar } from '../components/AppLayout'
import { cx, errMsg } from '../lib/utils'
import { EMAIL_RE } from './Login'

export default function SettingsPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<'profile' | 'security' | 'appearance' | 'account'>('profile')
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'profile', label: 'Profile' }, { id: 'security', label: 'Security' }, { id: 'appearance', label: 'Appearance' }, { id: 'account', label: 'Account' }]} />
      <div className="max-w-xl">{tab === 'profile' && <ProfileTab key={profile?.id ?? 'loading'} />}{tab === 'security' && <SecurityTab />}{tab === 'appearance' && <AppearanceTab />}{tab === 'account' && <AccountTab />}</div>
    </>
  )
}

function ProfileTab() {
  const { user, profile, refreshProfile } = useAuth()
  const { toast } = useFeedback()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailStep, setEmailStep] = useState<'idle' | 'code'>('idle')
  const [code, setCode] = useState('')

  async function saveName(e: FormEvent) {
    e.preventDefault(); if (name.trim().length < 2) return toast('Enter your full name.', 'error')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user!.id)
    if (!error) await supabase.auth.updateUser({ data: { full_name: name.trim() } })
    setBusy(false)
    if (error) toast(error.message, 'error'); else { toast('Profile saved.'); void refreshProfile() }
  }
  async function avatar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    if (!f.type.startsWith('image/')) return toast('Choose an image file.', 'error')
    if (f.size > 2_000_000) return toast('Image must be under 2 MB.', 'error')
    const path = `${user!.id}/avatar-${Date.now()}.${f.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'}`
    setAvatarBusy(true)
    try {
      // Every upload gets a unique path, so there is never an object to overwrite: plain insert (upsert would also demand a SELECT policy).
      const up = await supabase.storage.from('avatars').upload(path, f, { upsert: false, contentType: f.type })
      if (up.error) return toast(up.error.message, 'error')
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const old = profile?.avatar_url?.split('/avatars/')[1]
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user!.id)
      if (error) return toast(error.message, 'error')
      toast('Profile picture updated.'); void refreshProfile()
      if (old && old.startsWith(`${user!.id}/`)) void supabase.storage.from('avatars').remove([decodeURIComponent(old)])   // best effort: don't leave orphaned files behind
    } catch (err) { toast(errMsg(err), 'error') } finally { setAvatarBusy(false) }
  }
  async function requestEmail(e: FormEvent) {
    e.preventDefault(); if (!EMAIL_RE.test(newEmail.trim())) return toast('Enter a valid email address.', 'error')
    setBusy(true); const { error } = await supabase.auth.updateUser({ email: newEmail.trim() }); setBusy(false)
    if (error) toast(errMsg(error), 'error'); else { setEmailStep('code'); toast('We sent a verification code to the new address.', 'info') }
  }
  async function confirmEmail(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email: newEmail.trim(), token: code.trim(), type: 'email_change' })
    setBusy(false)
    if (error) return toast('That code is invalid or expired.', 'error')
    toast('Email address changed.'); setEmailStep('idle'); setCode(''); setNewEmail(''); void refreshProfile()
  }
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-4"><Avatar url={profile?.avatar_url} name={profile?.full_name || user?.email || '?'} size={64} />
          <label className="btn btn-secondary cursor-pointer focus-within:outline focus-within:outline-2">{avatarBusy ? 'Uploading…' : 'Change picture'}<input type="file" accept="image/*" className="sr-only" disabled={avatarBusy} onChange={avatar} /></label></div>
        <form onSubmit={saveName} className="space-y-4"><Field label="Full name" htmlFor="fn"><input id="fn" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field><Button type="submit" variant="primary" loading={busy}>Save</Button></form>
      </Card>
      <Card className="p-5">
        <h2 className="mb-1 font-semibold">Email address</h2><p className="mb-4 text-sm text-muted">Current: {user?.email}. Changing it requires verifying the new address with a one-time code.</p>
        {emailStep === 'idle' ? (
          <form onSubmit={requestEmail} className="space-y-4"><Field label="New email" htmlFor="ne"><input id="ne" type="email" className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required /></Field><Button type="submit" loading={busy}>Send verification code</Button></form>
        ) : (
          <form onSubmit={confirmEmail} className="space-y-4"><Field label={`Code sent to ${newEmail}`} htmlFor="ec"><input id="ec" className="input font-mono tracking-widest" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></Field>
            <div className="flex gap-2"><Button type="submit" variant="primary" loading={busy}>Confirm change</Button><Button onClick={() => setEmailStep('idle')}>Cancel</Button></div></form>
        )}
      </Card>
    </div>
  )
}

function SecurityTab() {
  const { user } = useAuth()
  const nav = useNavigate()
  const { toast } = useFeedback()
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false)
  async function change(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return toast('New password must be at least 8 characters.', 'error')
    if (pw !== pw2) return toast('The new passwords do not match.', 'error')
    if (pw === cur) return toast('Choose a password different from the current one.', 'error')
    setBusy(true)
    // Re-authenticate with the current password first; without it the change is refused.
    const check = await supabase.auth.signInWithPassword({ email: user!.email!, password: cur })
    if (check.error) { setBusy(false); return toast('Your current password is incorrect.', 'error') }
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) toast(errMsg(error), 'error'); else { toast('Password changed.'); setCur(''); setPw(''); setPw2('') }
  }
  async function forgot() { await supabase.auth.signOut(); nav('/forgot-password') }
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Change password</h2>
      <form onSubmit={change} className="space-y-4">
        <Field label="Current password" htmlFor="cp"><PasswordInput id="cp" value={cur} onChange={setCur} autoComplete="current-password" /></Field>
        <Field label="New password" htmlFor="np" hint="At least 8 characters."><PasswordInput id="np" value={pw} onChange={setPw} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" htmlFor="np2"><PasswordInput id="np2" value={pw2} onChange={setPw2} autoComplete="new-password" /></Field>
        <Button type="submit" variant="primary" loading={busy}>Change password</Button>
      </form>
      <p className="mt-4 border-t border-line pt-4 text-sm text-muted">Forgot your current password? <button className="text-accent-fg hover:underline" onClick={forgot}>Reset it with an email code</button> (this logs you out first).</p>
    </Card>
  )
}

function AppearanceTab() {
  const { theme, setTheme, accent, setAccent } = useTheme()
  const opts: { id: Theme; label: string; icon: typeof Sun }[] = [{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'System', icon: Monitor }]
  return (
    <Card className="space-y-6 p-5">
      <div><h2 className="mb-3 font-semibold">Theme</h2><div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {opts.map((o) => <button key={o.id} role="radio" aria-checked={theme === o.id} onClick={() => setTheme(o.id)} className={cx('flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border text-sm font-medium', theme === o.id ? 'border-accent bg-accent/10 text-accent-fg' : 'border-line hover:bg-subtle')}><o.icon className="h-5 w-5" />{o.label}</button>)}</div></div>
      <div><h2 className="mb-3 font-semibold">Accent color</h2><div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent color">
        {ACCENTS.map((a) => <button key={a} role="radio" aria-checked={accent === a} aria-label={a} onClick={() => setAccent(a)} className="flex h-11 w-11 items-center justify-center rounded-full ring-offset-2 ring-offset-surface" style={{ background: ACCENT_SWATCH[a], boxShadow: accent === a ? `0 0 0 2px rgb(var(--surface)), 0 0 0 4px ${ACCENT_SWATCH[a]}` : undefined }}>{accent === a && <Check className="h-5 w-5 text-white" />}</button>)}</div>
        <p className="mt-2 text-xs text-muted">Saved to your account, so it follows you across devices.</p></div>
    </Card>
  )
}

function AccountTab() {
  const { signOut } = useAuth()
  const nav = useNavigate()
  const { toast, confirm } = useFeedback()
  const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false)
  async function del() {
    if (typed !== 'DELETE') return
    if (!(await confirm({ title: 'Delete your account permanently?', message: 'Your profile, examinations, classrooms you created and your attempts will be erased. This cannot be undone.', confirmLabel: 'Delete my account', danger: true }))) return
    setBusy(true)
    try { await deleteAccount(); await signOut(); nav('/login', { replace: true, state: { message: 'Your account was deleted.' } }) } catch (e) { toast(errMsg(e), 'error'); setBusy(false) }
  }
  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-5"><h2 className="font-semibold">Sessions</h2>
        <div className="flex flex-wrap gap-2"><Button onClick={() => signOut('local').then(() => nav('/login'))}>Log out</Button><Button onClick={() => signOut('global').then(() => nav('/login'))}>Log out from all devices</Button></div></Card>
      <Card className="space-y-3 border-danger/40 p-5"><h2 className="font-semibold text-danger">Delete account</h2>
        <p className="text-sm text-muted">Type <b>DELETE</b> to confirm.</p>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm" />
        <Button variant="danger" disabled={typed !== 'DELETE'} loading={busy} onClick={del}>Delete my account</Button></Card>
    </div>
  )
}
