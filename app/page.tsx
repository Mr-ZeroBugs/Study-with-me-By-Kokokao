'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Flower2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TimerReset,
  Volume2,
  VolumeX,
  User as UserIcon,
  CloudCheck,
  CloudOff,
} from 'lucide-react'
import confetti from 'canvas-confetti'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { soundEngine } from '../lib/audio'
import {
  loadStudyLogs,
  recordFocusSession,
  getLocalDateKey,
  calculateStreak,
  getLocalRounds,
  saveLocalRounds,
  type DayLog,
} from '../lib/storage'
import { AuthModal } from '../components/auth-modal'

const modes = {
  focus: { label: 'Focus time', minutes: 25, color: 'mint' },
  short: { label: 'Short break', minutes: 5, color: 'peach' },
  long: { label: 'Long break', minutes: 15, color: 'lilac' },
} as const

type Mode = keyof typeof modes
type TimerMode = 'flow' | 'countdown'
type Extension = 'pomodoro' | 'rule5217' | null

const tips = [
  { title: 'tiny start', text: 'วางโทรศัพท์คว่ำไว้ แล้วเปิดหนังสือแค่หน้าเดียวก่อนนะ' },
  { title: 'soft focus', text: 'ลองตั้งเป้าหมายเล็ก ๆ ให้จบในรอบนี้ ไม่ต้องสมบูรณ์แบบ' },
  { title: 'water check', text: 'จิบน้ำหนึ่งอึก แล้วกลับมาอ่านต่อแบบใจเย็น ๆ' },
  { title: 'gentle breathe', text: 'หายใจเข้าลึก ๆ 4 วินาที กลั้นไว้ 4 วินาที แล้วปล่อยออกช้า ๆ' },
  { title: 'celebrate wins', text: 'อ่านจบ 1 รอบก็เก่งมากแล้ว ให้รางวัลตัวเองด้วยการยืดเส้นยืดสายนะ' },
]

function calendarParts(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
}

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0')
  const seconds = (safeSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function triggerCozyConfetti() {
  confetti({
    particleCount: 45,
    spread: 60,
    origin: { y: 0.7 },
    colors: ['#ee8d92', '#f9de83', '#b9e6d3', '#f3b7bd', '#c19bcf'],
    disableForReducedMotion: true,
  })
}

export default function Page() {
  // Timer States
  const [timerMode, setTimerMode] = useState<TimerMode>('flow')
  const [extension, setExtension] = useState<Extension>(null)
  const [mode, setMode] = useState<Mode>('focus')
  const [seconds, setSeconds] = useState(25 * 60)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [reminderMinutes, setReminderMinutes] = useState(25)
  const [reminderSeconds, setReminderSeconds] = useState(25 * 60)
  const [reminderReached, setReminderReached] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)

  // User & Data States
  const [user, setUser] = useState<User | null>(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [sessions, setSessions] = useState(0)
  const [logs, setLogs] = useState<DayLog>({})
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [tipIndex, setTipIndex] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [todayKey, setTodayKey] = useState('')
  const [todayLabel, setTodayLabel] = useState('today')

  // Refs for accurate timestamp-based timer (No tab-switch drift)
  const timerStartRef = useRef<number | null>(null)
  const baseSecondsRef = useRef<number>(25 * 60)
  const baseElapsedRef = useRef<number>(0)
  const baseReminderRef = useRef<number>(25 * 60)
  const lastMinuteSyncRef = useRef<number>(0)

  // 1. Initialize User, Today info, and Load Data
  useEffect(() => {
    const now = new Date()
    const key = getLocalDateKey(now)
    setTodayKey(key)
    setTodayLabel(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
    setSessions(getLocalRounds(key))
    setMounted(true)

    // Load initial logs
    loadStudyLogs(null).then((initialLogs) => {
      setLogs(initialLogs)
    })

    // Listen to Supabase Auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      const userLogs = await loadStudyLogs(currentUser)
      setLogs(userLogs)
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  // 2. Complete Focus Session Handler
  const handleFocusCompleted = useCallback(
    async (durationMins: number) => {
      if (soundEnabled) {
        soundEngine.playFocusComplete()
      }
      triggerCozyConfetti()

      const newSessions = sessions + 1
      setSessions(newSessions)
      if (todayKey) {
        saveLocalRounds(todayKey, newSessions)
      }

      const { updatedLogs } = await recordFocusSession(user, durationMins, mode, timerMode)
      setLogs(updatedLogs)
    },
    [soundEnabled, sessions, todayKey, user, mode, timerMode]
  )

  // 3. Accurate Timestamp-based Timer Engine
  useEffect(() => {
    if (!running) {
      timerStartRef.current = null
      return
    }

    // Set start timestamp
    const now = Date.now()
    timerStartRef.current = now
    baseSecondsRef.current = seconds
    baseElapsedRef.current = elapsedSeconds
    baseReminderRef.current = reminderSeconds
    lastMinuteSyncRef.current = elapsedSeconds

    const interval = window.setInterval(() => {
      if (!timerStartRef.current) return
      const elapsedWallClock = Math.floor((Date.now() - timerStartRef.current) / 1000)

      if (timerMode === 'flow') {
        const currentElapsed = baseElapsedRef.current + elapsedWallClock
        setElapsedSeconds(currentElapsed)

        // Check if a full minute passed during flow study to increment stats
        if (currentElapsed > 0 && Math.floor(currentElapsed / 60) > Math.floor(lastMinuteSyncRef.current / 60)) {
          lastMinuteSyncRef.current = currentElapsed
          const today = getLocalDateKey(new Date())
          setLogs((prev) => ({
            ...prev,
            [today]: (prev[today] ?? 0) + 1,
          }))
          // Background sync
          if (user) {
            recordFocusSession(user, 1, 'flow', 'flow')
          }
        }

        // Extension reminder countdown
        if (extension) {
          const currentReminder = baseReminderRef.current - (elapsedWallClock % (reminderMinutes * 60))
          if (currentReminder <= 0) {
            setReminderReached(true)
            if (soundEnabled) soundEngine.playFocusComplete()
            baseReminderRef.current = reminderMinutes * 60
            setReminderSeconds(reminderMinutes * 60)
          } else {
            setReminderSeconds(currentReminder)
          }
        }
      } else {
        // Countdown mode
        const remaining = baseSecondsRef.current - elapsedWallClock
        if (remaining <= 0) {
          setRunning(false)
          setSeconds(modes[mode].minutes * 60)
          if (mode === 'focus') {
            handleFocusCompleted(modes.focus.minutes)
          } else {
            if (soundEnabled) soundEngine.playBreakComplete()
          }
        } else {
          setSeconds(remaining)
        }
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [running, timerMode, mode, extension, reminderMinutes, soundEnabled, handleFocusCompleted, user])

  // Timer Controls
  const togglePlay = () => {
    if (soundEnabled) soundEngine.playSoftClick()
    setRunning(!running)
  }

  const selectMode = (nextMode: Mode) => {
    if (soundEnabled) soundEngine.playSoftClick()
    setMode(nextMode)
    setSeconds(modes[nextMode].minutes * 60)
    baseSecondsRef.current = modes[nextMode].minutes * 60
    setRunning(false)
  }

  const selectTimerMode = (nextMode: TimerMode) => {
    if (soundEnabled) soundEngine.playSoftClick()
    setTimerMode(nextMode)
    setRunning(false)
    setSeconds(modes[mode].minutes * 60)
    baseSecondsRef.current = modes[mode].minutes * 60
    setElapsedSeconds(0)
    baseElapsedRef.current = 0
    setReminderSeconds(reminderMinutes * 60)
    setReminderReached(false)
  }

  const selectExtension = (nextExtension: Exclude<Extension, null>) => {
    if (soundEnabled) soundEngine.playSoftClick()
    const enabled = extension === nextExtension ? null : nextExtension
    const interval = nextExtension === 'pomodoro' ? 25 : 52
    setExtension(enabled)
    setReminderMinutes(enabled ? interval : 25)
    setRunning(false)
    setReminderSeconds((enabled ? interval : 25) * 60)
    baseReminderRef.current = (enabled ? interval : 25) * 60
    setReminderReached(false)
  }

  const reset = () => {
    if (soundEnabled) soundEngine.playSoftClick()
    setSeconds(modes[mode].minutes * 60)
    baseSecondsRef.current = modes[mode].minutes * 60
    setElapsedSeconds(0)
    baseElapsedRef.current = 0
    setReminderSeconds(reminderMinutes * 60)
    baseReminderRef.current = reminderMinutes * 60
    setReminderReached(false)
    setRunning(false)
  }

  // Calculated Stats
  const todayMinutes = mounted && todayKey ? logs[todayKey] ?? 0 : 0
  const streakDays = useMemo(() => calculateStreak(logs), [logs])
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const calendar = useMemo(
    () => calendarParts(monthDate.getFullYear(), monthDate.getMonth()),
    [monthDate]
  )

  return (
    <main className="min-h-screen overflow-hidden px-4 py-5 text-ink sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-7 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="brand-sticker">
              <Flower2 className="size-5" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-ink">
                your cozy corner
              </p>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                study with me<span className="text-coral">.</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Sound Toggle */}
            <button
              onClick={() => {
                if (!soundEnabled) soundEngine.playSoftClick()
                setSoundEnabled(!soundEnabled)
              }}
              title={soundEnabled ? 'Mute sound' : 'Unmute sound'}
              className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-muted-ink hover:text-ink transition"
            >
              {soundEnabled ? <Volume2 className="size-3.5 text-[#5c9774]" /> : <VolumeX className="size-3.5 text-[#a2605a]" />}
              <span className="font-mono text-[10px] uppercase">{soundEnabled ? 'Sound on' : 'Muted'}</span>
            </button>

            {/* Cloud Sync / Auth Button */}
            <button
              onClick={() => setIsAuthOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-muted-ink hover:text-ink transition shadow-xs"
            >
              {user ? (
                <>
                  <CloudCheck className="size-3.5 text-[#5c9774]" />
                  <span className="font-mono text-[10px] text-[#5c9774] font-semibold">
                    {user.email?.split('@')[0]}
                  </span>
                </>
              ) : (
                <>
                  <CloudOff className="size-3.5 text-[#e8b73c]" />
                  <span className="font-mono text-[10px] uppercase">Guest · Sync</span>
                </>
              )}
            </button>

            <div className="date-pill">
              <CalendarDays className="size-4" /> {todayLabel}
            </div>
          </div>
        </header>

        {/* Section 1: Main Timer + Mini Widgets */}
        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.8fr]">
          <div className="paper-card timer-card relative overflow-hidden">
            <div className="tape tape-yellow" />
            <div className="tape tape-pink" />
            <div className="mb-8 flex items-start justify-between">
              <div>
                <p className="eyebrow">currently</p>
                <h2 className="font-display text-2xl font-bold">
                  {timerMode === 'flow' ? 'Open-ended focus' : modes[mode].label}
                </h2>
              </div>
              <div className="status-dot">
                <span /> {running ? 'in the zone' : 'ready when you are'}
              </div>
            </div>

            {/* Big Timer Clock */}
            <div className="timer-face">
              <div className="timer-sparkle">✦</div>
              <span>{formatTime(timerMode === 'flow' ? elapsedSeconds : seconds)}</span>
              <div className="timer-underline" />
            </div>

            {/* Mode Switcher: Flow vs Countdown */}
            <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-2 rounded-full bg-paper px-2 py-2 shadow-inner">
              <button
                onClick={() => selectTimerMode('flow')}
                className={`mode-button ${timerMode === 'flow' ? 'active' : ''}`}
              >
                count up
              </button>
              <button
                onClick={() => selectTimerMode('countdown')}
                className={`mode-button ${timerMode === 'countdown' ? 'active' : ''}`}
              >
                countdown
              </button>
            </div>

            {/* Countdown Length Selection */}
            {timerMode === 'countdown' && (
              <div className="mx-auto mt-3 flex max-w-md items-center justify-center gap-2">
                <span className="text-xs text-muted-ink">length:</span>
                {(Object.keys(modes) as Mode[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => selectMode(item)}
                    className={`mode-button ${mode === item ? 'active' : ''}`}
                  >
                    {item === 'focus' ? '25 min' : item === 'short' ? '5 min' : '15 min'}
                  </button>
                ))}
              </div>
            )}

            {/* Flow Mode Extensions */}
            <div className="mt-5 rounded-2xl border border-dashed border-line bg-paper/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="eyebrow">optional extensions</p>
                <span className="text-[10px] text-muted-ink">{extension ? 'active' : 'off'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => selectExtension('pomodoro')}
                  className={`mode-button ${extension === 'pomodoro' ? 'active' : ''}`}
                >
                  Pomodoro (25m)
                </button>
                <button
                  onClick={() => selectExtension('rule5217')}
                  className={`mode-button ${extension === 'rule5217' ? 'active' : ''}`}
                >
                  52 / 17 rule
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-ink">
                Choose an extension only when you want structured focus and break reminders.
              </p>
            </div>

            {/* Active Extension Info */}
            {timerMode === 'flow' && extension && (
              <div className="mt-4 flex flex-col items-center justify-center gap-2 text-xs text-muted-ink">
                <div className="flex items-center gap-2">
                  <span>{extension === 'pomodoro' ? 'gentle reminder every' : 'focus reminder every'}</span>
                  <select
                    aria-label="Reminder interval"
                    value={reminderMinutes}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      setReminderMinutes(value)
                      setReminderSeconds(value * 60)
                      baseReminderRef.current = value * 60
                      setReminderReached(false)
                    }}
                    className="rounded-full border border-line bg-paper px-2 py-1 font-semibold text-ink"
                  >
                    <option value={extension === 'pomodoro' ? 25 : 52}>
                      {extension === 'pomodoro' ? '25 min' : '52 min'}
                    </option>
                    <option value={extension === 'pomodoro' ? 50 : 17}>
                      {extension === 'pomodoro' ? '50 min' : '17 min'}
                    </option>
                  </select>
                </div>
                {reminderReached && (
                  <button className="tip-button" onClick={() => setReminderReached(false)}>
                    <Coffee className="size-4" /> time for a tiny break
                  </button>
                )}
              </div>
            )}

            {/* Timer Actions */}
            <div className="mt-7 flex justify-center gap-3">
              <button className="main-button" onClick={togglePlay}>
                {running ? <Pause className="size-4" /> : <Play className="size-4 fill-current" />}
                {running ? 'pause' : 'start studying'}
              </button>
              <button aria-label="Reset timer" className="icon-button" onClick={reset}>
                <RotateCcw className="size-4" />
              </button>
            </div>

            {/* Bottom Stats */}
            <div className="mt-8 flex justify-center gap-8 text-center">
              <div>
                <p className="stat-number">{sessions}</p>
                <p className="stat-label">rounds today</p>
              </div>
              <div className="stat-divider" />
              <div>
                <p className="stat-number">
                  {Math.floor(todayMinutes / 60)}h {todayMinutes % 60}m
                </p>
                <p className="stat-label">total focus</p>
              </div>
            </div>
          </div>

          {/* Mini Cards Right Column */}
          <div className="flex flex-col gap-5">
            <div className="paper-card mini-card peach-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">a little reminder</p>
                  <h2 className="font-display text-xl font-bold">you&apos;re doing lovely</h2>
                </div>
                <span className="sticker-heart">♡</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-ink">
                One focused page is still progress. Be gentle with your brain today.
              </p>
              <button
                className="tip-button"
                onClick={() => setTipIndex((tipIndex + 1) % tips.length)}
              >
                <Sparkles className="size-4" /> new tiny tip
              </button>
            </div>

            <div className="paper-card mini-card yellow-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">little streak</p>
                  <h2 className="font-display text-xl font-bold">{streakDays} days</h2>
                </div>
                <span className="sticker-sun">☼</span>
              </div>
              <div className="streak-row">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <span key={day} className={day <= Math.min(streakDays, 7) ? 'filled' : ''}>
                    {day <= Math.min(streakDays, 7) ? '✦' : '·'}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-ink">
                {streakDays > 0
                  ? 'Keep the cozy rhythm going!'
                  : 'Start a round today to build your streak.'}
              </p>
            </div>

            <div className="tip-note">
              <span className="note-pin" />
              <p>
                <strong>{tips[tipIndex].title}</strong>
                <br />
                {tips[tipIndex].text}
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Calendar Archive & Tips */}
        <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.72fr]">
          <div className="paper-card calendar-card">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="eyebrow">your little archive</p>
                <h2 className="font-display text-2xl font-bold">study calendar</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="calendar-arrow"
                  onClick={() =>
                    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))
                  }
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="month-label">{monthLabel}</span>
                <button
                  className="calendar-arrow"
                  onClick={() =>
                    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))
                  }
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>

            <div className="calendar-grid weekdays">
              {['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="calendar-grid">
              {calendar.map((day, index) => {
                const dayDate = day
                  ? new Date(monthDate.getFullYear(), monthDate.getMonth(), day)
                  : null
                const key = dayDate ? getLocalDateKey(dayDate) : `empty-${index}`
                const minutes = day ? logs[key] ?? 0 : 0
                return (
                  <div
                    key={key}
                    className={`calendar-day ${day ? '' : 'empty'} ${
                      minutes >= 90 ? 'high' : minutes > 0 ? 'some' : ''
                    }`}
                  >
                    <span>{day}</span>
                    {minutes > 0 && (
                      <small>
                        {Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}
                        {minutes % 60}m
                      </small>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-dashed border-line pt-4">
              <p className="text-xs text-muted-ink">Your effort, in tiny squares.</p>
              <div className="flex items-center gap-2 text-[10px] text-muted-ink">
                <span className="legend-dot" /> studied{' '}
                <span className="legend-dot strong" /> deep focus (90m+)
              </div>
            </div>
          </div>

          <div className="paper-card tips-card">
            <div className="mb-5 flex items-center gap-3">
              <div className="book-sticker">
                <BookOpen className="size-5" />
              </div>
              <div>
                <p className="eyebrow">gentle methods</p>
                <h2 className="font-display text-2xl font-bold">study tips</h2>
              </div>
            </div>

            <div className="tip-list">
              <div>
                <span>01</span>
                <p>
                  <strong>Pomodoro</strong>
                  <br />
                  25 min focus, 5 min rest. Let your brain breathe.
                </p>
                <TimerReset className="size-5" />
              </div>
              <div>
                <span>02</span>
                <p>
                  <strong>Blurting</strong>
                  <br />
                  Close your notes and write what you remember.
                </p>
                <Coffee className="size-5" />
              </div>
              <div>
                <span>03</span>
                <p>
                  <strong>Active recall</strong>
                  <br />
                  Ask yourself questions before checking the answer.
                </p>
                <Sparkles className="size-5" />
              </div>
            </div>

            <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-ink">
              made for one lovely learner
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-ink">
          focus softly · rest kindly · come back tomorrow <span className="text-coral">♡</span>
        </footer>
      </div>

      {/* Auth / Profile Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        user={user}
        onUserChange={async (nextUser) => {
          setUser(nextUser)
          const updated = await loadStudyLogs(nextUser)
          setLogs(updated)
        }}
      />
    </main>
  )
}
