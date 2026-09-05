'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import {
  X,
  MessageCircle,
  Copy,
  Check,
  RefreshCw,
  Unlink,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  BookOpen,
} from 'lucide-react'

interface LineConnectModalProps {
  isOpen: boolean
  onClose: () => void
  user: User | null
  onOpenAuth: () => void
  onConnectionChange?: () => void
}

export function LineConnectModal({ isOpen, onClose, user, onOpenAuth, onConnectionChange }: LineConnectModalProps) {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const LINE_BOT_ID = '@277sabim'
  const LINE_ADD_URL = 'https://line.me/R/ti/p/@277sabim'

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock scroll
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

  // Fetch connection status whenever modal opens
  useEffect(() => {
    if (isOpen && user) {
      checkStatus()
    }
  // Status is intentionally refreshed on modal/user changes. Including the
  // local async function identity would trigger a request on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user])

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  const checkStatus = async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) return

      const res = await fetch('/api/line/connect', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        setIsConnected(data.isConnected)
        onConnectionChange?.()
        if (data.activeCode) {
          setLinkCode(data.activeCode)
        }
      }
    } catch (err: any) {
      console.error('Failed to check LINE status:', err)
    } finally {
      setLoading(false)
    }
  }

  const generateLinkCode = async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/line/connect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate code')

      setLinkCode(data.linkCode)
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
      if (!token) return

      const res = await fetch('/api/line/connect', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setIsConnected(false)
        setLinkCode(null)
        onConnectionChange?.()
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

  if (!isOpen || !mounted) return null

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
      className="flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="paper-card relative w-full max-w-md overflow-hidden p-6 sm:p-7 shadow-2xl animate-fade-in my-auto max-h-[90vh] overflow-y-auto">
        <div className="tape tape-yellow" />
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-ink hover:bg-black/5 transition"
          aria-label="Close modal"
        >
          <X className="size-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[#06C755] text-white shadow-sm">
            <MessageCircle className="size-5" />
          </div>
          <div>
            <p className="eyebrow">LINE Integration</p>
            <h3 className="font-display text-lg font-bold text-ink">
              เชื่อมต่อ LINE สั่งจด & แจ้งเตือน To-Do
            </h3>
          </div>
        </div>

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
            <button
              onClick={() => {
                onClose()
                onOpenAuth()
              }}
              className="main-button w-full justify-center text-xs py-2.5"
            >
              เข้าสู่ระบบ / สร้างบัญชี
            </button>
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
                  <p className="text-muted-ink">/list (ดู To-Do) หรือ /events (ดูวันสำคัญ)</p>
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
          /* State: Not Connected -> Generate code */
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
                      onClick={checkStatus}
                      className="text-ink font-semibold hover:underline inline-flex items-center gap-1"
                    >
                      <RefreshCw className="size-3" /> เช็คสถานะ
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={generateLinkCode}
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
    </div>
  )

  return createPortal(modalContent, document.body)
}
