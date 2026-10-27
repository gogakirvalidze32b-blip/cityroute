import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleBogProductionCallback } from '../../_lib/bog-production.ts'
import { runVercelHandler } from '../../_lib/vercel-handler.ts'

export const config = { api: { bodyParser: false } }

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runVercelHandler(req, res, handleBogProductionCallback)
}
