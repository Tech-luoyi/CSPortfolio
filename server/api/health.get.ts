// 轻量健康检查：供 Docker/Caddy/外部监控使用，不返回业务数据。
import db from '../utils/db'

export default defineEventHandler(() => {
  try {
    db.prepare('SELECT 1').get()
    return { ok: true }
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' })
  }
})
