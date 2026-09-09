type Props = {
  city?: string
  centered?: boolean
}

export function AppBrand({ city = 'თელავი', centered = false }: Props) {
  return (
    <div className={`app-brand${centered ? ' app-brand--center' : ''}`}>
      <img className="app-brand__logo" src="/favicon.svg" alt="" width={56} height={56} />
      <div className="app-brand__text">
        <p className="app-brand__name">CityRoute</p>
        <p className="app-brand__city">{city}</p>
      </div>
    </div>
  )
}
