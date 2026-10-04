export type SubscriptionPlan = 'premium'

export type PlanDefinition = {
  id: SubscriptionPlan
  name: string
  tagline: string
  pricePerDevice: number
  badge?: string
  highlights: string[]
}

export const SUBSCRIPTION_PLANS: PlanDefinition[] = [
  {
    id: 'premium',
    name: 'პრემიუმ',
    tagline: 'სრული ფუნქციონალი',
    pricePerDevice: 99,
    highlights: [
      'GPS ხმოვანი მარშრუტი',
      'Live რუკა მძღოლობისას',
      'გამოცდის პანელი',
      'გადართვა: რუკა ↔ შეცდომები',
      'ყველა მომავალი ფუნქცია',
    ],
  },
]

export const SELECTABLE_PLANS = SUBSCRIPTION_PLANS

export const PLAN_AUDIO_NOTE = 'ხმოვანი მარშრუტი ჩართულია.'

export function planById(id: SubscriptionPlan): PlanDefinition {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id) ?? SUBSCRIPTION_PLANS[0]
}

export function planPriceLabel(plan: SubscriptionPlan, deviceSlots = 1): string {
  const total = calculatePrice(plan, deviceSlots)
  return `${total} ₾/თვე`
}

export function planName(plan: SubscriptionPlan): string {
  return planById(plan).name
}

export function calculatePrice(plan: SubscriptionPlan, deviceSlots: number): number {
  // Premium pricing: 1 device = 99₾, 2 devices = 189₾ (max 2 devices)
  if (deviceSlots === 2) return 189
  return 99
}
