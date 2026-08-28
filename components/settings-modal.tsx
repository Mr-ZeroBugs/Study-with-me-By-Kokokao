'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Palette,
  MessageCircle,
  User as UserIcon,
  Check,
  Copy,
  RefreshCw,
  Unlink,
  ExternalLink,
  Sparkles,
  Sun,
  Moon,
  Feather,
  CheckCircle2,
  AlertCircle,
  Clock,
  BookOpen,
  LogOut,
  Sliders,
} from 'lucide-react'
import {
  getStoredTheme,
  setAppTheme,
  getIntensityThreshold,
  setIntensityThreshold,
  AppTheme,
} from '@/lib/theme'
import { supabase } from '@/lib/supabase'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  user?: any
  onOpenAuth?: () => void
}

export function SettingsModal({ isOpen, onClose, user, onOpenAuth }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'theme' | 'line' | 'account'>('theme')
  const [currentTheme, setCurrentTheme] = useState<AppTheme>('cozy')
  const [intensityMinutes, setIntensityMinutes] = useState(90)

  // LINE Connection state
  const [isConnected, setIsConnected] = useState(false)
  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const LINE_BOT_ID = '@277sabim'
  const LINE_ADD_URL = 'https://line.me/R/ti/p/@277sabim'

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setCurrentTheme(getStoredTheme())
      setIntensityMinutes(getIntensityThreshold())
      if (user) checkLineStatus()
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, user])

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  const checkLineStatus = async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/line/connect', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setIsConnected(data.isConnected ?? data.connected ?? false)
        if (data.activeCode || data.link_code) {
          setLinkCode(data.activeCode || data.link_code)
        }
      }
    } catch (err: any) {
      console.error('Failed to check LINE status:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateCode = async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/line/connect', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate code')
      setLinkCode(data.linkCode || data.link_code)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleUnlink = async () => {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการยกเลิกการเชื่อมต่อ LINE?')) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/line/connect', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        setIsConnected(false)
        setLinkCode(null)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyCode = () => {
    if (!linkCode) return
    navigator.clipboard.writeText(linkCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleThemeChange = (theme: AppTheme) => {
    setCurrentTheme(theme)
    setAppTheme(theme)
  }

  const handleIntensityChange = (minutes: number) => {
    const safe = Math.max(15, Math.min(360, Math.round(minutes)))
    setIntensityMinutes(safe)
    setIntensityThreshold(safe)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    onClose()
    window.location.reload()
  }

  if (!isOpen) return null

  const presets = [
    { label: '30 min', value: 30 },
    { label: '1 hr', value: 60 },
    { label: '1.5 hr', value: 90 },
    { label: '2 hr', value: 120 },
    { label: '3 hr', value: 180 },
    { label: '5 hr', value: 300 },
  ]

  const formatThreshold = (mins: number) => {
    if (mins < 60) return `${mins} min`
    const hours = mins / 60
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
      }}
      className="flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="paper-card relative w-full max-w-md overflow-hidden p-6 sm:p-7 shadow-2xl animate-fade-in my-auto max-h-[90vh] overflow-y-auto">
        <div className="tape tape-yellow" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-ink hover:bg-black/5 transition"
          aria-label="Close modal"
        >
          <X className="size-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="brand-sticker size-8! rounded-lg!">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="eyebrow">preferences</p>
            <h3 className="font-display text-lg font-bold text-ink">
              Settings
            </h3>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 border-b border-line pb-2 mb-4">
          {[
            { id: 'theme', label: 'Theme', icon: Palette },
            { id: 'line', label: 'LINE Bot', icon: MessageCircle },
            { id: 'account', label: 'Account', icon: UserIcon },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === id
                  ? 'bg-paper text-ink shadow-xs border border-line font-bold'
                  : 'text-muted-ink hover:text-ink'
              }`}
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
              {id === 'line' && isConnected && (
                <span className="size-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
          ))}
        </div>

        {/* Tab 1: THEME & INTENSITY (LATEST DESIGN) */}
        {activeTab === 'theme' && (
          <div className="space-y-4 pt-1">
            {/* Theme Grid */}
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-ink mb-2">
                เลือกธีม (Theme)
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'cozy', label: 'Cozy Paper', icon: Feather },
                  { id: 'light', label: 'Light Glass', icon: Sun },
                  { id: 'dark-glass', label: 'Dark Glass', icon: Moon },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => handleThemeChange(id as AppTheme)}
                    data-active={currentTheme === id ? 'true' : 'false'}
                    className={`settings-theme-option settings-theme-option-${id} flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition ${
                      currentTheme === id
                        ? 'border-[#ee8d92] bg-[#fff5f5] text-ink font-bold shadow-xs'
                        : 'border-line bg-paper/60 text-muted-ink hover:border-[#ee8d92]/50 hover:text-ink'
                    }`}
                  >
                    <Icon className="size-5" />
                    <span className="text-[11px]">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Intensity Setting */}
            <div className="settings-intensity-panel rounded-2xl border border-line bg-paper/60 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold leading-tight text-ink">
                    <Sliders className="size-3.5 shrink-0 text-[#ee8d92]" />
                    <span>Deep Focus</span>
                  </div>
                  <p className="mt-1 pl-5 text-[9px] uppercase tracking-wide text-muted-ink">
                    calendar intensity · darkest shade
                  </p>
                </div>
                <span className="settings-intensity-value inline-flex shrink-0 items-baseline gap-0.5 rounded-full border border-[#f0c4c8] bg-[#fff5f5] px-2 py-1 font-mono text-[9px] font-bold leading-none text-[#c96d76] whitespace-nowrap">
                  {formatThreshold(intensityMinutes)}
                  <span className="font-sans text-[8px] font-semibold">/ day</span>
                </span>
              </div>

              {/* Presets */}
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {presets.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handleIntensityChange(p.value)}
                    data-active={intensityMinutes === p.value ? 'true' : 'false'}
                    className={`py-1.5 rounded-lg text-[10px] font-mono border transition ${
                      intensityMinutes === p.value
                        ? 'bg-[#ee8d92] text-white border-[#ee8d92] font-bold shadow-xs'
                        : 'border-line bg-paper text-muted-ink hover:border-[#ee8d92]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Slider */}
              <input
                type="range"
                min={15}
                max={360}
                step={15}
                value={intensityMinutes}
                onChange={(e) => handleIntensityChange(Number(e.target.value))}
                className="w-full h-1.5 bg-line rounded-lg appearance-none cursor-pointer accent-[#ee8d92]"
              />

              {/* 5-step Preview bar */}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-full h-3 rounded-md bg-emerald-500/20 border border-emerald-500/30" />
                  <span className="text-[8px] font-mono text-muted-ink">&gt;0m</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-full h-3 rounded-md bg-emerald-500/40 border border-emerald-500/50" />
                  <span className="text-[8px] font-mono text-muted-ink">&ge;{Math.round(intensityMinutes * 0.2)}m</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-full h-3 rounded-md bg-sky-500/45 border border-sky-500/60" />
                  <span className="text-[8px] font-mono text-muted-ink">&ge;{Math.round(intensityMinutes * 0.4)}m</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-full h-3 rounded-md bg-indigo-500/60 border border-indigo-500/80" />
                  <span className="text-[8px] font-mono text-muted-ink">&ge;{Math.round(intensityMinutes * 0.6)}m</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-full h-3 rounded-md border border-[#1e40af] bg-[#1d4ed8] shadow-xs" />
                  <span className="text-[8px] font-mono font-bold text-ink">&ge;{intensityMinutes >= 60 ? `${(intensityMinutes/60).toFixed(1).replace('.0','')}h` : `${intensityMinutes}m`}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: LINE BOT (ORIGINAL FULL DESIGN) */}
        {activeTab === 'line' && (
          <div className="space-y-4 pt-1">
            {!user ? (
              <div className="text-center py-6">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#fff0e8] text-[#a2605a]">
                  <AlertCircle className="size-6" />
                </div>
                <h4 className="font-display text-base font-bold text-ink mb-1">
                  กรุณาเข้าสู่ระบบก่อน
                </h4>
                <p className="text-xs text-muted-ink mb-5 leading-relaxed">
                  การเชื่อมต่อ LINE จำเป็นต้องมีบัญชีเพื่อผูกรายการ To-Do และส่งแจ้งเตือนรายบุคคล
                </p>
                {onOpenAuth && (
                  <button
                    onClick={() => {
                      onClose()
                      onOpenAuth()
                    }}
                    className="main-button w-full justify-center text-xs py-2.5"
                  >
                    เข้าสู่ระบบ / สร้างบัญชี
                  </button>
                )}
              </div>
            ) : isConnected ? (
              /* State: Connected */
              <div className="space-y-4 pt-1">
                <div className="rounded-2xl border border-[#b9e6d3] bg-[#e5f4e9]/80 p-4 text-left">
                  <div className="flex items-center gap-2.5 text-sm text-[#447e68] font-bold">
                    <CheckCircle2 className="size-5 shrink-0" />
                    <span>เชื่อมต่อ LINE สำเร็จแล้ว!</span>
                  </div>
                  <p className="text-xs text-muted-ink mt-1.5 leading-relaxed">
                    บัญชีของคุณผูกกับ LINE Bot เรียบร้อยแล้ว ตอนนี้คุณสามารถสั่งงานผ่าน LINE และรับแจ้งเตือนได้ทันที
                  </p>
                </div>

                {/* Quick guide */}
                <div className="rounded-2xl border border-line bg-paper/60 p-4 text-left space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-ink">
                    <BookOpen className="size-4 text-[#06C755]" />
                    <span>วิธีสั่งงานผ่าน LINE:</span>
                  </div>
                  <div className="text-[11px] space-y-1.5 font-mono text-ink/80">
                    <div className="p-2 rounded-lg bg-black/5">
                      <p className="font-bold text-ink">✍️ จดงาน To-Do:</p>
                      <p className="text-muted-ink">/todo อ่านชีวะ [Bio] พรุ่งนี้ !3</p>
                    </div>
                    <div className="p-2 rounded-lg bg-black/5">
                      <p className="font-bold text-ink">📅 จดวันสำคัญ (Important Date):</p>
                      <p className="text-muted-ink">/event สอบกลางภาค [exam] 2026-09-15</p>
                    </div>
                    <div className="p-2 rounded-lg bg-black/5">
                      <p className="font-bold text-ink">📋 ดูงาน & วันสำคัญ:</p>
                      <p className="text-muted-ink">/list หรือ /events</p>
                    </div>
                    <div className="p-2 rounded-lg bg-black/5">
                      <p className="font-bold text-ink">✅ ติ๊กงานเสร็จ:</p>
                      <p className="text-muted-ink">/done ชื่องาน</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <a
                    href={LINE_ADD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-[#06C755] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#05a947] transition shadow-xs"
                  >
                    <MessageCircle className="size-4" />
                    เปิดห้องแชท LINE
                    <ExternalLink className="size-3" />
                  </a>
                  <button
                    onClick={handleUnlink}
                    disabled={loading}
                    className="flex items-center justify-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2.5 text-xs font-semibold text-[#a2605a] hover:bg-[#fff0e8] transition"
                  >
                    <Unlink className="size-3.5" />
                    ยกเลิกผูก
                  </button>
                </div>
              </div>
            ) : (
              /* State: Not Connected */
              <div className="space-y-4 pt-1">
                <p className="text-xs text-muted-ink leading-relaxed">
                  เชื่อมต่อบัญชีใน 2 ขั้นตอนง่ายๆ เพื่อสั่งจดงาน To-Do และรับการแจ้งเตือนส่วนตัวผ่านแอป LINE
                </p>

                {error && (
                  <div className="rounded-xl border border-[#efb5ae] bg-[#fff0e8] p-3 text-xs text-[#a2605a]">
                    {error}
                  </div>
                )}

                {/* Step 1: Add Friend */}
                <div className="rounded-xl border border-dashed border-line bg-paper/60 p-3 text-left">
                  <p className="text-[11px] font-bold text-ink mb-1">
                    ขั้นตอนที่ 1: แอด LINE Bot เป็นเพื่อน
                  </p>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="font-mono text-xs font-semibold bg-black/5 px-2.5 py-1 rounded-md text-ink">
                      {LINE_BOT_ID}
                    </span>
                    <a
                      href={LINE_ADD_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#06C755] hover:underline"
                    >
                      กดเพิ่มเพื่อน <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>

                {/* Step 2: Code pairing */}
                <div className="rounded-xl border border-dashed border-line bg-paper/60 p-3 text-left">
                  <p className="text-[11px] font-bold text-ink mb-2">
                    ขั้นตอนที่ 2: ขอรหัสเชื่อมต่อ แล้วพิมพ์ส่งในแชท LINE
                  </p>

                  {linkCode ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 bg-[#f4f7f4] border border-[#c9e5d2] p-3 rounded-xl">
                        <div className="font-mono text-lg font-bold tracking-wider text-[#447e68]">
                          {linkCode}
                        </div>
                        <button
                          onClick={handleCopyCode}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-paper border border-line text-ink hover:bg-black/5 transition"
                        >
                          {copied ? (
                            <>
                              <Check className="size-3.5 text-[#447e68]" />
                              <span>คัดลอกแล้ว</span>
                            </>
                          ) : (
                            <>
                              <Copy className="size-3.5" />
                              <span>คัดลอก</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-ink">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" /> รหัสมีอายุ 15 นาที
                        </span>
                        <button
                          onClick={checkLineStatus}
                          className="text-ink font-semibold hover:underline inline-flex items-center gap-1"
                        >
                          <RefreshCw className="size-3" /> เช็คสถานะ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerateCode}
                      disabled={loading}
                      className="main-button w-full justify-center text-xs py-2"
                    >
                      <Sparkles className="size-3.5" />
                      {loading ? 'กำลังสร้างรหัส...' : 'กดรับรหัสเชื่อมต่อ LINE'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: ACCOUNT (ORIGINAL FULL DESIGN) */}
        {activeTab === 'account' && (
          <div className="text-center pt-2">
            {user ? (
              <div>
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
                    Your focus sessions, tasks, and calendar events are securely synced.
                  </p>
                </div>

                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-xs font-semibold text-[#a2605a] hover:bg-[#fff0e8] transition"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="py-4">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#fff0e8] text-[#a2605a]">
                  <UserIcon className="size-6" />
                </div>
                <h4 className="font-display text-base font-bold text-ink mb-1">
                  ยังไม่ได้เข้าสู่ระบบ
                </h4>
                <p className="text-xs text-muted-ink mb-5 leading-relaxed">
                  เข้าสู่ระบบเพื่อซิงค์ข้อมูล To-Do, สถิติ และเชื่อมต่อ LINE Bot ข้ามอุปกรณ์
                </p>
                {onOpenAuth && (
                  <button
                    onClick={() => {
                      onClose()
                      onOpenAuth()
                    }}
                    className="main-button w-full justify-center text-xs py-2.5"
                  >
                    เข้าสู่ระบบ / สร้างบัญชี
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
