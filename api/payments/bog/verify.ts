import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleBogVerify } from '../../_lib/bog-production.ts'
import { runVercelHandler } from '../../_lib/vercel-handler.ts'

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return runVercelHandler(request, response, handleBogVerify)
}
