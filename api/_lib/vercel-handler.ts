import type { IncomingMessage, ServerResponse } from 'node:http'

type Handler = (request: Request) => Promise<Response>

export async function runVercelHandler(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handler: Handler,
): Promise<void> {
  try {
    const request = await toWebRequest(incoming)
    const response = await handler(request)
    outgoing.statusCode = response.status
    response.headers.forEach((value, name) => outgoing.setHeader(name, value))
    outgoing.end(await response.text())
  } catch (error) {
    console.error('Vercel API request failed:', error instanceof Error ? error.message : 'Unknown error')
    outgoing.statusCode = 500
    outgoing.setHeader('Content-Type', 'application/json')
    outgoing.setHeader('Cache-Control', 'no-store')
    outgoing.end(JSON.stringify({ error: 'Request could not be processed' }))
  }
}

async function toWebRequest(incoming: IncomingMessage): Promise<Request> {
  const host = incoming.headers.host
  if (!host) throw new Error('Request host is missing')
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) headers.set(name, value.join(', '))
  }
  const method = incoming.method ?? 'GET'
  const url = new URL(incoming.url ?? '/', `https://${host}`)
  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers })
  const chunks: Uint8Array[] = []
  for await (const chunk of incoming) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
  }
  const body = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return new Request(url, { method, headers, body })
}
