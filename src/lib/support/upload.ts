import type { SupabaseClient } from '@supabase/supabase-js'
import { EXT_BY_MIME, SUPPORT_BUCKET, type AllowedImageType } from './constants'
import { uuid } from './uuid'

/** Object path inside the private bucket: <conversation_id>/<random>.<ext>.
 *  The Storage RLS policy and send_support_message() both require this shape. */
export function newUploadPath(conversationId: string, mime: AllowedImageType): string {
  return `${conversationId}/${uuid()}.${EXT_BY_MIME[mime]}`
}

export class UploadError extends Error {
  readonly kind: 'sign' | 'network' | 'rejected' | 'aborted'
  readonly status: number | null
  constructor(kind: UploadError['kind'], message: string, status: number | null = null) {
    super(message)
    this.name = 'UploadError'
    this.kind = kind
    this.status = status
  }
}

export interface PutOptions {
  headers: Record<string, string>
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  timeoutMs?: number
  /** Injectable for tests. */
  xhrFactory?: () => XMLHttpRequest
}

/** PUT a multipart body with real upload progress.
 *
 *  Why XHR and not supabase-js `upload()`: (1) fetch cannot report upload
 *  progress, and (2) the project's shared Supabase client aborts every request
 *  after 10 s, which would kill a 5 MB photo on a slow mobile connection. */
export function putWithProgress(url: string, body: FormData, opts: PutOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = opts.xhrFactory ? opts.xhrFactory() : new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(opts.headers)) xhr.setRequestHeader(k, v)
    xhr.timeout = opts.timeoutMs ?? 120_000

    if (xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total))
      }
    }

    const onAbort = () => {
      try {
        xhr.abort()
      } catch {
        /* ignore */
      }
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new UploadError('aborted', 'aborted'))
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    const cleanup = () => opts.signal?.removeEventListener('abort', onAbort)

    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1)
        resolve()
      } else {
        reject(new UploadError('rejected', `upload failed (${xhr.status})`, xhr.status))
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(new UploadError('network', 'network error'))
    }
    xhr.ontimeout = () => {
      cleanup()
      reject(new UploadError('network', 'timeout'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new UploadError('aborted', 'aborted'))
    }

    xhr.send(body)
  })
}

export interface UploadedImage {
  path: string
  mime: AllowedImageType
  size: number
}

export interface UploadParams {
  client: SupabaseClient
  conversationId: string
  file: File
  /** The REAL type found by magic-byte sniffing (not file.type). */
  mime: AllowedImageType
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  anonKey?: string
  xhrFactory?: () => XMLHttpRequest
}

/** Uploads one image to the private bucket through a signed upload URL. */
export async function uploadSupportImage(p: UploadParams): Promise<UploadedImage> {
  const path = newUploadPath(p.conversationId, p.mime)

  const { data, error } = await p.client.storage.from(SUPPORT_BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) {
    throw new UploadError('sign', error?.message ?? 'could not create upload URL')
  }

  const { data: sessionData } = await p.client.auth.getSession()
  const jwt = sessionData?.session?.access_token
  const anon = p.anonKey ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

  const headers: Record<string, string> = { 'x-upsert': 'false' }
  if (anon) headers.apikey = anon
  const bearer = jwt ?? anon
  if (bearer) headers.Authorization = `Bearer ${bearer}`

  // Re-wrap with the verified type so the stored Content-Type is the real one.
  const body = new FormData()
  body.append('cacheControl', '3600')
  body.append('', new Blob([p.file], { type: p.mime }))

  await putWithProgress(data.signedUrl, body, {
    headers,
    onProgress: p.onProgress,
    signal: p.signal,
    xhrFactory: p.xhrFactory,
  })

  return { path, mime: p.mime, size: p.file.size }
}
