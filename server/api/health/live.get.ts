// Process liveness: no database or filesystem dependency.
export default defineEventHandler(() => ({ ok: true, status: 'live' }))
