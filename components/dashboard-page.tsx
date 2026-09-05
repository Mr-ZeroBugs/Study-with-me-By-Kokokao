'use client'

import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  calculateStreak, getLocalDateKey, getLocalLogs, getLocalStudyIntervals, getLocalSubjectLogs,
  loadStudyIntervals, loadStudyLogs, loadSubjectLogs,
  type DayLog, type StudyInterval, type SubjectDayLogs,
} from '../lib/storage'
import { loadLocalPlannerData, loadPlannerData, type PlannerData } from '../lib/planner-storage'
import {
  getLevelInfo, getWeekMinutes, getWeekTimeLeft,
  getTodayQuests, loadGameState, saveGameState, reconcileGameState,
  type GameState,
} from '../lib/gamification'
import { LineConnectModal } from './line-connect-modal'
import { AuthModal } from './auth-modal'
import { KokoRoom } from './koko-room'
import { LevelUpModal } from './level-up-modal'
import { AchievementToastStack } from './achievement-toast'
import { loadKokoRhythmPlan, RHYTHM_UPDATED_EVENT, type KokoRhythmPlan } from '../lib/rhythm-storage'
import { chooseNextBestAction } from '../lib/next-best-action'
import { buildAdaptiveProposals, buildAdaptiveSignals, type PlannerBehaviorEvent } from '../lib/adaptive-planner'
import { loadPlannerBehaviorEvents, recordPlannerBehaviorEvent } from '../lib/adaptive-planner-client'
import type { PlannerTask } from '../lib/planner-storage'
import { loadPersonalMemory } from '../lib/personal-memory-client'
import type { PersonalMemoryItem } from '../lib/personal-memory'
import { deriveKokoPresentation } from '../lib/personalization'
import { ManagerInboxModal } from './manager-inbox-modal'
import { AdaptivePlannerModal } from './adaptive-planner-modal'
import { WeeklyManagerReviewModal } from './weekly-manager-review-modal'
import { createWeeklyManagerReview } from '../lib/weekly-manager-review'
import { feedbackSuppressesToday, loadManagerFeedback, recordManagerFeedback, type ManagerFeedbackEvent, type ManagerFeedbackType } from '../lib/manager-feedback'
import { chooseProactiveWindow } from '../lib/proactive-window'

export function DashboardPage() {
  const [user,            setUser]            = useState<User | null>(null)
  const [isLineModalOpen, setIsLineModalOpen] = useState(false)
  const [isInboxOpen,     setIsInboxOpen]     = useState(false)
  const [isAdaptiveOpen,  setIsAdaptiveOpen]  = useState(false)
  const [isWeeklyReviewOpen, setIsWeeklyReviewOpen] = useState(false)
  const [isAuthOpen,      setIsAuthOpen]      = useState(false)
  const [logs,            setLogs]            = useState<DayLog>({})
  const [subjectLogs,     setSubjectLogs]     = useState<SubjectDayLogs>({})
  const [intervals,       setIntervals]       = useState<StudyInterval[]>([])
  const [planner,         setPlanner]         = useState<PlannerData>({ tasks: [], events: [] })
  const [rhythmPlan,      setRhythmPlan]      = useState<KokoRhythmPlan | null>(null)
  const [behaviorEvents,  setBehaviorEvents]  = useState<PlannerBehaviorEvent[]>([])
  const [memoryItems,     setMemoryItems]     = useState<PersonalMemoryItem[]>([])
  const [managerFeedback, setManagerFeedback] = useState<ManagerFeedbackEvent[]>([])
  const [now,             setNow]             = useState(() => new Date())
  const [gameState,       setGameState]       = useState<GameState>({
    version: 2, gems: 0, unlockedAchievements: [], lastSeenLevel: 1,
    pendingLevelUp: null, pendingAchievements: [],
  })
  const [showLevelUp,      setShowLevelUp]     = useState<number | null>(null)
  const [achievementQueue, setAchievementQueue] = useState<string[]>([])
  const [dataLoaded,       setDataLoaded]       = useState(false)

  // ── Load data ──────────────────────────────────────────────────
  useEffect(() => {
    let reqId = 0
    setNow(new Date())
    const loadData = async (u: User | null) => {
      const id = ++reqId
      // Core cards update as soon as planner/focus data arrives. Memory and
      // behavioral personalization are optional and must never hold Home open.
      const [nextLogs, nextPlanner, nextIntervals] = await Promise.all([
        loadStudyLogs(u), loadPlannerData(u), loadStudyIntervals(u),
      ])
      const nextSubjectLogs = await loadSubjectLogs(u, nextLogs)
      if (id !== reqId) return
      setLogs(nextLogs); setSubjectLogs(nextSubjectLogs); setPlanner(nextPlanner); setIntervals(nextIntervals); setDataLoaded(true)

      void Promise.all([
        loadPlannerBehaviorEvents(u),
        u ? loadPersonalMemory().then((snapshot) => snapshot.active).catch(() => []) : Promise.resolve([]),
        loadManagerFeedback(u),
      ]).then(([nextBehaviorEvents, nextMemory, nextFeedback]) => {
        if (id !== reqId) return
        setBehaviorEvents(nextBehaviorEvents); setMemoryItems(nextMemory); setManagerFeedback(nextFeedback)
      })
    }
    const applySession = (u: User | null) => {
      // Render the per-account local snapshot immediately. Remote sync then
      // refreshes it in place instead of showing an empty recommendation card.
      setUser(u); setLogs(getLocalLogs(u)); setSubjectLogs(getLocalSubjectLogs(u))
      setPlanner(loadLocalPlannerData(u)); setIntervals(getLocalStudyIntervals(u))
      setBehaviorEvents([]); setMemoryItems([]); setManagerFeedback([]); setDataLoaded(true)
      void loadData(u)
    }
    supabase.auth.getSession().then(({ data }) => applySession(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => applySession(s?.user ?? null))
    const tick = window.setInterval(() => setNow(new Date()), 60_000)
    return () => { reqId += 1; listener.subscription.unsubscribe(); window.clearInterval(tick) }
  }, [])

  useEffect(() => {
    const refreshRhythm = () => setRhythmPlan(loadKokoRhythmPlan(user))
    refreshRhythm()
    window.addEventListener(RHYTHM_UPDATED_EVENT, refreshRhythm)
    return () => window.removeEventListener(RHYTHM_UPDATED_EVENT, refreshRhythm)
  }, [user])

  // ── Derived ────────────────────────────────────────────────────
  const todayKey            = getLocalDateKey(now)
  const todayMinutes        = logs[todayKey] ?? 0
  const totalMinutes        = useMemo(() => Object.values(logs).reduce((s, m) => s + m, 0), [logs])
  const streak              = useMemo(() => calculateStreak(logs), [logs])
  const weekMinutes         = useMemo(() => getWeekMinutes(logs, now), [logs, now])
  const { level, xpIntoLevel, xpToNextLevel, progress: xpProgress } = getLevelInfo(totalMinutes)
  const weekTimeLeft        = getWeekTimeLeft(now)
  const quests              = useMemo(() => getTodayQuests(todayKey), [todayKey])
  const questData           = { todayMinutes, streak, weekMinutes }

  // Tasks
  const todayTasks = useMemo(() =>
    planner.tasks
      .filter(t => !t.completed && (t.dueDate === todayKey || !t.dueDate))
      .sort((a, b) => a.priority - b.priority),
    [planner.tasks, todayKey])

  const openTasks = useMemo(() =>
    planner.tasks
      .filter(t => !t.completed)
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [planner.tasks])

  const dismissedTaskIds = useMemo(() => planner.tasks
    .filter((task) => feedbackSuppressesToday(managerFeedback, 'next_action', `task:${task.id}`, now))
    .map((task) => task.id), [managerFeedback, now, planner.tasks])
  const nextBestAction = useMemo(() => chooseNextBestAction({
    tasks: planner.tasks,
    todayKey,
    rhythmPlan,
    subjectLogs,
    excludedTaskIds: dismissedTaskIds,
  }), [planner.tasks, rhythmPlan, subjectLogs, todayKey, dismissedTaskIds])
  const proactiveWindow = useMemo(() => chooseProactiveWindow({
    now, intervals, nextAction: nextBestAction,
    suppressed: nextBestAction ? feedbackSuppressesToday(managerFeedback, 'proactive_window', `window:${nextBestAction.task.id}`, now) : false,
  }), [intervals, managerFeedback, nextBestAction, now])
  const presentation = useMemo(() => deriveKokoPresentation(memoryItems, buildAdaptiveSignals(behaviorEvents)), [behaviorEvents, memoryItems])
  const adaptiveProposals = useMemo(() => buildAdaptiveProposals({
    tasks: planner.tasks, todayKey, subjectLogs, rhythmPlan, dailyLogs: logs, intervals,
  }), [intervals, logs, planner.tasks, rhythmPlan, subjectLogs, todayKey])
  const weeklyReview = useMemo(() => createWeeklyManagerReview({
    now, logs, subjectLogs, tasks: planner.tasks, behaviorEvents, rhythmPlan, adaptiveProposalCount: adaptiveProposals.length,
  }), [adaptiveProposals.length, behaviorEvents, logs, now, planner.tasks, rhythmPlan, subjectLogs])

  const handleNextActionAccepted = (task: PlannerTask) => {
    void recordPlannerBehaviorEvent(user, { type: 'next_action_accepted', subject: task.subject, taskId: task.id })
      .then((event) => setBehaviorEvents((current) => [...current, event].slice(-250)))
    void recordManagerFeedback(user, { surface: 'next_action', recommendationKey: `task:${task.id}`, eventType: 'accepted', subject: task.subject })
      .then((event) => setManagerFeedback((current) => [...current, event].slice(-120)))
  }

  const handleNextActionDismissed = (task: PlannerTask, eventType: Extract<ManagerFeedbackType, 'dismissed' | 'not_helpful'> = 'dismissed') => {
    void recordManagerFeedback(user, { surface: 'next_action', recommendationKey: `task:${task.id}`, eventType, subject: task.subject })
      .then((event) => setManagerFeedback((current) => [...current, event].slice(-120)))
  }

  const handleProactiveAccepted = (task: PlannerTask) => {
    handleNextActionAccepted(task)
    void recordManagerFeedback(user, { surface: 'proactive_window', recommendationKey: `window:${task.id}`, eventType: 'accepted', subject: task.subject })
      .then((event) => setManagerFeedback((current) => [...current, event].slice(-120)))
  }

  const handleProactiveDismissed = (task: PlannerTask) => {
    void recordManagerFeedback(user, { surface: 'proactive_window', recommendationKey: `window:${task.id}`, eventType: 'dismissed', subject: task.subject })
      .then((event) => setManagerFeedback((current) => [...current, event].slice(-120)))
  }

  const refreshPlanner = () => {
    void loadPlannerData(user).then((nextPlanner) => setPlanner(nextPlanner))
  }

  const completedTodayCount = useMemo(() =>
    planner.tasks.filter(t => t.completed && t.dueDate === todayKey).length,
    [planner.tasks, todayKey])

  // Events
  const upcomingEvents = useMemo(() =>
    planner.events
      .filter(e => e.eventDate >= todayKey)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
    [planner.events, todayKey])

  // ── Gamification reconciliation ────────────────────────────────
  useEffect(() => {
    if (!dataLoaded) return
    const stored = loadGameState()
    const { state } = reconcileGameState(stored, level, {
      totalMinutes, todayMinutes, streak,
      taskCount: planner.tasks.length,
      rhythmAnchorCount: Number(Boolean(rhythmPlan?.majorGroupId)) + Number(Boolean(rhythmPlan?.minorGroupId)),
      level, weekMinutes,
    })
    let next = { ...state }
    if (next.pendingLevelUp !== null) {
      setShowLevelUp(next.pendingLevelUp); next = { ...next, pendingLevelUp: null }
    }
    if (next.pendingAchievements.length > 0) {
      setAchievementQueue(next.pendingAchievements); next = { ...next, pendingAchievements: [] }
    }
    setGameState(next); saveGameState(next)
  }, [dataLoaded, totalMinutes, todayMinutes, streak, weekMinutes, level, planner.tasks.length, rhythmPlan])

  return (
    <>
      {showLevelUp !== null && (
        <LevelUpModal level={showLevelUp} gemsEarned={5} onClose={() => setShowLevelUp(null)} />
      )}
      <AchievementToastStack achievementIds={achievementQueue} onDismissAll={() => setAchievementQueue([])} />

      <KokoRoom
        now={now} user={user}
        todayMinutes={todayMinutes} totalMinutes={totalMinutes}
        streak={streak} weekMinutes={weekMinutes} weekTimeLeft={weekTimeLeft}
        level={level} xpIntoLevel={xpIntoLevel} xpToNextLevel={xpToNextLevel} xpProgress={xpProgress}
        gameState={gameState} quests={quests} questData={questData}
        todayTasks={todayTasks} openTasks={openTasks} completedTodayCount={completedTodayCount}
        upcomingEvents={upcomingEvents}
        subjectLogs={subjectLogs} nextBestAction={nextBestAction} proactiveWindow={proactiveWindow} presentation={presentation} onAcceptNextAction={handleNextActionAccepted} onDismissNextAction={handleNextActionDismissed} onAcceptProactive={handleProactiveAccepted} onDismissProactive={handleProactiveDismissed}
        onOpenLine={() => setIsLineModalOpen(true)} onOpenInbox={() => setIsInboxOpen(true)}
        onOpenWeeklyReview={() => setIsWeeklyReviewOpen(true)}
      />

      <LineConnectModal isOpen={isLineModalOpen} onClose={() => setIsLineModalOpen(false)} user={user} onOpenAuth={() => setIsAuthOpen(true)} />
      <ManagerInboxModal isOpen={isInboxOpen} onClose={() => setIsInboxOpen(false)} onApplied={refreshPlanner} />
      <AdaptivePlannerModal isOpen={isAdaptiveOpen} proposals={adaptiveProposals} onClose={() => setIsAdaptiveOpen(false)} onApplied={refreshPlanner} />
      <WeeklyManagerReviewModal isOpen={isWeeklyReviewOpen} review={weeklyReview} onClose={() => setIsWeeklyReviewOpen(false)} onOpenAdaptivePlanner={() => setIsAdaptiveOpen(true)} />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} user={user} onUserChange={setUser} />
    </>
  )
}
