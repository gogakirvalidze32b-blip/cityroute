import { useEffect, useState } from 'react'
import { fetchMyUnreadCount, subscribeToMyConversation } from './api'
import { UNREAD_POLL_INTERVAL_MS } from './constants'

/** Number of unread admin replies for the signed-in user (badge on the
 *  Support button). Failures are silent: a badge must never break a page. */
export function useSupportUnread(userId: string | null | undefined): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!userId) {
      setCount(0)
      return
    }
    let cancelled = false
    const refresh = () => {
      fetchMyUnreadCount(userId)
        .then((n) => {
          if (!cancelled) setCount(n)
        })
        .catch(() => undefined)
    }
    refresh()
    let unsubscribe: () => void = () => undefined
    try {
      unsubscribe = subscribeToMyConversation(userId, refresh)
    } catch {
      /* realtime unavailable: polling still works */
    }
    const timer = window.setInterval(refresh, UNREAD_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [userId])

  return count
}
