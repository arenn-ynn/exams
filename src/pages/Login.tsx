import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthShell from '../components/AuthShell'
import PasswordInput from '../components/PasswordInput'
import { Button, Field } from '../components/ui'
import { errMsg } from '../lib/utils'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string; message?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailErr, setEmailErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!EMAIL_RE.test(email.trim())) { setEmailErr('Enter a valid email address.'); return }
    setEmailErr(null)
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (err) {
      if (/not confirmed/i.test(err.message)) {
        await supabase.auth.resend({ type: 'signup', email: email.trim() })
        nav('/register', { state: { verifyEmail: email.trim() } })
        return
      }
      setError(/invalid login/i.test(err.message) ? 'Incorrect email or password.' : errMsg(err))
      return
    }
    nav(loc.state?.from ?? '/', { replace: true })   // session is remembered by Supabase (stored in the browser)
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your account" footer={<>New to EXAMINA? <Link className="font-medium text-accent-fg hover:underline" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {loc.state?.message && <p className="rounded-md bg-ok/10 p-3 text-sm text-ok" role="status">{loc.state.message}</p>}
        <Field label="Email" htmlFor="email" error={emailErr}>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Log in</Button>
        <div className="text-center text-sm"><Link className="text-accent-fg hover:underline" to="/forgot-password">Forgot password?</Link></div>
      </form>
    </AuthShell>
  )
}
