import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthShell from '../components/AuthShell'
import PasswordInput from '../components/PasswordInput'
import { Button, Field } from '../components/ui'
import { errMsg } from '../lib/utils'
import { EMAIL_RE } from './Login'

/** Recovery flow: email → one-time code → new password. The temporary session from the code is used only to set the password. */
export default function ForgotPassword() {
  const nav = useNavigate()
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.')
    setBusy(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim())
    setBusy(false)
    if (err) return setError(errMsg(err))
    setStep('code')
  }
  async function verify(e: FormEvent) {
    e.preventDefault(); setError(null)
    setBusy(true)
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' })
    setBusy(false)
    if (err) return setError('That code is invalid or has expired. Request a new one.')
    setStep('password')
  }
  async function setPassword(e: FormEvent) {
    e.preventDefault(); setError(null)
    if (pw.length < 8) return setError('Password must be at least 8 characters.')
    if (pw !== pw2) return setError('The passwords do not match.')
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    if (err) { setBusy(false); return setError(errMsg(err)) }
    await supabase.auth.signOut()
    setBusy(false)
    nav('/login', { replace: true, state: { message: 'Password updated. Log in with your new password.' } })
  }

  const footer = <Link className="text-accent-fg hover:underline" to="/login">Back to log in</Link>
  if (step === 'email') return (
    <AuthShell title="Forgot password" subtitle="Enter your account email and we will send you a one-time code." footer={footer}>
      <form onSubmit={sendCode} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email"><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Send code</Button>
      </form>
    </AuthShell>
  )
  if (step === 'code') return (
    <AuthShell title="Enter the code" subtitle={`If an account exists for ${email}, a code is on its way.`} footer={footer}>
      <form onSubmit={verify} className="space-y-4">
        <Field label="Verification code" htmlFor="code"><input id="code" className="input text-center font-mono text-lg tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={10} required /></Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Verify code</Button>
        <Button className="w-full" onClick={() => { setStep('email'); setCode('') }}>Use a different email</Button>
      </form>
    </AuthShell>
  )
  return (
    <AuthShell title="Choose a new password" footer={footer}>
      <form onSubmit={setPassword} className="space-y-4">
        <Field label="New password" htmlFor="pw" hint="At least 8 characters."><PasswordInput id="pw" value={pw} onChange={setPw} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" htmlFor="pw2"><PasswordInput id="pw2" value={pw2} onChange={setPw2} autoComplete="new-password" /></Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Update password</Button>
      </form>
    </AuthShell>
  )
}
