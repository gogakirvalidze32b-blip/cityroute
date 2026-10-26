import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleBogCallback } from '../../_lib/bog-production.ts'
import { runVercelHandler } from '../../_lib/vercel-handler.ts'

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return runVercelHandler(request, response, handleBogCallback)
}
