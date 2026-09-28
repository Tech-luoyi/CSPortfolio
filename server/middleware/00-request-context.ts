import { randomUUID } from 'node:crypto'

export default defineEventHandler((event) => {
  const requestId = randomUUID()
  const startedAt = performance.now()
  event.context.requestId = requestId
  setHeader(event, 'X-Request-Id', requestId)

  event.node.res.once('finish', () => {
    const row = {
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'http_request',
      request_id: requestId,
      method: event.node.req.method || 'UNKNOWN',
      path: (event.node.req.url || '/').split('?')[0].slice(0, 256),
      status: event.node.res.statusCode,
      duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      actor_id: Number(event.context.identity?.id || 0) || undefined,
    }
    console.log(JSON.stringify(row))
  })
})
