import { getSupabase } from '@/lib/supabase'

export type DeviceSlotPackage = {
  subscription_plan: string
  device_slots: number
  price_amount: number
  currency: string
  sort_order: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function loadDeviceSlotPackages(
  subscriptionPlan = 'premium',
): Promise<DeviceSlotPackage[]> {
  const { data, error } = await getSupabase()
    .from('device_slot_packages')
    .select('subscription_plan, device_slots, price_amount, currency, sort_order')
    .eq('subscription_plan', subscriptionPlan)
    .eq('active', true)
    .order('sort_order')
    .order('device_slots')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid device package catalog response')

  return data.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.subscription_plan !== 'string' ||
      !Number.isInteger(value.device_slots) ||
      Number(value.device_slots) < 1 ||
      Number(value.device_slots) > 100 ||
      !Number.isInteger(value.price_amount) ||
      Number(value.price_amount) < 1 ||
      value.currency !== 'GEL' ||
      !Number.isInteger(value.sort_order)
    ) {
      throw new Error('Invalid device package catalog entry')
    }
    return value as DeviceSlotPackage
  })
}
