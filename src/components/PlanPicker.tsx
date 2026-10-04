import {
  PLAN_AUDIO_NOTE,
  SELECTABLE_PLANS,
  type PlanDefinition,
  type SubscriptionPlan,
} from '@/data/subscription-plans'

type Props = {
  selected: SubscriptionPlan | null
  onSelect: (plan: SubscriptionPlan) => void
  compact?: boolean
}

export function PlanPicker({ selected, onSelect, compact = false }: Props) {
  const savings = 0

  return (
    <div className={`plan-picker${compact ? ' plan-picker--compact' : ''}`}>
      <p className="plan-picker__note">{PLAN_AUDIO_NOTE}</p>

      <div className="plan-picker__grid">
        {SELECTABLE_PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={selected === plan.id}
            onSelect={() => onSelect(plan.id)}
          />
        ))}
      </div>

      {savings > 0 && !compact && (
        <p className="plan-picker__savings">
          სრული პაკეტით დაზოგავ <strong>{savings} ₾</strong> თვეში
        </p>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: PlanDefinition
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`plan-card${selected ? ' plan-card--selected' : ''}${''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {plan.badge && <span className="plan-card__badge">{plan.badge}</span>}

      <div className="plan-card__head">
        <h3>{plan.name}</h3>
        <p className="plan-card__tagline">{plan.tagline}</p>
      </div>

      <div className="plan-card__price">
        <strong>{plan.pricePerDevice}</strong>
        <span>₾ / თვე</span>
      </div>

      <ul className="plan-card__list">
        {plan.highlights.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <span className="plan-card__check" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
    </button>
  )
}
