type Props = {
  accuracy: number | null
}

/**
 * GPS სიზუსტის ვიზუალური ინდიკატორი
 * 
 * - 0-20m: შესანიშნავი GPS (სატელიტური)
 * - 20-50m: კარგი GPS
 * - 50-150m: დასაშვები (შეიძლება WiFi)
 * - 150m+: ცუდი (IP-based location)
 */
export function GpsAccuracyBadge({ accuracy }: Props) {
  if (accuracy === null) return null

  const getStatus = () => {
    if (accuracy <= 20) return { label: 'GPS ზუსტი', color: '#22c55e', emoji: '🎯' }
    if (accuracy <= 50) return { label: 'GPS კარგი', color: '#3b82f6', emoji: '📡' }
    if (accuracy <= 150) return { label: 'GPS დასაშვები', color: '#f59e0b', emoji: '⚠️' }
    return { label: 'GPS ცუდი', color: '#ef4444', emoji: '❌' }
  }

  const status = getStatus()

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.25rem 0.5rem',
        borderRadius: '999px',
        background: `${status.color}22`,
        border: `1px solid ${status.color}`,
        color: status.color,
        fontSize: '0.7rem',
        fontWeight: 600,
      }}
    >
      <span>{status.emoji}</span>
      <span>{status.label}</span>
      <span style={{ opacity: 0.7 }}>±{Math.round(accuracy)}მ</span>
    </div>
  )
}
