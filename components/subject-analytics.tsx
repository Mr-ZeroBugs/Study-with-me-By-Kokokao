'use client'

import { useMemo, useState } from 'react'
import { BarChart3, BookOpen, CalendarRange, Check, Clock3 } from 'lucide-react'
import { type SubjectDayLogs } from '../lib/storage'
import type { StatsRange } from './stats-insights'

const subjectColors = ['#ee8d92', '#8fcdb0', '#f1c965', '#b998d0', '#e7a77d', '#86b9d6', '#db9bb4']

export type CanonicalSubjectAnalytics = {
  id: string
  name: string
  days: SubjectDayLogs[string]
  groups: string[]
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function dateIsInRange(dateKey: string, range: StatsRange) {
  if (range === 'all') return true
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(`${dateKey}T00:00:00`)
  if (range === 'month') return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()
  if (range === 'year') return date.getFullYear() === today.getFullYear()
  const start = new Date(today)
  if (range === 'days') start.setDate(today.getDate() - 6)
  if (range === 'weeks') start.setDate(today.getDate() - 55)
  return date >= start && date <= today
}

export function SubjectAnalytics({ subjectLogs, subjects, canonicalSubjects = [], range }: { subjectLogs: SubjectDayLogs; subjects: string[]; canonicalSubjects?: CanonicalSubjectAnalytics[]; range: StatsRange }) {
  const [activeSubject, setActiveSubject] = useState<string | null>(null)
  const [view, setView] = useState<'subjects' | 'groups'>('subjects')
  const activeRange = range
  const isCanonical = canonicalSubjects.length > 0

  const breakdown = useMemo(() => {
    if (isCanonical) {
      const rows = canonicalSubjects.map((subject, index) => ({
        id: subject.id,
        subject: subject.name,
        groups: subject.groups,
        minutes: Object.entries(subject.days).reduce(
          (sum, [dateKey, minutes]) => sum + (dateIsInRange(dateKey, activeRange) ? minutes : 0),
          0,
        ),
        color: subjectColors[index % subjectColors.length],
      })).filter((item) => item.minutes > 0)
      if (view === 'subjects') return rows.sort((a, b) => b.minutes - a.minutes)
      const grouped = new Map<string, { id: string; subject: string; groups: string[]; minutes: number; color: string }>()
      for (const row of rows) {
        const names = row.groups.length ? row.groups : ['Un-grouped']
        for (const name of names) {
          const current = grouped.get(name) ?? { id: `group:${name}`, subject: name, groups: [], minutes: 0, color: subjectColors[grouped.size % subjectColors.length] }
          current.minutes += row.minutes
          grouped.set(name, current)
        }
      }
      return [...grouped.values()].sort((a, b) => b.minutes - a.minutes)
    }
    const names = Array.from(new Set([...subjects, ...Object.keys(subjectLogs)]))
    return names.map((subject, index) => ({
      id: subject,
      subject,
      groups: [],
      minutes: Object.entries(subjectLogs[subject] ?? {}).reduce(
        (sum, [dateKey, minutes]) => sum + (dateIsInRange(dateKey, activeRange) ? minutes : 0),
        0
      ),
      color: subjectColors[index % subjectColors.length],
    })).filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes)
  }, [activeRange, canonicalSubjects, isCanonical, subjectLogs, subjects, view])

  const total = breakdown.reduce((sum, item) => sum + item.minutes, 0)
  const selected = breakdown.find((item) => item.id === activeSubject) ?? breakdown[0]
  let cursor = 0
  const gradient = total
    ? breakdown.map((item) => {
        const start = cursor
        cursor += (item.minutes / total) * 100
        return `${item.color} ${start}% ${cursor}%`
      }).join(', ')
    : '#f0e1d8 0 100%'

  const rangeLabel = activeRange === 'days' ? 'last 7 days' : activeRange === 'weeks' ? 'last 8 weeks' : activeRange === 'month' ? 'this month' : activeRange === 'year' ? 'this year' : 'all time'

  return (
    <section className="paper-card subject-analytics mt-5" aria-labelledby="subject-analytics-heading">
      <div className="subject-analytics-header">
        <div>
          <p className="eyebrow">where your focus goes</p>
          <h2 id="subject-analytics-heading" className="font-display text-2xl font-bold">subject breakdown</h2>
          <p className="mt-2 text-sm text-muted-ink">See which subjects are getting your best energy.</p>
        </div>
        <div className="flex items-center gap-2"><span className="subject-range-note">{rangeLabel}</span>{isCanonical && <div className="flex rounded-full border border-line p-0.5 text-[10px]"><button className={`rounded-full px-2 py-1 ${view === 'subjects' ? 'bg-paper text-ink shadow-sm' : 'text-muted-ink'}`} onClick={() => { setView('subjects'); setActiveSubject(null) }}>subjects</button><button className={`rounded-full px-2 py-1 ${view === 'groups' ? 'bg-paper text-ink shadow-sm' : 'text-muted-ink'}`} onClick={() => { setView('groups'); setActiveSubject(null) }}>groups</button></div>}</div>
      </div>

      {total > 0 ? <div className="subject-analytics-body">
        <div className="donut-wrap">
          <div className="donut-chart" style={{ background: `conic-gradient(${gradient})` }} aria-label={`Subject focus for ${rangeLabel}`}>
            <div className="donut-center"><strong>{selected ? `${Math.round((selected.minutes / total) * 100)}%` : '0%'}</strong><span>{selected?.subject ?? 'no subject'}</span></div>
          </div>
          <p className="donut-caption"><CalendarRange className="size-3.5" /> {rangeLabel}</p>
        </div>
        <div className="subject-list">
          {breakdown.map((item) => {
            const percentage = Math.round((item.minutes / total) * 100)
            const isActive = selected?.id === item.id
            return <button key={item.id} aria-pressed={isActive} className={`subject-row ${isActive ? 'active' : ''}`} onClick={() => setActiveSubject(item.id)}>
              <span className="subject-swatch" style={{ background: item.color }} />
              <span className="subject-row-name">{item.subject}</span>
              <span className="subject-row-time">{formatMinutes(item.minutes)}</span>
              <strong>{percentage}%</strong>
              {isActive && <Check className="size-3.5" />}
            </button>
          })}
          <div className="subject-total"><Clock3 className="size-4" /><span>{formatMinutes(total)} total focus</span></div>
        </div>
      </div> : <div className="subject-empty"><BookOpen className="size-5" /><div><strong>Your subject story starts here.</strong><p>Pick a subject above and start a focus round to see the split.</p></div></div>}
      <div className="subject-analytics-footer"><BarChart3 className="size-4" /> Tap a subject to spotlight its share of your focus.</div>
    </section>
  )
}
