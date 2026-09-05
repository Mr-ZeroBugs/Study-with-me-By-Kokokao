import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

type DeliveryClaim =
  | { mode: 'protected'; deliveryId: string | null }
  | { mode: 'legacy'; deliveryId: null }

function isMissingDeliveryInfrastructure(message: string) {
  return /notification_delivery_log|claim_notification_delivery|complete_notification_delivery|schema cache/i.test(message)
}

/**
 * Atomically claims one scheduled notification. Deploying the web code before
 * its optional SQL migration preserves the previous delivery behaviour; it is
 * intentionally visible in server logs so production can finish the setup.
 */
export async function claimReminderDelivery(
  client: SupabaseClient,
  userId: string,
  notificationKey: string,
): Promise<DeliveryClaim> {
  const { data, error } = await client.rpc('claim_notification_delivery', {
    target_user_id: userId,
    target_notification_key: notificationKey,
  })

  if (error) {
    if (isMissingDeliveryInfrastructure(error.message)) {
      console.warn('Reminder delivery protection is unavailable. Apply supabase/009_reminder_delivery_v0.sql.', error.message)
      return { mode: 'legacy', deliveryId: null }
    }
    throw new Error(`Could not claim reminder delivery: ${error.message}`)
  }

  return { mode: 'protected', deliveryId: typeof data === 'string' ? data : null }
}

export async function completeReminderDelivery(
  client: SupabaseClient,
  deliveryId: string,
  sent: boolean,
): Promise<void> {
  const { error } = await client.rpc('complete_notification_delivery', {
    target_delivery_id: deliveryId,
    did_send: sent,
    failure_code: sent ? null : 'line_push_rejected',
  })

  if (error) console.error('Could not record reminder delivery outcome:', error.message)
}
