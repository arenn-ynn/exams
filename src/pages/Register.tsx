import { FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthShell from '../components/AuthShell'
import PasswordInput from '../components/PasswordInput'
import { Button, Field } from '../components/ui'
import { errMsg } from '../lib/utils'
import { EMAIL_RE } from './Login'

export default function Register() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { verifyEmail?: string } }
  const [step, setStep] = useState<'form' | 'verify'>(loc.state?.verifyEmail ? 'verify' : 'form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(loc.state?.verifyEmail ?? '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function register(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (name.trim().length < 2) return setError('Please enter your full name.')
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.')
    if (pw.length < 8) return setError('Password must be at least 8 characters.')
    if (pw !== pw2) return setError('The passwords do not match.')
    setBusy(true)
    const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name.trim() } } })
    setBusy(false)
    if (err) return setError(errMsg(err))
    if (data.session) {   // Supabase "Confirm email" is switched off → verification would be skipped
      await supabase.auth.signOut()
      return setError('Email confirmation is disabled in your Supabase project. Enable "Confirm email" in Authentication → Providers → Email (see README).')
    }
    if (data.user && data.user.identities && data.user.identities.length === 0) return setError('An account with this email already exists. Try logging in instead.')
    setStep('verify'); setCooldown(60)
  }

  async function verify(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!/^\d{6,10}$/.test(code.trim())) return setError('Enter the numeric code from the email.')
    setBusy(true)
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' })
    setBusy(false)
    if (err) return setError(/expired|invalid/i.test(err.message) ? 'That code is invalid or has expired. Request a new one.' : errMsg(err))
    nav('/', { replace: true })
  }

  async function resend() {
    setError(null); setInfo(null)
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    if (err) return setError(errMsg(err))
    setInfo('A new code has been sent.'); setCooldown(60)
  }

  if (step === 'verify') {
    return (
      <AuthShell title="Verify your email" subtitle={`We sent a one-time code to ${email}. Enter it below.`} footer={<Link className="text-accent-fg hover:underline" to="/login">Back to log in</Link>}>
        <form onSubmit={verify} className="space-y-4">
          <Field label="Verification code" htmlFor="code">
            <input id="code" className="input text-center font-mono text-lg tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={10} required />
          </Field>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {info && <p className="text-sm text-ok" role="status">{info}</p>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Verify and continue</Button>
          <Button className="w-full" onClick={resend} disabled={cooldown > 0}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create your account" subtitle="One account to create exams and join classrooms" footer={<>Already registered? <Link className="font-medium text-accent-fg hover:underline" to="/login">Log in</Link></>}>
      <form onSubmit={register} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="name"><input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Email" htmlFor="email"><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" htmlFor="pw" hint="At least 8 characters."><PasswordInput id="pw" value={pw} onChange={setPw} autoComplete="new-password" /></Field>
        <Field label="Confirm password" htmlFor="pw2"><PasswordInput id="pw2" value={pw2} onChange={setPw2} autoComplete="new-password" /></Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Create account</Button>
      </form>
    </AuthShell>
  )
}
