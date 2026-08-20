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
Run the SQL script in `supabase/schema.sql` inside your [Supabase SQL Editor](https://supabase.com/dashboard).

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser.

---

## 📄 License
MIT License. Made with ♡ for lovely learners.
