'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
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
  repairStudyDay,
  getLocalDateKey,
  calculateStreak,
  createStudyIntervalId,
  getLocalRounds,
  getLocalSubjects,
  MAX_CONTINUOUS_FOCUS_SECONDS,
  recordStudyInterval,
  loadStudyRounds,
  recordFocusMinutesByTimeline,
  saveLocalSubjects,
  saveLocalRounds,
  type DayLog,
} from '../lib/storage'
import { AuthModal } from '../components/auth-modal'
import { DashboardPage } from '../components/dashboard-page'
import { INTENSITY_UPDATED_EVENT, getIntensityThreshold, loadIntensityThreshold } from '../lib/theme'
import { ensureOntologySubject, loadOntologySnapshot } from '../lib/ontology-client'
import { takePendingFocusSubject } from '../lib/next-best-action'
import { loadAccountState, removeAccountState, saveAccountState } from '../lib/account-state'

const modes = {
  focus: { label: 'Focus time', minutes: 25, color: 'mint' },
  short: { label: 'Short break', minutes: 5, color: 'peach' },
  long: { label: 'Long break', minutes: 15, color: 'lilac' },
} as const

type Mode = keyof typeof modes
type TimerMode = 'flow' | 'countdown'
type Extension = 'pomodoro' | 'rule5217' | null

const TIMER_SESSION_NAMESPACE = 'timer_session'
const POMODORO_LENGTH_OPTIONS = [15, 25, 30, 45, 50, 60]
const POMODORO_REMINDER_OPTIONS = [15, 20, 25, 30, 45, 50, 60]
const RULE_5217_FOCUS_MINUTES = 52
const LONG_FOCUS_WARNING_SECONDS = 150 * 60
const FOCUS_CONFIRM_SECONDS = 180 * 60
const FOCUS_CONFIRM_GRACE_SECONDS = 2 * 60
const TIMER_RECOVERY_NAMESPACE = 'timer_recovery'

function countdownLengthFor(mode: Mode, extension: Extension, pomodoroMinutes: number) {
  if (extension === 'rule5217') return RULE_5217_FOCUS_MINUTES
  if (extension === 'pomodoro') return pomodoroMinutes
  return modes[mode].minutes
}

function reminderLengthFor(extension: Extension, pomodoroReminderMinutes: number) {
  return extension === 'rule5217' ? RULE_5217_FOCUS_MINUTES : pomodoroReminderMinutes
}

type PersistedTimerSession = {
  version: 1
  running: boolean
  timerMode: TimerMode
  mode: Mode
  extension: Extension
  subject: string
  elapsedSeconds: number
  seconds: number
  pomodoroMinutes: number
  reminderMinutes: number
  reminderSeconds: number
  savedAt: number
  activeStartedAt: number | null
  longFocusWarned: boolean
  threeHourConfirmed: boolean
}

type TimerRecovery = { dateKey: string; subject: string; recordedMinutes: number; suggestedMinutes: number }

function normalizePersistedTimerSession(value: unknown): PersistedTimerSession | null {
  try {
    const parsed = value as Partial<PersistedTimerSession> | null
    if (!parsed || parsed.version !== 1 || typeof parsed.savedAt !== 'number') return null
    if (parsed.timerMode !== 'flow' && parsed.timerMode !== 'countdown') return null
    if (parsed.mode !== 'focus' && parsed.mode !== 'short' && parsed.mode !== 'long') return null
    const extension = parsed.extension === 'pomodoro' || parsed.extension === 'rule5217' ? parsed.extension : null
    const session: PersistedTimerSession = {
      version: 1,
      running: parsed.running === true,
      timerMode: parsed.timerMode,
      mode: parsed.mode,
      extension,
      subject: typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim().slice(0, 40) : 'General',
      elapsedSeconds: Math.max(0, Math.floor(Number(parsed.elapsedSeconds) || 0)),
      seconds: Math.max(0, Math.floor(Number(parsed.seconds) || modes[parsed.mode].minutes * 60)),
      pomodoroMinutes: POMODORO_LENGTH_OPTIONS.includes(Number(parsed.pomodoroMinutes)) ? Number(parsed.pomodoroMinutes) : 25,
      reminderMinutes: Math.max(1, Math.floor(Number(parsed.reminderMinutes) || 25)),
      reminderSeconds: Math.max(0, Math.floor(Number(parsed.reminderSeconds) || 25 * 60)),
      savedAt: parsed.savedAt,
      activeStartedAt: typeof parsed.activeStartedAt === 'number' ? parsed.activeStartedAt : null,
      longFocusWarned: parsed.longFocusWarned === true,
      threeHourConfirmed: parsed.threeHourConfirmed === true,
    }
    return session
  } catch {
    return null
  }
}

function savePersistedTimerSession(user: User | null, session: Omit<PersistedTimerSession, 'version' | 'savedAt'>) {
  void saveAccountState(user, TIMER_SESSION_NAMESPACE, { ...session, version: 1, savedAt: Date.now() })
    // A timer must stay usable when a network request briefly fails. The
    // in-memory snapshot remains available in this tab; account-state errors
    // are handled once at the persistence layer instead of spamming the UI.
    .catch(() => {})
}

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

function TimerPage() {
  // Timer States
  const [timerMode, setTimerMode] = useState<TimerMode>('flow')
  const [extension, setExtension] = useState<Extension>(null)
  const [mode, setMode] = useState<Mode>('focus')
  const [seconds, setSeconds] = useState(25 * 60)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25)
  const [reminderMinutes, setReminderMinutes] = useState(25)
  const [reminderSeconds, setReminderSeconds] = useState(25 * 60)
  const [reminderReached, setReminderReached] = useState(false)
  const [timerGuardNotice, setTimerGuardNotice] = useState('')
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [timerRecovery, setTimerRecovery] = useState<TimerRecovery | null>(null)
  const [recoveryMinutes, setRecoveryMinutes] = useState(180)
  const [recoverySaving, setRecoverySaving] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [timerRestored, setTimerRestored] = useState(false)

  // User & Data States
  const [user, setUser] = useState<User | null>(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [sessions, setSessions] = useState(0)
  const [logs, setLogs] = useState<DayLog>({})
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [selectedSubject, setSelectedSubject] = useState('General')
  const [subjectDraft, setSubjectDraft] = useState('')
  const [isAddingSubject, setIsAddingSubject] = useState(false)
  // Use a stable initial month for SSR, then switch to the user's current month after mount.
  const [monthDate, setMonthDate] = useState(() => new Date(2000, 0, 1))
  const [tipIndex, setTipIndex] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [todayKey, setTodayKey] = useState('')
  const [todayLabel, setTodayLabel] = useState('today')
  const [highThreshold, setHighThreshold] = useState(90)

  // Refs for accurate timestamp-based timer (No tab-switch drift)
  const timerStartRef = useRef<number | null>(null)
  const baseSecondsRef = useRef<number>(25 * 60)
  const baseElapsedRef = useRef<number>(0)
  const baseReminderRef = useRef<number>(25 * 60)
  const lastReminderCycleRef = useRef<number>(0)
  const lastMinuteSyncRef = useRef<number>(0)
  // Keep the interval effect stable while the timer is running. Re-running the
  // effect for unrelated UI updates (sound, auth, logs, etc.) used to create a
  // new start timestamp and could make open-ended focus appear to reset.
  const timerOptionsRef = useRef({ running, timerMode, mode, extension, pomodoroMinutes, reminderMinutes, reminderSeconds, soundEnabled, user, selectedSubject, seconds, elapsedSeconds })
  timerOptionsRef.current = { running, timerMode, mode, extension, pomodoroMinutes, reminderMinutes, reminderSeconds, soundEnabled, user, selectedSubject, seconds, elapsedSeconds }
  const activeIntervalRef = useRef<{ startedAt: number; timerMode: TimerMode; mode: Mode; subject: string; user: User | null; plannedMinutes: number } | null>(null)
  const restoredActiveStartedAtRef = useRef<number | null>(null)
  const restoredLastMinuteSyncRef = useRef<number | null>(null)
  const longFocusWarnedRef = useRef(false)
  const threeHourConfirmedRef = useRef(false)
  const timerRestoredRef = useRef(false)
  // Auth resolves after the focus UI mounts. Keep track of which subject
  // namespace we are showing so a subject added during that short gap is not
  // overwritten when the signed-in namespace finishes loading.
  const ontologySubjectIdsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (!mounted) return
    const pendingSubject = takePendingFocusSubject()
    if (!pendingSubject) return
    setSubjects((current) => current.includes(pendingSubject) ? current : [...current, pendingSubject])
    setSelectedSubject(pendingSubject)
  }, [mounted])

  const resolveSubjectId = useCallback(async (subject: string, currentUser: User | null) => {
    if (!currentUser) return undefined
    if (ontologySubjectIdsRef.current[subject]) return ontologySubjectIdsRef.current[subject]
    try {
      const subjectId = await ensureOntologySubject(subject)
      ontologySubjectIdsRef.current[subject] = subjectId
      return subjectId
    } catch {
      // Ontology remains additive while older installs are still migrating.
      return undefined
    }
  }, [])

  // Keep the visible "today" bucket correct even when the Focus page stays
  // open across midnight.
  useEffect(() => {
    if (!mounted) return
    const refreshDay = () => {
      const now = new Date()
      const nextKey = getLocalDateKey(now)
      setTodayKey((current) => {
        if (current === nextKey) return current
        setTodayLabel(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
        setSessions(getLocalRounds(nextKey, user))
        return nextKey
      })
    }
    const dayInterval = window.setInterval(refreshDay, 60_000)
    return () => window.clearInterval(dayInterval)
  }, [mounted, user])

  const persistCurrentTimer = useCallback(() => {
    if (!timerRestoredRef.current) return
    const current = timerOptionsRef.current
    savePersistedTimerSession(current.user, {
      running: current.running,
      timerMode: current.timerMode,
      mode: current.mode,
      extension: current.extension,
      subject: current.selectedSubject,
      elapsedSeconds: current.elapsedSeconds,
      seconds: current.seconds,
      pomodoroMinutes: current.pomodoroMinutes,
      reminderMinutes: current.reminderMinutes,
      reminderSeconds: current.reminderSeconds,
      activeStartedAt: current.running ? activeIntervalRef.current?.startedAt ?? Date.now() : null,
      longFocusWarned: longFocusWarnedRef.current,
      threeHourConfirmed: threeHourConfirmedRef.current,
    })
  }, [])

  const sendTimerAlert = useCallback(async (kind: 'long_focus' | 'auto_stopped', subject: string, minutes: number) => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      await fetch('/api/line/timer-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, subject, minutes }),
      })
    } catch {}
  }, [])

  const finishActiveInterval = useCallback(() => {
    const activeInterval = activeIntervalRef.current
    if (!activeInterval) return
    activeIntervalRef.current = null
    const endedAt = Date.now()
    const durationSeconds = Math.max(0, Math.floor((endedAt - activeInterval.startedAt) / 1000))
    if (durationSeconds < 5) return
    // The interval belongs to the account that started it. If auth changes
    // while the timer is winding down, never attribute old focus to the newly
    // signed-in account.
    const intervalUser = activeInterval.user
    void resolveSubjectId(activeInterval.subject, intervalUser).then((subjectId) => recordStudyInterval(intervalUser, {
      id: createStudyIntervalId(),
      startedAt: new Date(activeInterval.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSeconds,
      timerMode: activeInterval.timerMode,
      mode: activeInterval.mode,
      subject: activeInterval.subject,
      subjectId,
    }))
  }, [resolveSubjectId])

  // 1. Initialize User, Today info, and Load Data
  useEffect(() => {
    let requestId = 0
    const now = new Date()
    const key = getLocalDateKey(now)
    setMonthDate(new Date(now.getFullYear(), now.getMonth(), 1))
    setTodayKey(key)
    setTodayLabel(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
    setSessions(0)
    setSubjects(['General'])
    setHighThreshold(getIntensityThreshold())
    setMounted(true)

    const loadData = async (currentUser: User | null) => {
      const currentRequestId = ++requestId
      const [nextLogs, ontologySubjectNames] = await Promise.all([
        loadStudyLogs(currentUser),
        currentUser
          ? loadOntologySnapshot().then((snapshot) => snapshot.subjects.flatMap((subject) => typeof subject.name === 'string' ? [subject.name] : [])).catch(() => [])
          : Promise.resolve([] as string[]),
      ])
      if (currentRequestId !== requestId) return
      setLogs(nextLogs)
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(currentUser), ...ontologySubjectNames])))
    }

    // Listen for intensity threshold changes from Settings modal
    const onIntensity = (e: Event) => {
      const val = (e as CustomEvent<number>).detail
      if (Number.isFinite(val) && val >= 15) setHighThreshold(val)
    }
    window.addEventListener(INTENSITY_UPDATED_EVENT, onIntensity)

    const applyUserSession = async (currentUser: User | null) => {
      setUser(currentUser)
      void loadIntensityThreshold(currentUser).then(setHighThreshold).catch(() => {})
      setLogs({})
      setSessions(getLocalRounds(key, currentUser))
      void loadStudyRounds(currentUser, key).then(setSessions).catch(() => {})
      setSubjects(getLocalSubjects(currentUser))
      await loadData(currentUser)
    }

    // Listen to Supabase Auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      void applyUserSession(session?.user ?? null)
    })

    void supabase.auth.getSession().then(({ data: { session } }) => {
      return applyUserSession(session?.user ?? null)
    })

    return () => {
      requestId += 1
      authListener.subscription.unsubscribe()
      window.removeEventListener(INTENSITY_UPDATED_EVENT, onIntensity)
    }
  }, [])

  // Restore the timer after route navigation or a refresh. The server still
  // renders stable zero/default values; browser-only state is applied after mount.
  useEffect(() => {
    let active = true
    timerRestoredRef.current = false
    setTimerRestored(false)
    setRunning(false)
    setElapsedSeconds(0)
    setTimerRecovery(null)
    void Promise.all([
      loadAccountState<TimerRecovery | null>(user, TIMER_RECOVERY_NAMESPACE, null),
      loadAccountState<PersistedTimerSession | null>(user, TIMER_SESSION_NAMESPACE, null),
    ]).then(([recovery, rawPersisted]) => {
      if (!active) return
      if (recovery?.dateKey && Number.isFinite(recovery.recordedMinutes)) {
        setTimerRecovery(recovery)
        setRecoveryMinutes(recovery.suggestedMinutes)
      }
    const persisted = normalizePersistedTimerSession(rawPersisted)
    if (persisted) {
      const now = Date.now()
      const secondsSinceSave = persisted.running ? Math.max(0, Math.floor((now - persisted.savedAt) / 1000)) : 0
      const rawNextElapsed = persisted.timerMode === 'flow' ? persisted.elapsedSeconds + secondsSinceSave : persisted.elapsedSeconds
      const nextElapsed = Math.min(rawNextElapsed, MAX_CONTINUOUS_FOCUS_SECONDS)
      const nextCountdown = persisted.timerMode === 'countdown' && persisted.running
        ? Math.max(0, persisted.seconds - secondsSinceSave)
        : persisted.seconds
      // Resume flow for one engine tick even when it has reached the safety
      // cap. That tick records the verified timeline up to four hours, then
      // pauses it clean instead of silently losing the time before the cap.
      const shouldResume = persisted.running && (persisted.timerMode === 'flow' || nextCountdown > 0)

      const restoredMode = persisted.extension ? 'focus' : persisted.mode
      setTimerMode(persisted.timerMode)
      setMode(restoredMode)
      setExtension(persisted.extension)
      setPomodoroMinutes(persisted.pomodoroMinutes)
      setSelectedSubject(persisted.subject)
      setSubjects((previous) => Array.from(new Set([...previous, persisted.subject])))
      setElapsedSeconds(nextElapsed)
      setSeconds(nextCountdown > 0 ? nextCountdown : countdownLengthFor(restoredMode, persisted.extension, persisted.pomodoroMinutes) * 60)
      setReminderMinutes(persisted.reminderMinutes)
      setReminderSeconds(persisted.reminderSeconds)
      longFocusWarnedRef.current = persisted.longFocusWarned
      threeHourConfirmedRef.current = persisted.threeHourConfirmed
      if (shouldResume) {
        restoredActiveStartedAtRef.current = persisted.activeStartedAt ?? persisted.savedAt
        restoredLastMinuteSyncRef.current = persisted.elapsedSeconds
      }
      setRunning(shouldResume)
    } else {
      setSelectedSubject('General')
      setSeconds(countdownLengthFor('focus', null, 25) * 60)
    }
    timerRestoredRef.current = true
    setTimerRestored(true)
    }).catch((error) => {
      console.error('Failed to restore timer state:', error)
      timerRestoredRef.current = true
      setTimerRestored(true)
    })
    return () => { active = false }
  }, [user])

  // 2. Complete Focus Session Handler
  const handleFocusCompleted = useCallback(
    async (durationMins: number, startedAt?: number) => {
      if (soundEnabled) {
        soundEngine.playFocusComplete()
      }
      triggerCozyConfetti()

      const newSessions = sessions + 1
      setSessions(newSessions)
      if (todayKey) {
        saveLocalRounds(todayKey, newSessions, user)
      }

      const subjectId = await resolveSubjectId(selectedSubject, user)
      const updatedLogs = typeof startedAt === 'number'
        ? await recordFocusMinutesByTimeline(user, startedAt, 0, durationMins * 60, mode, timerMode, selectedSubject, subjectId, true)
        : (await recordFocusSession(user, durationMins, mode, timerMode, selectedSubject, subjectId)).updatedLogs
      setLogs(updatedLogs)
    },
    [soundEnabled, sessions, todayKey, user, mode, timerMode, selectedSubject, resolveSubjectId]
  )
  const handleFocusCompletedRef = useRef(handleFocusCompleted)
  handleFocusCompletedRef.current = handleFocusCompleted

  // 3. Accurate Timestamp-based Timer Engine
  useEffect(() => {
    if (!running) {
      timerStartRef.current = null
      return
    }

    const options = timerOptionsRef.current
    const clockStartedAt = Date.now()
    const startedAt = activeIntervalRef.current?.startedAt ?? restoredActiveStartedAtRef.current ?? clockStartedAt
    restoredActiveStartedAtRef.current = null
    timerStartRef.current = clockStartedAt
    baseSecondsRef.current = options.seconds
    baseElapsedRef.current = options.elapsedSeconds
    baseReminderRef.current = options.reminderSeconds
    lastMinuteSyncRef.current = restoredLastMinuteSyncRef.current ?? options.elapsedSeconds
    lastReminderCycleRef.current = Math.floor(options.elapsedSeconds / (reminderLengthFor(options.extension, options.reminderMinutes) * 60))
    restoredLastMinuteSyncRef.current = null
    activeIntervalRef.current = {
      startedAt,
      timerMode: options.timerMode,
      mode: options.mode,
      subject: options.selectedSubject,
      user: options.user,
      plannedMinutes: options.timerMode === 'countdown' ? Math.max(1, Math.round(options.seconds / 60)) : 0,
    }

    const interval = window.setInterval(() => {
      if (!timerStartRef.current) return
      const elapsedWallClock = Math.floor((Date.now() - timerStartRef.current) / 1000)
      const currentOptions = timerOptionsRef.current
      const activeInterval = activeIntervalRef.current
      if (!activeInterval) return

      if (activeInterval.timerMode === 'flow') {
        const rawCurrentElapsed = baseElapsedRef.current + elapsedWallClock
        const currentElapsed = Math.min(rawCurrentElapsed, MAX_CONTINUOUS_FOCUS_SECONDS)
        setElapsedSeconds(currentElapsed)

        // Check if a full minute passed during flow study to increment stats
        const minutesToRecord = Math.floor(currentElapsed / 60) - Math.floor(lastMinuteSyncRef.current / 60)
        if (minutesToRecord > 0) {
          const fromElapsed = lastMinuteSyncRef.current
          lastMinuteSyncRef.current = currentElapsed
          // Attribute each minute to the local calendar day where it happened.
          recordFocusMinutesByTimeline(activeInterval.user, activeInterval.startedAt, fromElapsed, currentElapsed, 'flow', 'flow', activeInterval.subject).then((updatedLogs) => {
            setLogs(updatedLogs)
          })
        }

        if (rawCurrentElapsed >= MAX_CONTINUOUS_FOCUS_SECONDS && threeHourConfirmedRef.current) {
          finishActiveInterval()
          setRunning(false)
          setTimerGuardNotice('Koko paused this open-ended session at 4 hours so a forgotten timer cannot distort your stats.')
          return
        }

        if (currentElapsed >= LONG_FOCUS_WARNING_SECONDS && !longFocusWarnedRef.current) {
          longFocusWarnedRef.current = true
          setTimerGuardNotice('You have been focusing for 2.5 hours. A short break now may protect the quality of the next hour.')
          void sendTimerAlert('long_focus', activeInterval.subject, Math.floor(currentElapsed / 60))
        }

        if (currentElapsed >= FOCUS_CONFIRM_SECONDS && !threeHourConfirmedRef.current) {
          setConfirmationOpen(true)
          if (currentElapsed >= FOCUS_CONFIRM_SECONDS + FOCUS_CONFIRM_GRACE_SECONDS) {
            const recordedMinutes = Math.floor(currentElapsed / 60)
            const recovery: TimerRecovery = {
              dateKey: getLocalDateKey(new Date(activeInterval.startedAt)),
              subject: activeInterval.subject,
              recordedMinutes,
              suggestedMinutes: 180,
            }
            void saveAccountState(currentOptions.user, TIMER_RECOVERY_NAMESPACE, recovery).catch(() => {})
            setTimerRecovery(recovery)
            setRecoveryMinutes(recovery.suggestedMinutes)
            setConfirmationOpen(false)
            finishActiveInterval()
            setRunning(false)
            setElapsedSeconds(0)
            baseElapsedRef.current = 0
            setTimerGuardNotice('Koko stopped the timer after the 2-minute confirmation window. You can review the recorded time below.')
            void sendTimerAlert('auto_stopped', activeInterval.subject, recordedMinutes)
            return
          }
        }

        // Extension reminder countdown
        if (currentOptions.extension) {
          const reminderMinutes = reminderLengthFor(currentOptions.extension, currentOptions.reminderMinutes)
          const reminderSeconds = reminderMinutes * 60
          const remainder = currentElapsed % reminderSeconds
          const reminderCycle = Math.floor(currentElapsed / reminderSeconds)
          const reminderReachedNow = currentElapsed > 0 && remainder === 0 && reminderCycle > lastReminderCycleRef.current
          if (reminderReachedNow) {
            lastReminderCycleRef.current = reminderCycle
            setReminderReached(true)
            if (currentOptions.soundEnabled) soundEngine.playFocusComplete()
            baseReminderRef.current = reminderMinutes * 60
            setReminderSeconds(reminderMinutes * 60)
          } else {
            setReminderSeconds(remainder === 0 ? reminderSeconds : reminderSeconds - remainder)
          }
        }
      } else {
        // Countdown mode
        const remaining = baseSecondsRef.current - elapsedWallClock
        if (remaining <= 0) {
          const completedStartedAt = activeInterval.startedAt
          finishActiveInterval()
          setRunning(false)
          setSeconds(countdownLengthFor(activeInterval.mode, currentOptions.extension, currentOptions.pomodoroMinutes) * 60)
          if (activeInterval.mode === 'focus') {
            void handleFocusCompletedRef.current(activeInterval.plannedMinutes, completedStartedAt)
          } else {
            if (currentOptions.soundEnabled) soundEngine.playBreakComplete()
          }
        } else {
          setSeconds(remaining)
        }
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [running, finishActiveInterval, sendTimerAlert])

  // Save a lightweight snapshot while running so navigation never destroys the
  // active clock. Absolute timestamps account for time spent on other pages.
  useEffect(() => {
    if (!timerRestored) return
    persistCurrentTimer()
    if (!running) return
    const persistenceInterval = window.setInterval(persistCurrentTimer, 15_000)
    return () => window.clearInterval(persistenceInterval)
  }, [timerRestored, running, timerMode, mode, extension, pomodoroMinutes, reminderMinutes, selectedSubject, persistCurrentTimer])

  // Timer Controls
  const togglePlay = () => {
    if (soundEnabled) soundEngine.playSoftClick()
    if (running) finishActiveInterval()
    if (!running) {
      setTimerGuardNotice('')
      longFocusWarnedRef.current = elapsedSeconds >= LONG_FOCUS_WARNING_SECONDS
      if (elapsedSeconds < FOCUS_CONFIRM_SECONDS) threeHourConfirmedRef.current = false
    }
    setRunning((current) => !current)
  }

  const selectMode = (nextMode: Mode) => {
    if (soundEnabled) soundEngine.playSoftClick()
    finishActiveInterval()
    const effectiveMode = extension ? 'focus' : nextMode
    const nextLength = countdownLengthFor(effectiveMode, extension, pomodoroMinutes)
    setMode(effectiveMode)
    setSeconds(nextLength * 60)
    baseSecondsRef.current = nextLength * 60
    setRunning(false)
  }

  const selectTimerMode = (nextMode: TimerMode) => {
    if (soundEnabled) soundEngine.playSoftClick()
    finishActiveInterval()
    setTimerMode(nextMode)
    setRunning(false)
    const nextLength = countdownLengthFor(mode, extension, pomodoroMinutes)
    setSeconds(nextLength * 60)
    baseSecondsRef.current = nextLength * 60
    setElapsedSeconds(0)
    baseElapsedRef.current = 0
    const reminderLength = reminderLengthFor(extension, reminderMinutes)
    setReminderSeconds(reminderLength * 60)
    baseReminderRef.current = reminderLength * 60
    setReminderReached(false)
  }

  const selectExtension = (nextExtension: Exclude<Extension, null>) => {
    if (soundEnabled) soundEngine.playSoftClick()
    finishActiveInterval()
    const enabled = extension === nextExtension ? null : nextExtension
    setExtension(enabled)
    if (enabled) setMode('focus')
    setRunning(false)
    const reminderLength = reminderLengthFor(enabled, reminderMinutes)
    setReminderSeconds(reminderLength * 60)
    baseReminderRef.current = reminderLength * 60
    const nextLength = countdownLengthFor(enabled ? 'focus' : mode, enabled, pomodoroMinutes)
    setSeconds(nextLength * 60)
    baseSecondsRef.current = nextLength * 60
    setReminderReached(false)
  }

  const reset = () => {
    if (soundEnabled) soundEngine.playSoftClick()
    finishActiveInterval()
    const countdownLength = countdownLengthFor(mode, extension, pomodoroMinutes)
    setSeconds(countdownLength * 60)
    baseSecondsRef.current = countdownLength * 60
    setElapsedSeconds(0)
    baseElapsedRef.current = 0
    const reminderLength = reminderLengthFor(extension, reminderMinutes)
    setReminderSeconds(reminderLength * 60)
    baseReminderRef.current = reminderLength * 60
    setReminderReached(false)
    setConfirmationOpen(false)
    longFocusWarnedRef.current = false
    threeHourConfirmedRef.current = false
    timerStartRef.current = null
    restoredActiveStartedAtRef.current = null
    restoredLastMinuteSyncRef.current = null
    // Commit the reset synchronously. Otherwise the still-live persistence
    // interval can write the old 240-minute running snapshot back before the
    // React state update has rendered.
    timerOptionsRef.current = {
      ...timerOptionsRef.current,
      running: false,
      seconds: countdownLength * 60,
      elapsedSeconds: 0,
      reminderSeconds: reminderLength * 60,
    }
    savePersistedTimerSession(user, {
      running: false,
      timerMode,
      mode,
      extension,
      subject: selectedSubject,
      elapsedSeconds: 0,
      seconds: countdownLength * 60,
      pomodoroMinutes,
      reminderMinutes,
      reminderSeconds: reminderLength * 60,
      activeStartedAt: null,
      longFocusWarned: false,
      threeHourConfirmed: false,
    })
    setRunning(false)
  }

  const selectPomodoroMinutes = (nextMinutes: number) => {
    setPomodoroMinutes(nextMinutes)
    if (!running && timerMode === 'countdown' && extension === 'pomodoro') {
      setSeconds(nextMinutes * 60)
      baseSecondsRef.current = nextMinutes * 60
    }
  }

  const selectPomodoroReminder = (nextMinutes: number) => {
    setReminderMinutes(nextMinutes)
    if (!running) {
      setReminderSeconds(nextMinutes * 60)
      baseReminderRef.current = nextMinutes * 60
      setReminderReached(false)
    }
  }

  const selectSubject = (nextSubject: string) => {
    setSelectedSubject(nextSubject)
    reset()
  }

  const addSubject = async () => {
    const nextSubject = subjectDraft.trim().slice(0, 40)
    if (!nextSubject) return
    const nextSubjects = Array.from(new Set([...subjects, nextSubject]))
    saveLocalSubjects(nextSubjects, user)
    if (user) {
      try { await ensureOntologySubject(nextSubject) }
      catch (error) { console.error('Failed to save subject to Supabase:', error); return }
    }
    setSubjects(nextSubjects)
    selectSubject(nextSubject)
    setSubjectDraft('')
    setIsAddingSubject(false)
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
    <main className="min-h-screen overflow-hidden px-4 py-5 pb-28 text-ink sm:px-8 lg:px-12">
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

            <div className="subject-picker">
              <div className="subject-picker-heading">
                <div><p className="eyebrow">study subject</p><span>What are we focusing on?</span></div>
                <span className="subject-count">{subjects.length} saved</span>
              </div>
              <div className="subject-picker-controls">
                <select aria-label="Study subject" value={selectedSubject} disabled={running} onChange={(event) => selectSubject(event.target.value)}>
                  {subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                </select>
                <button className="add-subject-button" aria-label="Create a new subject" onClick={() => setIsAddingSubject((value) => !value)}>＋ new subject</button>
              </div>
              {isAddingSubject && <div className="add-subject-form">
                <input autoFocus value={subjectDraft} maxLength={40} placeholder="e.g. Biology" onChange={(event) => setSubjectDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addSubject() }} />
                <button onClick={addSubject}>add</button>
              </div>}
              <p className="subject-picker-note">This timer will be counted under <strong>{selectedSubject}</strong>.</p>
            </div>

            {/* Big Timer Clock */}
            <div className="timer-face">
              <div className="timer-sparkle">✦</div>
              <span>{formatTime(timerMode === 'flow' ? elapsedSeconds : seconds)}</span>
              <div className="timer-underline" />
            </div>

            {timerGuardNotice && (
              <div className="timer-guard-notice" role="status">
                <TimerReset className="size-4" />
                <span>{timerGuardNotice}</span>
                <button type="button" onClick={() => setTimerGuardNotice('')} aria-label="Dismiss timer safety notice">×</button>
              </div>
            )}

            {confirmationOpen && (
              <div className="timer-confirm-card" role="alertdialog" aria-label="Confirm that you are still focusing">
                <div><p className="eyebrow">three-hour checkpoint</p><strong>Are you still studying?</strong><span>Confirm within 2 minutes or Koko will stop the timer to protect your stats.</span></div>
                <div><button type="button" className="timer-confirm-stop" onClick={() => { finishActiveInterval(); setRunning(false); setConfirmationOpen(false); setTimerGuardNotice('Timer stopped at your three-hour checkpoint.') }}>stop now</button><button type="button" className="timer-confirm-continue" onClick={() => { threeHourConfirmedRef.current = true; setConfirmationOpen(false); setTimerGuardNotice('Confirmed — your timer will continue.') }}>yes, continue</button></div>
              </div>
            )}

            {timerRecovery && (
              <div className="timer-recovery-card">
                <div><p className="eyebrow">review auto-stopped time</p><strong>{timerRecovery.subject} · {timerRecovery.dateKey}</strong><span>Koko recorded {timerRecovery.recordedMinutes} minutes. Adjust it only if your actual focus time was different.</span></div>
                <label><span>actual focus</span><input type="number" min="0" max="240" step="5" value={recoveryMinutes} onChange={(event) => setRecoveryMinutes(Math.max(0, Math.min(240, Number(event.target.value) || 0)))} /><small>min</small></label>
                <div><button type="button" onClick={() => { void removeAccountState(user, TIMER_RECOVERY_NAMESPACE); setTimerRecovery(null) }}>keep recorded time</button><button type="button" disabled={recoverySaving} onClick={async () => { setRecoverySaving(true); try { await repairStudyDay(user, timerRecovery.dateKey, recoveryMinutes); setLogs(await loadStudyLogs(user)); await removeAccountState(user, TIMER_RECOVERY_NAMESPACE); setTimerRecovery(null) } finally { setRecoverySaving(false) } }}>{recoverySaving ? 'saving…' : 'save correction'}</button></div>
              </div>
            )}

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

            {/* Keep the primary action close to the timer so it remains easy to reach on small screens. */}
            <div className="focus-actions mt-7 flex justify-center gap-3">
              <button className="main-button" onClick={togglePlay}>
                {running ? <Pause className="size-4" /> : <Play className="size-4 fill-current" />}
                {running ? 'pause' : 'start studying'}
              </button>
              <button aria-label="Reset timer" className="icon-button" onClick={reset}>
                <RotateCcw className="size-4" />
              </button>
            </div>

            {/* Flow Mode Extensions */}
            <div className="optional-extensions mt-5 rounded-2xl border border-dashed border-line bg-paper/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="eyebrow">optional extensions</p>
                <span className="text-[10px] text-muted-ink">{extension ? 'active' : 'off'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => selectExtension('pomodoro')}
                  className={`mode-button ${extension === 'pomodoro' ? 'active' : ''}`}
                >
                  Pomodoro
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

            {/* Countdown Length Selection */}
            {timerMode === 'countdown' && (
              <div className="extension-control-row mt-4">
                {extension === 'pomodoro' ? <><span>focus length:</span><select aria-label="Pomodoro focus length" value={pomodoroMinutes} disabled={running} onChange={(event) => selectPomodoroMinutes(Number(event.target.value))} className="extension-control-value">{POMODORO_LENGTH_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select></> : extension === 'rule5217' ? <><span>52 / 17 focus length:</span><strong className="extension-control-value">52 min</strong></> : <><span>length:</span><div className="flex flex-wrap justify-end gap-2">{(Object.keys(modes) as Mode[]).map((item) => (<button key={item} onClick={() => selectMode(item)} className={`mode-button ${mode === item ? 'active' : ''}`}>{item === 'focus' ? '25 min' : item === 'short' ? '5 min' : '15 min'}</button>))}</div></>}
              </div>
            )}

            {/* Active Extension Info */}
            {timerMode === 'flow' && extension && (
              <div className="extension-control-row mt-4">
                <span>{extension === 'pomodoro' ? 'gentle reminder every' : 'focus reminder every'}</span>
                {extension === 'pomodoro' ? <select aria-label="Pomodoro reminder interval" value={reminderMinutes} disabled={running} onChange={(event) => selectPomodoroReminder(Number(event.target.value))} className="extension-control-value">{POMODORO_REMINDER_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select> : <strong className="extension-control-value">52 min</strong>}
                {reminderReached && (
                  <button className="tip-button extension-break-button" onClick={() => setReminderReached(false)}>
                    <Coffee className="size-4" /> time for a tiny break
                  </button>
                )}
              </div>
            )}

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
                  aria-label="Previous month"
                  onClick={() =>
                    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))
                  }
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="month-label">{monthLabel}</span>
                <button
                  className="calendar-arrow"
                  aria-label="Next month"
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
                      minutes >= highThreshold ? 'high' : minutes > 0 ? 'some' : ''
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
                <span className="legend-dot strong" /> deep focus ({highThreshold >= 60 ? (highThreshold % 60 === 0 ? `${highThreshold / 60}h+` : `${Math.floor(highThreshold / 60)}h ${highThreshold % 60}m+`) : `${highThreshold}m+`})
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
            setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(nextUser)])))
          }}
      />
    </main>
  )
}

export default function Page() {
  const pathname = usePathname()
  return pathname === '/' ? <DashboardPage /> : <TimerPage />
}
