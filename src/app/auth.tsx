import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, supabaseConfigured } from '../data/supabase'

const MODE_KEY = 'monvex.mode'

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in'

interface AuthCtx {
  status: AuthStatus
  user: User | null
  demo: boolean
  configured: boolean
  enterDemo: () => void
  leaveDemo: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; needsConfirmation: boolean }>
  resetPassword: (email: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'signed_out')
  const [demo, setDemo] = useState(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'demo'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setStatus(data.session ? 'signed_in' : 'signed_out')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setStatus(next ? 'signed_in' : 'signed_out')
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const enterDemo = useCallback(() => {
    try {
      localStorage.setItem(MODE_KEY, 'demo')
    } catch {
      /* storage unavailable: demo lasts for this tab only */
    }
    setDemo(true)
  }, [])
  const leaveDemo = useCallback(() => {
    try {
      localStorage.removeItem(MODE_KEY)
    } catch {
      /* ignore */
    }
    setDemo(false)
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user: session?.user ?? null,
      demo,
      configured: supabaseConfigured,
      enterDemo,
      leaveDemo,
      signIn: async (email, password) => {
        if (!supabase) return 'Supabase is not configured.'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? friendlyAuthError(error.message) : null
      },
      signUp: async (email, password, name) => {
        if (!supabase) return { error: 'Supabase is not configured.', needsConfirmation: false }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name } },
        })
        return { error: error ? friendlyAuthError(error.message) : null, needsConfirmation: !error && !data.session }
      },
      resetPassword: async (email) => {
        if (!supabase) return 'Supabase is not configured.'
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        return error ? friendlyAuthError(error.message) : null
      },
      signOut: async () => {
        await supabase?.auth.signOut()
      },
    }),
    [status, session, demo, enterDemo, leaveDemo],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login')) return 'That email and password do not match.'
  if (m.includes('already registered')) return 'An account with this email already exists. Try signing in.'
  if (m.includes('password')) return 'Choose a stronger password (at least 8 characters).'
  if (m.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.'
  if (m.includes('fetch') || m.includes('network')) return 'Could not reach the server. Check your connection.'
  return 'Something went wrong. Please try again.'
}
