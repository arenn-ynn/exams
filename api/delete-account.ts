import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUser, SUPABASE_URL } from './_auth.js'

// Permanently deletes the CALLING user. The service-role key never leaves the server.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' })
  const user = await getUser(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Not authenticated.' })
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  })
  if (!r.ok) return res.status(502).json({ error: `Supabase refused to delete the account (${r.status}).` })
  return res.status(200).json({ ok: true })
}
