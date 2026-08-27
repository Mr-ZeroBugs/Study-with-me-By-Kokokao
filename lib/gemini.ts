export type GeminiAnalysisResult =
  | {
      action: 'ADD_TODO'
      title: string
      subject: string
      dueDate: string // YYYY-MM-DD
      priority: 1 | 2 | 3
      estimatedMinutes: number
      aiComment: string
    }
  | {
      action: 'ADD_EVENT'
      title: string
      eventDate: string // YYYY-MM-DD
      type: 'competition' | 'project' | 'exam' | 'important'
      notes: string
      aiComment: string
    }
  | {
      action: 'COMPLETE_TASK'
      taskQuery: string
      aiComment?: string
    }
  | {
      action: 'LIST_TODOS'
    }
  | {
      action: 'LIST_EVENTS'
    }
  | {
      action: 'CHAT'
      replyText: string
    }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

/**
 * Analyzes natural language message from LINE user using Google Gemini AI.
 */
export async function analyzeUserMessageWithGemini(
  userMessage: string,
  todayStr: string
): Promise<GeminiAnalysisResult | null> {
  if (!GEMINI_API_KEY) {
    return null
  }

  const prompt = `
You are Study Manager.koko, a kind, supportive, and intelligent study companion for a student timer & planner app.
Your public identity is always "Study Manager.koko". Never mention Gemini, Google, an API, a model, or any underlying provider. If the student asks who you are, introduce yourself as Study Manager.koko.
Today's local date is: ${todayStr} (YYYY-MM-DD).

Analyze the student's message (mostly in Thai or English) and classify their intent into one of these actions:

1. "ADD_TODO": Student wants to add a to-do, task, homework, revision goal, or reminder.
   - Extract: title (clean task name without dates/commands), subject (e.g. Math, Biology, General, English), dueDate (YYYY-MM-DD, relative to today), priority (1=easy/low, 2=normal/medium, 3=urgent/high/important), estimatedMinutes (integer, default 25), aiComment (short cute Thai encouragement 1 sentence).

2. "ADD_EVENT": Student mentions an exam date, competition, major project milestone, contest, or important date.
   - Extract: title, eventDate (YYYY-MM-DD), type ("competition" | "project" | "exam" | "important"), notes, aiComment (short cute Thai encouragement).

3. "COMPLETE_TASK": Student says they finished or completed a task (e.g. "ทำเลขเสร็จแล้ว", "อ่านชีวะจบแล้ว", "done math").
   - Extract: taskQuery (the keywords/name of the completed task).

4. "LIST_TODOS": Student asks to see their tasks, homework, to-dos (e.g. "มีงานอะไรบ้าง", "ขอดูดิ", "list", "today").

5. "LIST_EVENTS": Student asks about upcoming exams, competitions, dates (e.g. "มีสอบวันไหนบ้าง", "มีนัดอะไรบ้าง", "events").

6. "CHAT": General greeting, small talk, question, feeling stressed, asking for study motivation or tips.
   - Extract: replyText (a warm, cozy, helpful, encouraging Thai reply with cute emojis).

Respond strictly with valid JSON only conforming to this TypeScript schema:
{
  "action": "ADD_TODO" | "ADD_EVENT" | "COMPLETE_TASK" | "LIST_TODOS" | "LIST_EVENTS" | "CHAT",
  "title": string (if ADD_TODO or ADD_EVENT),
  "subject": string (if ADD_TODO),
  "dueDate": string (YYYY-MM-DD if ADD_TODO),
  "priority": 1 | 2 | 3 (if ADD_TODO),
  "estimatedMinutes": number (if ADD_TODO),
  "eventDate": string (YYYY-MM-DD if ADD_EVENT),
  "type": "competition" | "project" | "exam" | "important" (if ADD_EVENT),
  "notes": string (if ADD_EVENT),
  "taskQuery": string (if COMPLETE_TASK),
  "aiComment": string (optional cute phrase),
  "replyText": string (if CHAT)
}

User Message: "${userMessage.replace(/"/g, '\\"')}"
`

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    })

    if (!response.ok) {
      // Fallback to gemini-1.5-flash if 2.5-flash endpoint differs
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`
      const fbResponse = await fetch(fallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
      })

      if (!fbResponse.ok) {
        console.error('Gemini API error:', await fbResponse.text())
        return null
      }
      const data = await fbResponse.json()
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
      return rawText ? JSON.parse(rawText) : null
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return rawText ? JSON.parse(rawText) : null
  } catch (error) {
    console.error('Failed to parse message with Gemini:', error)
    return null
  }
}
