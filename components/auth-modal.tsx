'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import { X, Sparkles, Mail, Lock, LogIn, LogOut, CheckCircle2, User as UserIcon } from 'lucide-react'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  user: User | null
  onUserChange: (user: User | null) => void
}

export function AuthModal({ isOpen, onClose, user, onUserChange }: AuthModalProps) {
  const [mounted, setMounted] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (!isOpen || !mounted) return null

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })
        if (error) throw error
        if (data.user) {
          setMessage({
            type: 'success',
            text: 'Account created! Please check your email to verify or continue studying.',
          })
          onUserChange(data.user)
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        if (data.user) {
          setMessage({ type: 'success', text: 'Welcome back! Your study logs are synced.' })
          onUserChange(data.user)
          setTimeout(() => {
            onClose()
          }, 800)
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred during authentication.'
      setMessage({ type: 'error', text: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      })
      if (error) throw error
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unable to continue with Google.'
      setMessage({ type: 'error', text: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    onUserChange(null)
    setLoading(false)
    onClose()
  }

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
      }}
      className="flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="paper-card relative w-full max-w-sm overflow-hidden p-6 sm:p-7 shadow-2xl animate-fade-in my-auto">
        <div className="tape tape-yellow" />
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-ink hover:bg-black/5 transition"
          aria-label="Close modal"
        >
          <X className="size-4" />
        </button>

        {user ? (
          <div className="text-center pt-2">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#b9e6d3] text-[#447e68] shadow-sm">
              <UserIcon className="size-6" />
            </div>
            <p className="eyebrow">logged in account</p>
            <h3 className="font-display text-xl font-bold text-ink mb-1">
              {user.email?.split('@')[0]}
            </h3>
            <p className="font-mono text-xs text-muted-ink break-all mb-6">
              {user.email}
            </p>

            <div className="rounded-xl border border-dashed border-line bg-paper/60 p-3 mb-6 text-left">
              <div className="flex items-center gap-2 text-xs text-[#5c9774] font-medium">
                <CheckCircle2 className="size-4" />
                <span>Cloud Sync is Active</span>
              </div>
              <p className="text-[11px] text-muted-ink mt-1">
                Your focus sessions and streaks are securely saved to your Supabase account.
              </p>
            </div>

            <button
              onClick={handleSignOut}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-xs font-semibold text-[#a2605a] hover:bg-[#fff0e8] transition"
            >
              <LogOut className="size-4" />
              {loading ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="brand-sticker size-8! rounded-lg!">
                <Sparkles className="size-4" />
              </div>
              <div>
                <p className="eyebrow">cloud sync</p>
                <h3 className="font-display text-lg font-bold">
                  {isSignUp ? 'create account' : 'welcome back'}
                </h3>
              </div>
            </div>

            <p className="text-xs text-muted-ink mb-5 leading-relaxed">
              Sign in to sync your study history, daily logs, and streaks across all your devices.
            </p>

            {message && (
              <div
                className={`mb-4 rounded-xl p-3 text-xs leading-5 border ${
                  message.type === 'success'
                    ? 'bg-[#e5f4e9] text-[#5c9774] border-[#c9e5d2]'
                    : 'bg-[#fff0e8] text-[#a2605a] border-[#efb5ae]'
                }`}
              >
                {message.text}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-3">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-ink mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 size-4 text-muted-ink" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="learner@cozycorner.app"
                    className="w-full rounded-xl border border-line bg-paper pl-9 pr-3 py-2 text-xs text-ink outline-none focus:border-[#ee8d92]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-ink mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 size-4 text-muted-ink" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-line bg-paper pl-9 pr-3 py-2 text-xs text-ink outline-none focus:border-[#ee8d92]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full main-button justify-center mt-4 py-2.5 text-xs"
              >
                <LogIn className="size-4" />
                {loading ? 'Please wait...' : isSignUp ? 'Create cozy account' : 'Sign in & sync'}
              </button>
            </form>

            <div className="auth-divider"><span>or continue with</span></div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="google-auth-button"
            >
              <span className="google-auth-mark" aria-hidden="true">G</span>
              {loading ? 'Connecting...' : 'Continue with Google'}
            </button>
            <p className="auth-provider-note">Use your Google account to sync across devices.</p>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp)
                  setMessage(null)
                }}
                className="text-[11px] text-muted-ink hover:text-ink transition underline decoration-dotted"
              >
                {isSignUp
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Sign up"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
