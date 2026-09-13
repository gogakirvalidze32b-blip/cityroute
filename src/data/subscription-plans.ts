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


export type VehiclePackage = '1-vehicle' | '2-vehicles' | '3-vehicles'

export const VEHICLE_PACKAGES = {
  '1-vehicle': {
    id: '1-vehicle',
    vehicles: 1,
    price: 99,
    pricePerVehicle: 99,
    discount: 0,
    label: '1 მანქანა',
  },
  '2-vehicles': {
    id: '2-vehicles',
    vehicles: 2,
    price: 180,
    pricePerVehicle: 90,
    discount: 10,
    label: '2 მანქანა',
  },
  '3-vehicles': {
    id: '3-vehicles',
    vehicles: 3,
    price: 250,
    pricePerVehicle: 83,
    discount: 15,
    label: '3 მანქანა',
  },
} as const
