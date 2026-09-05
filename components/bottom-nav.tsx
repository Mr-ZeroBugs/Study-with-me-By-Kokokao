'use client'

import Link from 'next/link'
import { BarChart3, LayoutDashboard, ListTodo, Clock3, Target } from 'lucide-react'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/focus', label: 'Focus', icon: Clock3 },
  { href: '/planner', label: 'Planner', icon: ListTodo },
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/goals', label: 'Rhythm', icon: Target },
  { href: '/stats', label: 'Stats', icon: BarChart3 },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <div className="bottom-nav-inner">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return <Link key={href} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            <Icon className="size-[18px]" />
            <span>{label}</span>
          </Link>
        })}
      </div>
    </nav>
  )
}
