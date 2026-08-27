'use client'

import { useState, useEffect } from 'react'
import { Settings } from 'lucide-react'
import { SettingsModal } from './settings-modal'
import { AuthModal } from './auth-modal'
import { supabase } from '@/lib/supabase'

export function SettingsFloatingButton() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <>
      <div className="settings-float-wrap">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="settings-float-btn"
          title="ตั้งค่า Settings & Themes"
        >
          <Settings className="settings-float-icon" />
          {user && <span className="settings-float-dot" />}
        </button>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={() => setIsAuthOpen(false)}
      />
    </>
  )
}
