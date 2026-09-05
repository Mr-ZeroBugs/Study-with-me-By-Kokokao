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
  Brain,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Pencil,
  Trash2,
  Save,
} from 'lucide-react'
import {
  getStoredTheme,
  setAppTheme,
  getIntensityThreshold,
  setIntensityThreshold,
  AppTheme,
} from '@/lib/theme'
import { supabase } from '@/lib/supabase'
import {
  loadPersonalMemory,
  proposePersonalMemory,
  reviewPersonalMemory,
  savePersonalMemorySettings,
  updatePersonalMemory,
  deletePersonalMemory,
} from '@/lib/personal-memory-client'
import type { PersonalMemoryItem, PersonalMemorySnapshot } from '@/lib/personal-memory'
import type { User } from '@supabase/supabase-js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  user?: User | null
  onOpenAuth?: () => void
}

function memoryTypeLabel(type: PersonalMemoryItem['memoryType']) {
  if (type === 'observed') return 'observed pattern'
  if (type === 'temporary') return 'temporary note'
  return 'your note'
}

function expiryLabel(expiresAt?: string) {
  if (!expiresAt) return null
  const value = new Date(expiresAt)
  if (Number.isNaN(value.getTime())) return null
  return `expires ${value.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

export function SettingsModal({ isOpen, onClose, user, onOpenAuth }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'theme' | 'line' | 'memory' | 'account'>('theme')
  const [currentTheme, setCurrentTheme] = useState<AppTheme>('cozy')
  const [intensityMinutes, setIntensityMinutes] = useState(90)

  // LINE Connection state
  const [isConnected, setIsConnected] = useState(false)
  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memory, setMemory] = useState<PersonalMemorySnapshot | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryContent, setEditingMemoryContent] = useState('')
  const [editingMemoryKind, setEditingMemoryKind] = useState<'preference' | 'learning'>('preference')
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [newMemoryKind, setNewMemoryKind] = useState<'preference' | 'learning'>('preference')
  const [newMemoryType, setNewMemoryType] = useState<'explicit' | 'temporary'>('explicit')
  const [newMemoryExpiry, setNewMemoryExpiry] = useState('')

  const LINE_BOT_ID = '@277sabim'
  const LINE_ADD_URL = 'https://line.me/R/ti/p/@277sabim'

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setCurrentTheme(getStoredTheme())
      setIntensityMinutes(getIntensityThreshold())
      if (user) {
        checkLineStatus()
        void refreshMemory()
      }
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  // Opening the modal or switching accounts is the refresh boundary. The
  // local async function identities must not turn this into a render loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const refreshMemory = async () => {
    if (!user) return
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      setMemory(await loadPersonalMemory())
    } catch (err: any) {
      setMemoryError(err.message || 'Could not load personal memory.')
    } finally {
      setMemoryLoading(false)
    }
  }

  const handleMemorySetting = async (nextEnabled: boolean, nextApproval: boolean) => {
    if (!memory) return
    const previous = memory
    setMemory({ ...memory, settings: { enabled: nextEnabled, writeApprovalRequired: nextApproval } })
    try {
      await savePersonalMemorySettings(nextEnabled, nextApproval)
    } catch (err: any) {
      setMemory(previous)
      setMemoryError(err.message || 'Could not update memory settings.')
    }
  }

  const handleMemoryReview = async (id: string, decision: 'approve' | 'reject') => {
    if (!memory) return
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      await reviewPersonalMemory(id, decision)
      await refreshMemory()
    } catch (err: any) {
      setMemoryError(err.message || 'Could not review this memory.')
      setMemoryLoading(false)
    }
  }

  const startEditingMemory = (item: NonNullable<PersonalMemorySnapshot['active']>[number]) => {
    setEditingMemoryId(item.id)
    setEditingMemoryContent(item.content)
    setEditingMemoryKind(item.kind)
    setMemoryError(null)
  }

  const saveEditedMemory = async () => {
    if (!editingMemoryId) return
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      await updatePersonalMemory(editingMemoryId, editingMemoryKind, editingMemoryContent)
      setEditingMemoryId(null)
      await refreshMemory()
    } catch (err: any) {
      setMemoryError(err.message || 'Could not update this memory.')
      setMemoryLoading(false)
    }
  }

  const removeMemory = async (id: string) => {
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      await deletePersonalMemory(id)
      if (editingMemoryId === id) setEditingMemoryId(null)
      await refreshMemory()
    } catch (err: any) {
      setMemoryError(err.message || 'Could not delete this memory.')
      setMemoryLoading(false)
    }
  }

  const addPersonalMemory = async () => {
    const content = newMemoryContent.trim()
    if (!content) return
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      const expiresAt = newMemoryType === 'temporary' && newMemoryExpiry
        ? new Date(`${newMemoryExpiry}T23:59:59`).toISOString()
        : undefined
      await proposePersonalMemory(newMemoryKind, content, { memoryType: newMemoryType, expiresAt })
      setNewMemoryContent('')
      setNewMemoryExpiry('')
      setNewMemoryType('explicit')
      await refreshMemory()
    } catch (err: any) {
      setMemoryError(err.message || 'Could not save this memory.')
      setMemoryLoading(false)
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
      className="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-modal-box" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <header className="settings-modal-header">
          <div className="settings-modal-title-row">
            <div className="settings-modal-star" aria-hidden="true"><Sparkles className="size-5" /></div>
            <div>
              <p className="eyebrow">workspace preferences</p>
              <h2 id="settings-modal-title" className="settings-modal-h2">Settings</h2>
              <p className="settings-modal-subtitle">Make your study space feel like yours.</p>
            </div>
          </div>
          <button onClick={onClose} className="settings-close-btn" aria-label="Close modal"><X className="size-4" /></button>
        </header>

        {/* Tab Switcher */}
        <nav className="settings-tab-bar" aria-label="Settings sections">
          {[
            { id: 'theme', label: 'Theme', icon: Palette },
            { id: 'line', label: 'LINE Bot', icon: MessageCircle },
            { id: 'memory', label: 'Memory', icon: Brain },
            { id: 'account', label: 'Account', icon: UserIcon },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`settings-tab-btn ${activeTab === id ? 'settings-tab-btn--active' : ''}`}
              aria-current={activeTab === id ? 'page' : undefined}
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
              {id === 'line' && isConnected && <span className="settings-online-dot" aria-label="Connected" />}
            </button>
          ))}
        </nav>

        <div className="settings-modal-body">
        {/* Tab 1: THEME & INTENSITY */}
        {activeTab === 'theme' && (
          <div className="settings-section">
            {/* Theme Grid */}
            <div className="settings-section-gap">
              <div className="settings-section-heading"><div><p className="settings-section-kicker">appearance</p><h3>Choose your atmosphere</h3></div><Palette className="size-4" /></div>
              <div className="settings-theme-grid">
                {[
                  { id: 'cozy', label: 'Cozy Paper', description: 'Warm, soft, and familiar', icon: Feather },
                  { id: 'light', label: 'Light Glass', description: 'Clean and airy', icon: Sun },
                  { id: 'dark-glass', label: 'Dark Glass', description: 'Quiet focus after dark', icon: Moon },
                ].map(({ id, label, description, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => handleThemeChange(id as AppTheme)}
                    data-active={currentTheme === id ? 'true' : 'false'}
                    className={`settings-theme-card ${currentTheme === id ? `settings-theme-card--active settings-theme-card--active-${id === 'cozy' ? 'cozy' : id === 'light' ? 'light' : 'dark'}` : ''}`}
                    aria-pressed={currentTheme === id}
                  >
                    <span className={`settings-theme-icon settings-theme-icon--${id === 'dark-glass' ? 'dark' : id}`}><Icon className="size-4.5" /></span>
                    <span className="settings-theme-name-row"><strong className={`settings-theme-name ${id === 'dark-glass' ? 'settings-theme-name--dark' : ''}`}>{label}</strong>{currentTheme === id && <span className={`settings-theme-check settings-theme-check--${id === 'dark-glass' ? 'dark' : id === 'light' ? 'light' : 'cozy'}`}><Check className="size-3" /></span>}</span>
                    <span className={`settings-theme-desc ${id === 'dark-glass' ? 'settings-theme-desc--dark' : ''}`}>{description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Intensity Setting */}
            <div className="settings-intensity-box">
              <div className="settings-intensity-header">
                <div><strong>Deep Focus</strong><p className="settings-intensity-desc">Set the daily minutes needed for your darkest calendar shade.</p></div>
                <span className="settings-intensity-val">{formatThreshold(intensityMinutes)} / day</span>
              </div>

              <div className="settings-intensity-presets">
                {presets.map((p) => <button key={p.value} onClick={() => handleIntensityChange(p.value)} data-active={intensityMinutes === p.value ? 'true' : 'false'} className={`settings-intensity-preset-btn ${intensityMinutes === p.value ? 'settings-intensity-preset-btn--active' : ''}`}>{p.label}</button>)}
              </div>

              <input type="range" min={15} max={360} step={15} value={intensityMinutes} onChange={(e) => handleIntensityChange(Number(e.target.value))} className="settings-intensity-slider" aria-label="Deep Focus threshold" />

              <div className="settings-intensity-preview-grid" aria-label="Calendar intensity preview">
                <div className="settings-intensity-preview-item"><div className="settings-intensity-preview-swatch bg-emerald-500/20 border-emerald-500/30" /><span className="settings-intensity-preview-label">&gt;0m</span></div>
                <div className="settings-intensity-preview-item"><div className="settings-intensity-preview-swatch bg-emerald-500/40 border-emerald-500/50" /><span className="settings-intensity-preview-label">&ge;{Math.round(intensityMinutes * 0.2)}m</span></div>
                <div className="settings-intensity-preview-item"><div className="settings-intensity-preview-swatch bg-sky-500/45 border-sky-500/60" /><span className="settings-intensity-preview-label">&ge;{Math.round(intensityMinutes * 0.4)}m</span></div>
                <div className="settings-intensity-preview-item"><div className="settings-intensity-preview-swatch bg-indigo-500/60 border-indigo-500/80" /><span className="settings-intensity-preview-label">&ge;{Math.round(intensityMinutes * 0.6)}m</span></div>
                <div className="settings-intensity-preview-item"><div className="settings-intensity-preview-swatch settings-intensity-preview-swatch--deep" /><span className="settings-intensity-preview-label">&ge;{intensityMinutes >= 60 ? `${(intensityMinutes / 60).toFixed(1).replace('.0', '')}h` : `${intensityMinutes}m`}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: LINE BOT */}
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

        {/* Tab 3: PERSONAL MEMORY */}
        {activeTab === 'memory' && (
          <div className="space-y-4 pt-1">
            {!user ? (
              <div className="py-5 text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[#fff0e8] text-[#a2605a]"><Brain className="size-6" /></div>
                <h4 className="font-display text-base font-bold text-ink mb-1">Memory belongs to you</h4>
                <p className="text-xs text-muted-ink mb-5 leading-relaxed">Sign in to keep a small, private set of study preferences and learning patterns.</p>
                {onOpenAuth && <button onClick={() => { onClose(); onOpenAuth() }} className="main-button w-full justify-center text-xs py-2.5">Sign in to use memory</button>}
              </div>
            ) : memoryLoading && !memory ? (
              <div className="py-10 text-center text-xs text-muted-ink">Loading your private memory…</div>
            ) : memoryError && !memory ? (
              <div className="rounded-2xl border border-[#efb5ae] bg-[#fff0e8] p-4 text-left">
                <p className="text-xs font-semibold text-[#a2605a]">Personal memory isn&apos;t available yet.</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-ink">{memoryError}</p>
                <button onClick={refreshMemory} className="mt-3 text-xs font-semibold text-ink underline">Try again</button>
              </div>
            ) : memory ? (
              <>
                <div className="rounded-2xl border border-line bg-paper/60 p-4 text-left">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e5f4e9] text-[#447e68]"><ShieldCheck className="size-4.5" /></div>
                    <div>
                      <p className="text-sm font-bold text-ink">Personal, not shared</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-ink">Koko only uses compact notes you approve—such as preferred study style or a useful learning pattern. Team Spaces and raw task text are never added here.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-paper/60 p-4 text-left space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div><p className="text-xs font-bold text-ink">Use personal memory</p><p className="mt-0.5 text-[11px] text-muted-ink">Let Koko use approved notes in private help.</p></div>
                    <button type="button" role="switch" aria-checked={memory.settings.enabled} onClick={() => handleMemorySetting(!memory.settings.enabled, memory.settings.writeApprovalRequired)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${memory.settings.enabled ? 'bg-[#5c9774]' : 'bg-black/15'}`}><span className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition ${memory.settings.enabled ? 'left-6' : 'left-1'}`} /></button>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-line/70 pt-4">
                    <div><p className="text-xs font-bold text-ink">Ask before saving</p><p className="mt-0.5 text-[11px] text-muted-ink">New AI notes wait for your approval.</p></div>
                    <button type="button" role="switch" aria-checked={memory.settings.writeApprovalRequired} onClick={() => handleMemorySetting(memory.settings.enabled, !memory.settings.writeApprovalRequired)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${memory.settings.writeApprovalRequired ? 'bg-[#5c9774]' : 'bg-black/15'}`}><span className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition ${memory.settings.writeApprovalRequired ? 'left-6' : 'left-1'}`} /></button>
                  </div>
                </div>

                <section className="rounded-2xl border border-line bg-paper/60 p-4 text-left">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div><p className="text-xs font-bold text-ink">Add a note you want Koko to remember</p><p className="mt-0.5 text-[11px] leading-relaxed text-muted-ink">Keep it useful for studying. You stay in control of every note.</p></div>
                    <Brain className="mt-0.5 size-4 shrink-0 text-[#447e68]" />
                  </div>
                  <textarea value={newMemoryContent} onChange={(event) => setNewMemoryContent(event.target.value)} maxLength={360} placeholder="e.g. I prefer a short first step when a task feels heavy." className="min-h-[72px] w-full resize-y rounded-xl border border-line bg-paper p-2.5 text-xs text-ink outline-none placeholder:text-muted-ink/70" />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select value={newMemoryKind} onChange={(event) => setNewMemoryKind(event.target.value as 'preference' | 'learning')} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[10px] text-ink"><option value="preference">preference</option><option value="learning">learning</option></select>
                    <select value={newMemoryType} onChange={(event) => setNewMemoryType(event.target.value as 'explicit' | 'temporary')} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[10px] text-ink"><option value="explicit">keep until I remove it</option><option value="temporary">temporary</option></select>
                    {newMemoryType === 'temporary' && <input type="date" value={newMemoryExpiry} onChange={(event) => setNewMemoryExpiry(event.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[10px] text-ink" />}
                    <button disabled={memoryLoading || !newMemoryContent.trim() || (newMemoryType === 'temporary' && !newMemoryExpiry)} onClick={addPersonalMemory} className="inline-flex items-center gap-1 rounded-lg bg-[#5c9774] px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Save className="size-3" />Save note</button>
                  </div>
                </section>

                <p className="rounded-xl border border-dashed border-line bg-paper/35 px-3 py-2.5 text-[10px] leading-relaxed text-muted-ink">Observed patterns always show their evidence and ask first. Koko does not store sensitive health, identity, password, or private credential details as memory.</p>

                <section className="text-left">
                  <div className="mb-2 flex items-center justify-between"><p className="eyebrow">waiting for you</p><span className="text-[11px] text-muted-ink">{memory.proposed.length} proposal{memory.proposed.length === 1 ? '' : 's'}</span></div>
                  {memory.proposed.length ? <div className="space-y-2">{memory.proposed.map((item) => <div key={item.id} className="rounded-xl border border-dashed border-line bg-paper/60 p-3"><p className="text-xs leading-relaxed text-ink">{item.content}</p><p className="mt-1.5 text-[10px] leading-relaxed text-muted-ink"><span className="font-semibold text-ink/75">{memoryTypeLabel(item.memoryType)}</span>{item.evidence ? ` · ${item.evidence}` : ''}{expiryLabel(item.expiresAt) ? ` · ${expiryLabel(item.expiresAt)}` : ''}</p><div className="mt-3 flex gap-2"><button disabled={memoryLoading} onClick={() => handleMemoryReview(item.id, 'approve')} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#5c9774] px-2 py-2 text-[11px] font-semibold text-white"><CheckCircle className="size-3.5" />Approve</button><button disabled={memoryLoading} onClick={() => handleMemoryReview(item.id, 'reject')} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-line bg-paper px-2 py-2 text-[11px] font-semibold text-muted-ink"><XCircle className="size-3.5" />Not now</button></div></div>)}</div> : <div className="rounded-xl border border-dashed border-line bg-paper/40 px-3 py-4 text-center text-[11px] text-muted-ink">Nothing waiting for approval.</div>}
                </section>

                <section className="text-left">
                  <div className="mb-2 flex items-center justify-between"><p className="eyebrow">approved memory</p><span className="text-[11px] text-muted-ink">{memory.active.length} saved</span></div>
                  {memory.active.length ? <div className="space-y-2">{memory.active.map((item) => <div key={item.id} className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">{editingMemoryId === item.id ? <><textarea value={editingMemoryContent} onChange={(event) => setEditingMemoryContent(event.target.value)} maxLength={360} className="min-h-[72px] w-full resize-y rounded-lg border border-line bg-paper p-2 text-xs text-ink outline-none" /><div className="mt-2 flex items-center gap-2"><select value={editingMemoryKind} onChange={(event) => setEditingMemoryKind(event.target.value as 'preference' | 'learning')} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[10px] text-ink"><option value="preference">preference</option><option value="learning">learning</option></select><button disabled={memoryLoading || !editingMemoryContent.trim()} onClick={saveEditedMemory} className="inline-flex items-center gap-1 rounded-lg bg-[#5c9774] px-2 py-1.5 text-[10px] font-semibold text-white"><Save className="size-3" />Save</button><button disabled={memoryLoading} onClick={() => setEditingMemoryId(null)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-muted-ink">Cancel</button></div></> : <><div className="flex items-start gap-2"><p className="flex-1 text-xs leading-relaxed text-ink">{item.content}</p><button aria-label="Edit memory" disabled={memoryLoading} onClick={() => startEditingMemory(item)} className="rounded-md p-1 text-muted-ink hover:bg-ink/5 hover:text-ink"><Pencil className="size-3.5" /></button><button aria-label="Delete memory" disabled={memoryLoading} onClick={() => removeMemory(item.id)} className="rounded-md p-1 text-muted-ink hover:bg-[#fff0e8] hover:text-[#a2605a]"><Trash2 className="size-3.5" /></button></div><p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-ink">{item.kind} · {memoryTypeLabel(item.memoryType)}{expiryLabel(item.expiresAt) ? ` · ${expiryLabel(item.expiresAt)}` : ''}</p></>}</div>)}</div> : <div className="rounded-xl border border-dashed border-line bg-paper/40 px-3 py-4 text-center text-[11px] text-muted-ink">No approved notes yet.</div>}
                </section>
              </>
            ) : null}
          </div>
        )}

        {/* Tab 4: ACCOUNT */}
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

        <footer className="settings-modal-footer">
          <span>Changes save automatically</span>
          <button type="button" className="settings-close-footer-btn" onClick={onClose}>done</button>
        </footer>
      </div>
    </div>
  )
}
