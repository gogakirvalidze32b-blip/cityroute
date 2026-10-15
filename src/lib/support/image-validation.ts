import {
  ALLOWED_IMAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  type AllowedImageType,
} from './constants'
import { S } from './strings'

/** Identify an image by its first bytes ("magic numbers"), never by its file
 *  name or by the type string the browser/OS reported. */
export function sniffImageType(b: Uint8Array): AllowedImageType | null {
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png'
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }

  return null
}

async function readHead(file: Blob, length = 16): Promise<Uint8Array> {
  const slice = file.slice(0, length)
  if (typeof slice.arrayBuffer === 'function') {
    return new Uint8Array(await slice.arrayBuffer())
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(slice)
  })
}

export type ImageCheck =
  | { ok: true; mime: AllowedImageType }
  | { ok: false; message: string }

/** Checks size, the reported MIME type AND the real content type. */
export async function validateImageFile(file: File): Promise<ImageCheck> {
  const name = file.name || 'image'

  if (file.size <= 0) return { ok: false, message: S.imageEmpty(name) }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: S.imageTooBig(name) }

  // A reported type that is present but not an allowed image type is refused
  // outright (e.g. image/gif, image/svg+xml, application/pdf, image/heic).
  const reported = (file.type || '').toLowerCase()
  if (reported && !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(reported)) {
    return { ok: false, message: S.imageBadType(name) }
  }

  let head: Uint8Array
  try {
    head = await readHead(file)
  } catch {
    return { ok: false, message: S.imageUnreadable(name) }
  }

  // The real content decides, not the extension and not the reported type.
  const real = sniffImageType(head)
  if (!real) return { ok: false, message: S.imageBadType(name) }

  return { ok: true, mime: real }
}

export interface AcceptedImage {
  file: File
  mime: AllowedImageType
}

/** Validates a batch picked by the user, honouring how many slots remain. */
export async function validateSelection(
  currentCount: number,
  files: File[],
): Promise<{ accepted: AcceptedImage[]; errors: string[] }> {
  const accepted: AcceptedImage[] = []
  const errors: string[] = []
  let slots = Math.max(0, MAX_ATTACHMENTS - currentCount)
  let overflow = false

  for (const file of files) {
    if (slots <= 0) {
      overflow = true
      continue
    }
    const check = await validateImageFile(file)
    // (`=== true` narrows the union even though the project runs tsc non-strict.)
    if (check.ok === true) {
      accepted.push({ file, mime: check.mime })
      slots--
    } else {
      errors.push((check as { ok: false; message: string }).message)
    }
  }

  if (overflow) errors.push(S.tooManyImages(MAX_ATTACHMENTS))
  return { accepted, errors }
}
