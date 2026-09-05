import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { compilePersonalOntologySnapshot, personalOntologyPrompt } from '@/lib/personal-ontology-context'
import { normalizeSubjectName, subjectKey } from '@/lib/task-intelligence'
import type { LineWorkspaceContext } from '@/lib/line-workspaces'

export type LineAiContext = {
  subjectNames: string[]
  subjectIds: Record<string, string>
  prompt: string
}

const generalSubject = 'General'

/** LINE is one consumer of the same account-scoped Ontology used elsewhere. */
export async function loadLineAiContext(
  client: SupabaseClient,
  userId: string,
  workspaces: LineWorkspaceContext,
): Promise<LineAiContext> {
  try {
    const snapshot = await compilePersonalOntologySnapshot(client, userId, { workspaceContext: workspaces, persist: true })
    return {
      subjectNames: Array.from(new Set([generalSubject, ...snapshot.objects.subjects.map((subject) => subject.name)])),
      subjectIds: Object.fromEntries(snapshot.objects.subjects.map((subject) => [subject.name, subject.id])),
      prompt: personalOntologyPrompt(snapshot),
    }
  } catch (error) {
    console.info('LINE is using the minimal Ontology context:', error)
    return {
      subjectNames: [generalSubject],
      subjectIds: {},
      prompt: 'PERSONAL_ONTOLOGY_SNAPSHOT\n{"objects":{"subjects":[{"id":"general","name":"General"}]},"policies":{"unknownSubjectFallback":"General","aiMayCreateSubjects":false}}',
    }
  }
}

/** Never invent a subject from a LINE message. Prefer a canonical label; otherwise General. */
export function resolveLineSubjectName(rawName: string, context: LineAiContext) {
  const requested = normalizeSubjectName(rawName)
  if (subjectKey(requested) === subjectKey(generalSubject)) return generalSubject
  return context.subjectNames.find((name) => subjectKey(name) === subjectKey(requested)) ?? generalSubject
}
