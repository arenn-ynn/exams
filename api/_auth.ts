// Shared helper for the serverless functions: verifies the caller's Supabase access token.
export const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
export const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

export async function getUser(authorization: string | undefined): Promise<{ id: string; email?: string } | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token || !SUPABASE_URL || !ANON_KEY) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } })
  if (!r.ok) return null
  const u = (await r.json()) as { id?: string; email?: string }
  return u.id ? { id: u.id, email: u.email } : null
}
