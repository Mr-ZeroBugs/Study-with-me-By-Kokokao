'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Clock3, Flame, Pause, Play, Sparkles } from 'lucide-react'
import { getLocalDateKey, type DayLog, type StudyInterval } from '../lib/storage'
import { getIntensityThreshold } from '../lib/theme'

export type StatsRange = 'days' | 'weeks' | 'month' | 'year' | 'all'

const DAY_MS = 86_400_000
const rangeOptions: Array<{ value: StatsRange; label: string }> = [
  { value: 'days', label: 'days' },
  { value: 'weeks', label: 'weeks' },
  { value: 'month', label: 'month' },
  { value: 'year', label: 'year' },
  { value: 'all', label: 'all time' },
]

type TimelineBlock = { kind: 'study' | 'break'; start: number; end: number }

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return formatMinutes(Math.round(seconds / 60))
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1, 12)
}

function keyFromDate(date: Date) {
  return getLocalDateKey(date)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

function getMonday(date: Date) {
  const monday = startOfDay(date)
  const day = monday.getDay()
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1))
  return monday
}

function dateLabel(key: string) {
  return dateFromKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function calendarParts(year: number, month: number) {
  const first = new Date(year, month, 1).getDay()
  const count = new Date(year, month + 1, 0).getDate()
  return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
}

/** Scale 5 intensity levels relative to a user-defined "high" threshold (minutes).
 *  level-5 = ≥ threshold, then each level is ⅕ step down.
 */
function intensityLevel(minutes: number, highThreshold: number = 90) {
  if (minutes <= 0) return 0
  const step = highThreshold / 5
  if (minutes < step)           return 1
  if (minutes < step * 2)       return 2
  if (minutes < step * 3)       return 3
  if (minutes < highThreshold)  return 4
  return 5
}

function rangeName(range: StatsRange) {
  if (range === 'days') return 'last 7 days'
  if (range === 'weeks') return 'last 8 weeks'
  if (range === 'month') return 'this month'
  if (range === 'year') return 'this year'
  return 'all time'
}

function getRangeSeries(range: StatsRange, referenceDate: Date, minutesForDate: (key: string) => number, allDateKeys: string[]) {
  const today = startOfDay(referenceDate)
  if (range === 'days') {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (6 - index))
      const key = keyFromDate(date)
      return { key, label: date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2), minutes: minutesForDate(key), dateKeys: [key] }
    })
  }

  if (range === 'weeks') {
    const currentMonday = getMonday(today)
    return Array.from({ length: 8 }, (_, index) => {
      const start = new Date(currentMonday)
      start.setDate(currentMonday.getDate() - (7 * (7 - index)))
      const dateKeys: string[] = []
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(start)
        date.setDate(start.getDate() + day)
        dateKeys.push(keyFromDate(date))
      }
      return { key: keyFromDate(start), label: `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}`, minutes: dateKeys.reduce((sum, key) => sum + minutesForDate(key), 0), dateKeys }
    })
  }

  if (range === 'month') {
    const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), index + 1, 12)
      const key = keyFromDate(date)
      return { key, label: String(index + 1), minutes: minutesForDate(key), dateKeys: [key] }
    })
  }

  if (range === 'year') {
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(today.getFullYear(), index, 1, 12)
      const dateKeys: string[] = []
      const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      for (let day = 1; day <= count; day += 1) dateKeys.push(keyFromDate(new Date(date.getFullYear(), date.getMonth(), day, 12)))
      return { key: keyFromDate(date), label: date.toLocaleDateString('en-US', { month: 'short' }), minutes: dateKeys.reduce((sum, key) => sum + minutesForDate(key), 0), dateKeys }
    })
  }

  const monthKeys = Array.from(new Set(allDateKeys.map((key) => key.slice(0, 7)))).sort()
  const visibleMonths = monthKeys.length ? monthKeys.slice(-12) : [keyFromDate(today).slice(0, 7)]
  return visibleMonths.map((monthKey) => {
    const [year, month] = monthKey.split('-').map(Number)
    const count = new Date(year, month, 0).getDate()
    const dateKeys = Array.from({ length: count }, (_, index) => keyFromDate(new Date(year, month - 1, index + 1, 12)))
    return { key: `${monthKey}-01`, label: new Date(year, month - 1, 1, 12).toLocaleDateString('en-US', { month: 'short' }), minutes: dateKeys.reduce((sum, key) => sum + minutesForDate(key), 0), dateKeys }
  })
}

function intervalTimestamps(interval: StudyInterval) {
  const start = Date.parse(interval.startedAt)
  const end = Date.parse(interval.endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

export function StatsInsights({ logs, intervals, range, onRangeChange }: { logs: DayLog; intervals: StudyInterval[]; range: StatsRange; onRangeChange: (range: StatsRange) => void }) {
  const [referenceDate, setReferenceDate] = useState(() => new Date(2000, 0, 1, 12))
  const [selectedDateKey, setSelectedDateKey] = useState('2000-01-01')
  const [calendarDate, setCalendarDate] = useState(() => new Date(2000, 0, 1, 12))
  const [highThreshold, setHighThreshold] = useState(90) // updated from localStorage on mount

  useEffect(() => {
    const current = new Date()
    setReferenceDate(current)
    setSelectedDateKey(keyFromDate(current))
    setCalendarDate(new Date(current.getFullYear(), current.getMonth(), current.getDate(), 12))
    setHighThreshold(getIntensityThreshold())
  }, [])

  // Sync threshold when user changes it in Settings (same-page StorageEvent)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'study_intensity_threshold' && e.newValue) {
        const val = parseInt(e.newValue, 10)
        if (Number.isFinite(val) && val >= 15) setHighThreshold(val)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const intervalMinutesByDay = useMemo(() => intervals.reduce<Record<string, number>>((totals, interval) => {
    const timestamps = intervalTimestamps(interval)
    if (!timestamps) return totals
    if (interval.mode !== 'focus') return totals
    const key = keyFromDate(new Date(timestamps.start))
    totals[key] = (totals[key] ?? 0) + interval.durationSeconds / 60
    return totals
  }, {}), [intervals])

  const allDateKeys = useMemo(() => Array.from(new Set([...Object.keys(logs), ...Object.keys(intervalMinutesByDay)])), [intervalMinutesByDay, logs])
  const minutesForDate = (key: string) => Math.max(logs[key] ?? 0, Math.round(intervalMinutesByDay[key] ?? 0))
  const series = useMemo(() => getRangeSeries(range, referenceDate, minutesForDate, allDateKeys), [allDateKeys, intervalMinutesByDay, logs, range, referenceDate])
  const selectedRangeKeys = useMemo(() => range === 'all' ? allDateKeys : Array.from(new Set(series.flatMap((point) => point.dateKeys))), [allDateKeys, range, series])
  const selectedRangeKeySet = useMemo(() => new Set(selectedRangeKeys), [selectedRangeKeys])
  const totalMinutes = selectedRangeKeys.reduce((sum, key) => sum + minutesForDate(key), 0)
  const activeDays = selectedRangeKeys.filter((key) => minutesForDate(key) > 0).length
  const maxFocusSeconds = intervals.reduce((max, interval) => {
    const timestamps = intervalTimestamps(interval)
    if (!timestamps || interval.mode !== 'focus' || interval.timerMode !== 'flow' || !selectedRangeKeySet.has(keyFromDate(new Date(timestamps.start)))) return max
    return Math.max(max, interval.durationSeconds)
  }, 0)

  const selectedDayIntervals = useMemo(() => {
    const dayStart = dateFromKey(selectedDateKey).getTime()
    const dayEnd = dayStart + DAY_MS
    return intervals.map((interval) => {
      const timestamps = intervalTimestamps(interval)
      if (!timestamps || timestamps.end <= dayStart || timestamps.start >= dayEnd) return null
      return { ...timestamps, mode: interval.mode, start: Math.max(dayStart, timestamps.start), end: Math.min(dayEnd, timestamps.end) }
    }).filter((item): item is { start: number; end: number; mode: StudyInterval['mode'] } => Boolean(item)).sort((a, b) => a.start - b.start)
  }, [intervals, selectedDateKey])

  const timelineBlocks = useMemo(() => {
    const blocks: TimelineBlock[] = []
    let cursor: number | null = null
    for (const interval of selectedDayIntervals) {
      if (interval.mode !== 'focus') {
        blocks.push({ kind: 'break', start: interval.start, end: interval.end })
        cursor = Math.max(cursor ?? interval.end, interval.end)
        continue
      }
      if (cursor !== null && interval.start - cursor >= 60_000) blocks.push({ kind: 'break', start: cursor, end: interval.start })
      blocks.push({ kind: 'study', start: interval.start, end: interval.end })
      cursor = Math.max(cursor ?? interval.end, interval.end)
    }
    return blocks
  }, [selectedDayIntervals])

  const calendarRangeDays = useMemo(() => {
    if (range !== 'days' && range !== 'weeks') return []
    const count = range === 'days' ? 7 : 56
    const end = startOfDay(calendarDate)
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(end)
      date.setDate(end.getDate() - (count - 1 - index))
      return date
    })
  }, [calendarDate, range])
  const allCalendarYears = useMemo(() => {
    const currentYear = referenceDate.getFullYear()
    const recordedYears = allDateKeys.map((key) => Number(key.slice(0, 4))).filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100)
    const firstYear = recordedYears.length ? Math.min(currentYear, ...recordedYears) : currentYear
    const lastYear = recordedYears.length ? Math.max(currentYear, ...recordedYears) : currentYear
    return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
  }, [allDateKeys, referenceDate])
  const selectedDayMinutes = minutesForDate(selectedDateKey)
  const selectedDayLabel = dateLabel(selectedDateKey)
  const rangeLabel = rangeName(range)
  const calendarWide = range === 'year' || range === 'all'
  const calendarPeriodLabel = useMemo(() => {
    if (range === 'month') return monthLabel(calendarDate)
    if (range === 'year') return String(calendarDate.getFullYear())
    if (range === 'all') return allCalendarYears.length > 1 ? `${allCalendarYears[0]}–${allCalendarYears.at(-1)}` : String(allCalendarYears[0])
    if (!calendarRangeDays.length) return ''
    const first = calendarRangeDays[0]
    const last = calendarRangeDays.at(-1) ?? first
    const firstLabel = first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const lastLabel = last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${firstLabel} – ${lastLabel}`
  }, [allCalendarYears, calendarDate, calendarRangeDays, range])

  const moveSelectedDay = (offset: number) => {
    const next = dateFromKey(selectedDateKey)
    next.setDate(next.getDate() + offset)
    setSelectedDateKey(keyFromDate(next))
    setCalendarDate(new Date(next.getFullYear(), next.getMonth(), next.getDate(), 12))
  }

  const jumpToToday = () => {
    const key = keyFromDate(referenceDate)
    setSelectedDateKey(key)
    setCalendarDate(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12))
  }

  const selectRange = (nextRange: StatsRange) => {
    onRangeChange(nextRange)
    setCalendarDate(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12))
  }

  const moveCalendar = (direction: -1 | 1) => {
    const next = new Date(calendarDate)
    if (range === 'days') next.setDate(next.getDate() + direction * 7)
    if (range === 'weeks') next.setDate(next.getDate() + direction * 56)
    if (range === 'month') next.setMonth(next.getMonth() + direction, 1)
    if (range === 'year') next.setFullYear(next.getFullYear() + direction, 0, 1)
    setCalendarDate(next)
  }

  const calendarDayButton = (date: Date, compact = false) => {
    const dateKey = keyFromDate(date)
    const minutes = minutesForDate(dateKey)
    const level = intensityLevel(minutes, highThreshold)
    return <button key={dateKey} className={`stats-calendar-day level-${level} ${compact ? 'compact' : ''} ${selectedDateKey === dateKey ? 'selected' : ''}`} onClick={() => setSelectedDateKey(dateKey)} aria-label={`${dateLabel(dateKey)}: ${minutes ? formatMinutes(minutes) : 'no study time'}`}><strong>{date.getDate()}</strong>{minutes > 0 && <small>{formatMinutes(minutes)}</small>}</button>
  }

  const monthCalendar = (year: number, month: number, compact = false) => <section className={`stats-mini-month ${compact ? 'compact' : ''}`} key={`${year}-${month}`}><h4>{new Date(year, month, 1, 12).toLocaleDateString('en-US', { month: 'long' })}</h4><div className="stats-calendar-weekdays">{['s', 'm', 't', 'w', 't', 'f', 's'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="stats-calendar-grid">{calendarParts(year, month).map((day, index) => day ? calendarDayButton(new Date(year, month, day, 12), compact) : <span className={`stats-calendar-day empty ${compact ? 'compact' : ''}`} key={`empty-${year}-${month}-${index}`} />)}</div></section>

  return (
    <section className="stats-insights" aria-labelledby="stats-insights-heading">
      <div className="stats-insights-heading">
        <div>
          <p className="eyebrow">look at the whole rhythm</p>
          <h2 id="stats-insights-heading" className="font-display">your study analytics</h2>
          <p>Choose a window, then zoom into any day to see when you studied and when you paused.</p>
        </div>
        <div className="stats-range-tabs" role="group" aria-label="Choose statistics period">
          {rangeOptions.map((option) => <button key={option.value} aria-pressed={range === option.value} className={range === option.value ? 'active' : ''} onClick={() => selectRange(option.value)}>{option.label}</button>)}
        </div>
      </div>

      <div className="stats-kpi-grid">
        <div className="paper-card stats-kpi total"><span className="stats-kpi-icon"><Clock3 className="size-4" /></span><p className="eyebrow">{rangeLabel}</p><strong>{formatMinutes(totalMinutes)}</strong><span>total study time</span></div>
        <div className="paper-card stats-kpi longest"><span className="stats-kpi-icon"><Activity className="size-4" /></span><p className="eyebrow">open-ended focus</p><strong>{maxFocusSeconds ? formatSeconds(maxFocusSeconds) : '—'}</strong><span>{maxFocusSeconds ? 'max uninterrupted flow' : 'tracked from new flow sessions'}</span></div>
        <div className="paper-card stats-kpi active-days"><span className="stats-kpi-icon"><Flame className="size-4" /></span><p className="eyebrow">showing up</p><strong>{activeDays}</strong><span>{activeDays === 1 ? 'active day' : 'active days'}</span></div>
      </div>

      <div className={`stats-detail-grid ${calendarWide ? 'calendar-wide' : ''}`}>
        <section className="paper-card stats-timeline-card" aria-labelledby="timeline-heading">
          <div className="stats-panel-heading"><div><p className="eyebrow">study · pause · repeat</p><h3 id="timeline-heading">day timeline</h3></div><div className="stats-day-controls"><button aria-label="Previous day" onClick={() => moveSelectedDay(-1)}><ChevronLeft className="size-4" /></button><input aria-label="Choose a day for timeline" type="date" value={selectedDateKey} onChange={(event) => { setSelectedDateKey(event.target.value); const date = dateFromKey(event.target.value); setCalendarDate(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)) }} /><button aria-label="Next day" onClick={() => moveSelectedDay(1)}><ChevronRight className="size-4" /></button></div></div>
          <div className="stats-timeline-meta"><strong>{selectedDayLabel}</strong><span>{formatMinutes(selectedDayMinutes)} studied that day</span><button onClick={jumpToToday}>today</button></div>
          {timelineBlocks.length ? <div className="stats-timeline-chart"><svg className="stats-timeline-svg" width="960" height="220" viewBox="0 0 960 220" preserveAspectRatio="none" role="img" aria-label={`Study and pause timeline for ${selectedDayLabel}`}>
            <rect x="52" y="38" width="874" height="116" rx="14" fill="#fffaf2" />
            <text x="52" y="25" className="timeline-axis-title">focus timeline</text>
            {timelineBlocks.map((block, index) => { const dayStart = dateFromKey(selectedDateKey).getTime(); const x = 52 + ((block.start - dayStart) / DAY_MS) * 874; const width = Math.max(2, ((block.end - block.start) / DAY_MS) * 874); return block.kind === 'study' ? <rect key={`${block.kind}-${index}`} x={x} y="63" width={width} height="57" rx="9" className="timeline-study-block" /> : <rect key={`${block.kind}-${index}`} x={x} y="126" width={width} height="12" rx="6" className="timeline-break-block" /> })}
            <line x1="52" x2="926" y1="154" y2="154" className="timeline-axis-line" />
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => { const x = 52 + (hour / 24) * 874; return <g key={hour}><line x1={x} x2={x} y1="150" y2="160" className="timeline-tick" /><text x={x} y="181" textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'} className="timeline-hour">{hour === 24 ? 'midnight' : `${String(hour).padStart(2, '0')}:00`}</text></g> })}
          </svg><div className="timeline-legend"><span><i className="timeline-study-swatch" /><Play className="size-3" /> study</span><span><i className="timeline-break-swatch" /><Pause className="size-3" /> pause / gap</span></div></div> : <div className="stats-timeline-empty"><Activity className="stats-timeline-empty-icon size-5" /><strong>No start/stop segments for this day yet.</strong><p>Run the timer, pause it, and this timeline will draw your real rhythm here.</p></div>}
        </section>

        <section className={`paper-card stats-calendar-card ${calendarWide ? 'calendar-wide' : ''}`} aria-labelledby="stats-calendar-heading">
          <div className="stats-panel-heading"><div><p className="eyebrow">your little archive</p><h3 id="stats-calendar-heading">study calendar</h3></div><CalendarDays className="size-5 stats-calendar-icon" /></div>
          <div className="stats-calendar-nav">{range !== 'all' ? <button aria-label={`Previous ${range}`} onClick={() => moveCalendar(-1)}><ChevronLeft className="size-4" /></button> : <span />}<strong>{calendarPeriodLabel}</strong>{range !== 'all' ? <button aria-label={`Next ${range}`} onClick={() => moveCalendar(1)}><ChevronRight className="size-4" /></button> : <span />}</div>
          {range === 'days' && <div className="stats-period-days days-view">{calendarRangeDays.map((date) => <div className="stats-period-day" key={keyFromDate(date)}><span>{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>{calendarDayButton(date)}<small>{date.toLocaleDateString('en-US', { month: 'short' })}</small></div>)}</div>}
          {range === 'weeks' && <><div className="stats-calendar-weekdays">{['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="stats-period-days weeks-view">{calendarRangeDays.map((date) => calendarDayButton(date, true))}</div></>}
          {range === 'month' && <div className="stats-calendar-months single">{monthCalendar(calendarDate.getFullYear(), calendarDate.getMonth())}</div>}
          {range === 'year' && <div className="stats-calendar-months year-view">{Array.from({ length: 12 }, (_, month) => monthCalendar(calendarDate.getFullYear(), month, true))}</div>}
          {range === 'all' && <div className="stats-calendar-years">{allCalendarYears.map((year) => <section className="stats-calendar-year" key={year}><h4>{year}</h4><div className="stats-calendar-months year-view">{Array.from({ length: 12 }, (_, month) => monthCalendar(year, month, true))}</div></section>)}</div>}
          <div className="stats-calendar-legend"><span>less</span>{[0, 1, 2, 3, 4, 5].map((level) => <i key={level} className={`level-${level}`} />)}<span>more</span></div>
          <p className="stats-calendar-note"><Sparkles className="size-3.5" /> calendar follows the selected range · click any day to open its timeline</p>
        </section>
      </div>
    </section>
  )
}
