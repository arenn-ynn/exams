import { supabase } from './supabase'

/** Call a Postgres function (RPC). Throws an Error carrying the database's human-readable message. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
}

export interface AiStatus { configured: boolean; provider?: string; model?: string }

let aiStatusCache: Promise<AiStatus | null> | null = null
/** Whether the server has an AI provider configured. Server configuration doesn't change while the app is open,
 *  so a successful answer is cached for the session (the editor and generator both ask on every visit). Failures aren't cached. */
export async function aiStatus(): Promise<AiStatus> {
  if (!aiStatusCache) {
    aiStatusCache = (async () => {
      try {
        const r = await fetch('/api/ai-generate', { headers: await authHeader() })
        return r.ok ? ((await r.json()) as AiStatus) : null
      } catch { return null }
    })()
  }
  const s = await aiStatusCache
  if (!s) { aiStatusCache = null; return { configured: false } }
  return s
}

export async function callAi(body: Record<string, unknown>): Promise<unknown> {
  let r: Response
  try {
    r = await fetch('/api/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the AI service. When running locally, use "npx vercel dev" instead of "npm run dev" so /api works.')
  }
  const text = await r.text()
  let json: { exam?: unknown; error?: string } = {}
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (!r.ok) throw new Error(json.error || `AI request failed (${r.status}). ${r.status === 404 ? 'The /api route is not available — use "npx vercel dev" locally.' : ''}`)
  if (!json.exam) throw new Error('The AI returned an empty response.')
  return json.exam
}

export async function deleteAccount(): Promise<void> {
  const r = await fetch('/api/delete-account', { method: 'POST', headers: await authHeader() })
  if (!r.ok) {
    let msg = `Account deletion failed (${r.status}).`
    try { msg = ((await r.json()) as { error?: string }).error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
}
