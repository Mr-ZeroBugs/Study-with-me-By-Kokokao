import type { DayLog } from './storage'

// ═══════════════════════════════════════════════════════════════════
// XP LEVEL SYSTEM
// XP per level n→n+1: 60 + (n-1)*30
// Total XP to reach level n: 15*(n-1)*(n+2)
// ═══════════════════════════════════════════════════════════════════

export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0
  return 15 * (level - 1) * (level + 2)
}

export function getLevelInfo(totalXP: number) {
  let level = 1
  while (totalXpForLevel(level + 1) <= totalXP) {
    level++
    if (level > 9_999) break
  }
  const currentLevelXP = totalXpForLevel(level)
  const nextLevelXP    = totalXpForLevel(level + 1)
  const xpIntoLevel    = totalXP - currentLevelXP
  const xpToNextLevel  = nextLevelXP - currentLevelXP
  const progress       = xpToNextLevel > 0 ? Math.round((xpIntoLevel / xpToNextLevel) * 100) : 100
  return { level, xpIntoLevel, xpToNextLevel, progress }
}

export function levelTitle(level: number): string {
  if (level >= 50) return 'Legendary Scholar'
  if (level >= 40) return 'Grand Sage'
  if (level >= 30) return 'Master Scholar'
  if (level >= 25) return 'Focus Legend'
  if (level >= 20) return 'Deep Thinker'
  if (level >= 15) return 'Study Knight'
  if (level >= 12) return 'Focus Apprentice'
  if (level >=  9) return 'Curious Learner'
  if (level >=  6) return 'Aspiring Student'
  if (level >=  3) return 'New Explorer'
  return 'Rookie Scholar'
}

export function levelAvatarEmoji(level: number): string {
  if (level >= 40) return '👑'
  if (level >= 30) return '🔮'
  if (level >= 20) return '⚔️'
  if (level >= 12) return '📚'
  if (level >=  6) return '🧑‍🎓'
  return '🌱'
}

// ═══════════════════════════════════════════════════════════════════
// DAILY QUEST ENGINE
// ═══════════════════════════════════════════════════════════════════

export type QuestData = {
  todayMinutes: number
  streak: number
  weekMinutes: number
}

export type QuestDef = {
  id: string
  title: string
  desc: string
  xp: number
  gems: number
  progress: (d: QuestData) => number // 0-100
}

export const QUEST_POOL: QuestDef[] = [
  {
    id: 'q_15',
    title: 'Apprentice Warmup',
    desc: 'Study for 15 minutes today',
    xp: 20, gems: 2,
    progress: ({ todayMinutes }) => Math.min(100, Math.round((todayMinutes / 15) * 100)),
  },
  {
    id: 'q_25',
    title: 'Focus Sprint',
    desc: 'Study for 25 minutes today',
    xp: 30, gems: 3,
    progress: ({ todayMinutes }) => Math.min(100, Math.round((todayMinutes / 25) * 100)),
  },
  {
    id: 'q_45',
    title: "Scholar's Deep Dive",
    desc: 'Reach 45 minutes of focus today',
    xp: 50, gems: 5,
    progress: ({ todayMinutes }) => Math.min(100, Math.round((todayMinutes / 45) * 100)),
  },
  {
    id: 'q_60',
    title: 'Hour of Power',
    desc: 'Study for a full hour today',
    xp: 70, gems: 7,
    progress: ({ todayMinutes }) => Math.min(100, Math.round((todayMinutes / 60) * 100)),
  },
  {
    id: 'q_streak',
    title: 'Streak Guardian',
    desc: 'Keep your daily streak alive',
    xp: 25, gems: 3,
    progress: ({ streak }) => streak >= 1 ? 100 : 0,
  },
  {
    id: 'q_week',
    title: 'Weekly Climber',
    desc: 'Add 60 min to your weekly total',
    xp: 35, gems: 4,
    progress: ({ weekMinutes }) => Math.min(100, Math.round((weekMinutes / 60) * 100)),
  },
]

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) & 0x7fff_ffff
    return s / 0x7fff_ffff
  }
}

export function getTodayQuests(dateKey: string): QuestDef[] {
  let hash = 5381
  for (let i = 0; i < dateKey.length; i++) {
    hash = ((hash << 5) + hash) + dateKey.charCodeAt(i)
    hash |= 0
  }
  const rand = seededRandom(Math.abs(hash))
  const pool = [...QUEST_POOL]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 3)
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY BOSS
// ═══════════════════════════════════════════════════════════════════

export const WEEKLY_BOSS_TARGET = 300 // 5 hours

export function getWeekMinutes(logs: DayLog, now: Date): number {
  const dow = now.getDay() // 0=Sun
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
  monday.setHours(0, 0, 0, 0)
  let total = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    total += logs[key] ?? 0
  }
  return total
}

export function getWeekTimeLeft(now: Date): string {
  const dow = now.getDay()
  const daysLeft = dow === 0 ? 0 : 7 - dow
  if (daysLeft === 0) return 'ends tonight'
  if (daysLeft === 1) return '1 day left'
  return `${daysLeft} days left`
}

// ═══════════════════════════════════════════════════════════════════
// ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════

export type AchievementData = {
  totalMinutes: number
  todayMinutes: number
  streak: number
  taskCount: number
  rhythmAnchorCount: number
  level: number
  weekMinutes: number
}

export type Achievement = {
  id: string
  emoji: string
  name: string
  desc: string
  check: (d: AchievementData) => boolean
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_step',   emoji: '🌱', name: 'First Step',       desc: 'Complete your first minute of study',    check: ({ totalMinutes }) => totalMinutes >= 1 },
  { id: 'on_fire',      emoji: '🔥', name: 'On Fire',          desc: 'Maintain a 3-day study streak',          check: ({ streak }) => streak >= 3 },
  { id: 'power_hour',   emoji: '⚡', name: 'Power Hour',       desc: 'Study 60 minutes in one day',            check: ({ todayMinutes }) => todayMinutes >= 60 },
  { id: 'week_warrior', emoji: '🏆', name: 'Week Warrior',     desc: 'Reach a 7-day streak',                   check: ({ streak }) => streak >= 7 },
  { id: 'deep_focus',   emoji: '💎', name: 'Deep Focus',       desc: 'Accumulate 300 total study minutes',     check: ({ totalMinutes }) => totalMinutes >= 300 },
  { id: 'planner_pro',  emoji: '📋', name: 'Planner',          desc: 'Add your first task',                    check: ({ taskCount }) => taskCount >= 1 },
  { id: 'rhythm_set',   emoji: '🧭', name: 'Rhythm Set',       desc: 'Choose your Major and Minor anchors',    check: ({ rhythmAnchorCount }) => rhythmAnchorCount >= 2 },
  { id: 'rising_star',  emoji: '⭐', name: 'Rising Star',      desc: 'Reach Level 5',                          check: ({ level }) => level >= 5 },
  { id: 'legend',       emoji: '🦁', name: 'Legend',           desc: 'Reach Level 10',                         check: ({ level }) => level >= 10 },
  { id: 'boss_slayer',  emoji: '👑', name: 'Boss Slayer',      desc: 'Complete the weekly boss challenge',     check: ({ weekMinutes }) => weekMinutes >= WEEKLY_BOSS_TARGET },
  { id: 'volcano',      emoji: '🌋', name: 'Volcanic Streak',  desc: 'Achieve a 30-day streak',                check: ({ streak }) => streak >= 30 },
  { id: 'century',      emoji: '💯', name: 'Century Club',     desc: 'Study for 100 total hours',              check: ({ totalMinutes }) => totalMinutes >= 6_000 },
]

// ═══════════════════════════════════════════════════════════════════
// PERSISTENT GAME STATE
// ═══════════════════════════════════════════════════════════════════

const GAME_STATE_KEY = 'koko_game_v2'

export type GameState = {
  version: 2
  gems: number
  unlockedAchievements: string[]
  lastSeenLevel: number
  pendingLevelUp: number | null      // level to show in modal; null = none
  pendingAchievements: string[]      // achievement IDs waiting to toast
}

function defaultGameState(): GameState {
  return {
    version: 2,
    gems: 0,
    unlockedAchievements: [],
    lastSeenLevel: 1,
    pendingLevelUp: null,
    pendingAchievements: [],
  }
}

export function loadGameState(): GameState {
  if (typeof window === 'undefined') return defaultGameState()
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(GAME_STATE_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 2) {
      return defaultGameState()
    }

    const candidate = raw as Partial<GameState>
    const knownAchievementIds = new Set(ACHIEVEMENTS.map((achievement) => achievement.id))
    const sanitizeAchievementIds = (value: unknown) => (
      Array.isArray(value)
        ? [...new Set(value.filter((id): id is string => typeof id === 'string' && knownAchievementIds.has(id)))]
        : []
    )

    return {
      version: 2,
      gems: Number.isFinite(candidate.gems) ? Math.max(0, Math.floor(candidate.gems ?? 0)) : 0,
      unlockedAchievements: sanitizeAchievementIds(candidate.unlockedAchievements),
      lastSeenLevel: Number.isFinite(candidate.lastSeenLevel)
        ? Math.max(1, Math.floor(candidate.lastSeenLevel ?? 1))
        : 1,
      pendingLevelUp: Number.isFinite(candidate.pendingLevelUp)
        ? Math.max(1, Math.floor(candidate.pendingLevelUp as number))
        : null,
      pendingAchievements: sanitizeAchievementIds(candidate.pendingAchievements),
    }
  } catch { return defaultGameState() }
}

export function saveGameState(state: GameState): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(GAME_STATE_KEY, JSON.stringify(state)) } catch {}
}

// Reconcile stored state against live study data.
// Returns updated state + list of newly-unlocked achievement IDs.
export function reconcileGameState(
  current: GameState,
  currentLevel: number,
  achievementData: AchievementData,
): { state: GameState; newlyUnlocked: string[] } {
  const unlocked = new Set(current.unlockedAchievements)
  const newlyUnlocked: string[] = []

  for (const ach of ACHIEVEMENTS) {
    if (!unlocked.has(ach.id) && ach.check(achievementData)) {
      unlocked.add(ach.id)
      newlyUnlocked.push(ach.id)
    }
  }

  const didLevelUp   = currentLevel > current.lastSeenLevel
  const levelsGained = didLevelUp ? currentLevel - current.lastSeenLevel : 0

  const state: GameState = {
    ...current,
    gems: current.gems + levelsGained * 5 + newlyUnlocked.length * 10,
    unlockedAchievements: Array.from(unlocked),
    lastSeenLevel: Math.max(current.lastSeenLevel, currentLevel),
    pendingLevelUp: didLevelUp ? currentLevel : current.pendingLevelUp,
    pendingAchievements: [...current.pendingAchievements, ...newlyUnlocked],
  }

  return { state, newlyUnlocked }
}
