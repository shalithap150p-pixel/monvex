import { FlaskConical, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CompanyCredit } from '../ui/Company'
import { InlineNote, TextField } from '../ui/Primitives'
import { useAuth } from './auth'
import { Logo } from './Brand'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo size={40} />
          <p className="text-muted">Master Your Money.</p>
        </div>
        <div className="card !p-6">{children}</div>
        <p className="t-helper mt-4 flex items-start justify-center gap-2 text-center">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          MONVEX never asks for bank passwords, PINs or OTPs.
        </p>
        <div className="mt-8">
          <CompanyCredit withMark />
        </div>
      </div>
    </div>
  )
}

function DemoButton() {
  const { enterDemo } = useAuth()
  return (
    <div className="mt-5 border-t border-border pt-5">
      <button type="button" className="btn btn-secondary w-full" onClick={enterDemo}>
        <FlaskConical className="size-4" aria-hidden /> Explore with demo data
      </button>
      <p className="t-helper mt-2 text-center">Demo data is stored only on this device, clearly labelled, and never mixed with real records.</p>
    </div>
  )
}

/** Shown when Supabase environment variables are missing. Never pretends a backend exists. */
export function SetupScreen() {
  return (
    <Frame>
      <h1 className="t-page mb-2">Connect your database</h1>
      <p className="mb-4 text-sm text-muted">MONVEX stores your finances in your own Supabase project. It is not connected yet, so sign-in and cloud sync are unavailable.</p>
      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Create a free project at supabase.com.</li>
        <li>
          Run the SQL files in <code className="rounded bg-surface-2 px-1">supabase/migrations</code> in order (0001 → 0004).
        </li>
        <li>
          Copy <code className="rounded bg-surface-2 px-1">.env.example</code> to <code className="rounded bg-surface-2 px-1">.env.local</code> and add your project URL and anon key.
        </li>
        <li>Restart the dev server.</li>
      </ol>
      <InlineNote>Only the public anon key belongs in the app. Never put a service-role key in the frontend.</InlineNote>
      <DemoButton />
    </Frame>
  )
}

export function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setInfo(null)
    if (!email.includes('@')) return setError('Enter a valid email address.')
    if (mode !== 'reset' && password.length < 8) return setError('Use a password with at least 8 characters.')
    setBusy(true)
    try {
      if (mode === 'signin') {
        const err = await signIn(email.trim(), password)
        if (err) setError(err)
      } else if (mode === 'signup') {
        const res = await signUp(email.trim(), password, name.trim())
        if (res.error) setError(res.error)
        else if (res.needsConfirmation) setInfo('Check your email to confirm your account, then sign in.')
      } else {
        const err = await resetPassword(email.trim())
        if (err) setError(err)
        else setInfo('If that email has an account, a reset link is on its way.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame>
      <h1 className="t-page mb-1">{mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset password'}</h1>
      <p className="mb-5 text-sm text-muted">{mode === 'signin' ? 'Sign in to see your finances.' : mode === 'signup' ? 'Your records stay private to you.' : "We'll email you a reset link."}</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {mode === 'signup' && <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        {mode !== 'reset' && (
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} helper={mode === 'signup' ? 'At least 8 characters.' : undefined} />
        )}
        {error && <InlineNote tone="negative">{error}</InlineNote>}
        {info && <InlineNote tone="positive">{info}</InlineNote>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        {mode === 'signin' ? (
          <>
            <button type="button" className="link" onClick={() => setMode('signup')}>Create an account</button>
            <button type="button" className="link" onClick={() => setMode('reset')}>Forgot password?</button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setMode('signin')}>Back to sign in</button>
        )}
      </div>
      <DemoButton />
    </Frame>
  )
}
