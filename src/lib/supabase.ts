import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'))

// A placeholder URL keeps the app importable so we can show a friendly "not configured" screen instead of crashing.
export const supabase = createClient(isConfigured ? url! : 'http://localhost:54321', isConfigured ? key! : 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
