export type SubscriptionPlan = 'premium'

export type PlanDefinition = {
  id: SubscriptionPlan
  name: string
  tagline: string
  price: number
  badge?: string
  highlights: string[]
}

export const SUBSCRIPTION_PLANS: PlanDefinition[] = [
  {
    id: 'premium',
    name: 'პრემიუმ',
    tagline: 'სრული ფუნქციონალი',
    price: 99,
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

export function planPriceLabel(plan: SubscriptionPlan): string {
  return `${planById(plan).price} ₾/თვე`
}

export function planName(plan: SubscriptionPlan): string {
  return planById(plan).name
}
