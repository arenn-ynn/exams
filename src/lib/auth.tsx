import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { Profile } from './types'

interface AuthState {
  session: Session | null; user: User | null; profile: Profile | null; loading: boolean
  refreshProfile: () => Promise<void>; signOut: (scope?: 'local' | 'global') => Promise<void>
}
const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

/** supabase-js re-emits the (unchanged) session on tab focus and on every token refresh.
 *  Keeping the previous object when nothing meaningful changed avoids re-rendering the whole app
 *  and re-running every effect that depends on the user. */
function sameSession(a: Session | null, b: Session | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a.access_token === b.access_token && a.user.id === b.user.id && a.user.updated_at === b.user.updated_at
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setSession((prev) => (sameSession(prev, data.session) ? prev : data.session)) })
      .catch(() => { /* an unreadable stored session simply means "signed out" */ })
      .finally(() => { if (alive) setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession((prev) => (sameSession(prev, s) ? prev : s)))   // keep this callback synchronous
    return () => { alive = false; data.subscription.unsubscribe() }
  }, [])

  const uid = session?.user.id
  const uidRef = useRef(uid)
  uidRef.current = uid
  const refreshProfile = useCallback(async () => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('id, full_name, email, avatar_url').eq('id', uid).maybeSingle()
    if (uidRef.current === uid) setProfile((data as Profile | null) ?? null)   // ignore a response for a user who has since signed out / switched
  }, [uid])
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    await supabase.auth.signOut({ scope })
    setProfile(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, user: session?.user ?? null, profile, loading, refreshProfile, signOut }),
    [session, profile, loading, refreshProfile, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
