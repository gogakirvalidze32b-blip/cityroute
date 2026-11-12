import { handleExamSessionRequest } from './handler.ts'

Deno.serve((request) => handleExamSessionRequest(request))
