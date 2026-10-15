import { useEffect, useRef, useState } from 'react'
import { signPaths } from './api'
import { pathsNeedingUrls } from './chat-state'
import { SIGNED_URL_TTL_SECONDS } from './constants'
import type { ChatItem } from './types'

/** Short-lived signed URLs for the images of a thread. Files are in a private
 *  bucket; a URL is only produced if the storage SELECT policy allows the
 *  current user to read that object. URLs are re-created before they expire. */
export function useSignedUrls(items: ChatItem[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map())
  const urlsRef = useRef(urls)
  urlsRef.current = urls
  const pending = useRef(new Set<string>())

  useEffect(() => {
    const need = pathsNeedingUrls(items, urlsRef.current).filter((p) => !pending.current.has(p))
    if (need.length === 0) return
    need.forEach((p) => pending.current.add(p))
    let cancelled = false
    void signPaths(need)
      .then((signed) => {
        if (cancelled || signed.size === 0) return
        setUrls((prev) => new Map([...prev, ...signed]))
      })
      .catch(() => undefined)
      .finally(() => need.forEach((p) => pending.current.delete(p)))
    return () => {
      cancelled = true
    }
  }, [items])

  // Refresh everything at ~80% of the lifetime so open chats never show
  // expired images.
  useEffect(() => {
    const id = window.setInterval(() => {
      const all = [...urlsRef.current.keys()]
      if (all.length === 0) return
      void signPaths(all)
        .then((signed) => setUrls(new Map(signed)))
        .catch(() => undefined)
    }, SIGNED_URL_TTL_SECONDS * 800)
    return () => window.clearInterval(id)
  }, [])

  return urls
}
