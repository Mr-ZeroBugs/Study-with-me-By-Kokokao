# Study with me · Cozy Focus Timer

> A cozy, aesthetic, and production-ready study timer built with Next.js 16, Tailwind CSS, Web Audio, and Supabase.

![Study with me](public/placeholder-logo.svg)

---

## ✨ Features

- 🌿 **Cozy & Minimalist Aesthetic:** Pastel paper-card design with warm, comforting focus vibes.
- ⏱️ **Accurate Timestamp-based Timer:** No drift or pause when switching tabs or backgrounding on mobile.
  - **Count Up (Flow Mode):** Open-ended deep focus sessions with optional interval reminders.
  - **Countdown Mode:** Classic Pomodoro (25 min), Short Break (5 min), and Long Break (15 min).
  - **Extensions:** Built-in support for Pomodoro & 52/17 study rules.
- 🔔 **In-Browser Web Audio Chime:** Pleasant Tibetan singing bowl / bell harmonic tones on session completion.
- ☁️ **Supabase Cloud Sync:**
  - **Guest Mode:** Instant offline-first tracking saved to `LocalStorage`.
  - **Cloud Mode:** Sign in to sync your study logs, streak, and daily history across all devices.
- 📅 **Study Archive Calendar & Streak Tracker:** Visual heatmap of daily minutes and study habits.
- 📚 **Subject Tracking:** Create subjects before a session, keep each subject's focus time separate, and inspect the split by 7 days, 30 days, or all time.
- 🥧 **Focus Mix & Study Analytics:** Interactive subject donut chart plus time-window summaries, focus/pause timeline, and a detailed study calendar.
- 🗂️ **Planning Hub:** Deadline-aware tasks, long-term goals broken into milestones, and a timeline for competitions, projects, exams, and important dates.
- 🧭 **Separate App Pages:** Focus, Tasks, Goals, Events, and Stats each have their own route with a modern bottom navigation bar.
- 🎊 **Confetti Celebration:** Soft pastel celebration upon completing focus milestones.

---

## 🚀 Tech Stack

- **Framework:** [Next.js 16 (App Router)](https://nextjs.org/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Database & Auth:** [Supabase](https://supabase.com/)
- **Audio Engine:** Web Audio API (Synthesized in-browser)
- **Effects:** Canvas Confetti

---

## 🛠️ Getting Started

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Mr-ZeroBugs/Study-with-me-By-Kokokao.git
cd Study-with-me-By-Kokokao
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your Supabase project credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Setup Supabase Database Schema
Run the SQL migrations in your [Supabase SQL Editor](https://supabase.com/dashboard) in this order:

1. `supabase/001_schema.sql`
2. `supabase/002_line_integration.sql`
3. `supabase/003_ontology_v0.sql`
4. `supabase/004_ontology_v1_subject_refs.sql`
5. `supabase/005_task_intelligence_v0.sql`
6. `supabase/006_adaptive_planner_v0.sql`
7. `supabase/007_personal_memory_v0.sql`
8. `supabase/008_personal_ontology_snapshot_v1.sql`
9. `supabase/009_reminder_delivery_v0.sql`
10. `supabase/010_personal_memory_v1_lifecycle.sql`
11. `supabase/011_manager_feedback_v0.sql`

The last four migrations add the versioned per-account Personal Ontology snapshot, idempotent LINE delivery protection, private-memory lifecycle, and AI action-feedback loop used by the AI and reminder system.

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser.

---

## 📄 License
MIT License. Made with ♡ for lovely learners.
