// 管理员登录：IP 宽限保护 + 账号级爆破保护。
import { authApp, adminApp } from '../../infrastructure/bootstrap'
import { rateLimit, rateLimitAccount } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  rateLimit(event, 'adminlogin', 100, 600 * 1000)
  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')
  rateLimitAccount('adminlogin', username, 10, 600 * 1000)

  if (!adminApp.hasAny()) {
    throw createError({ statusCode: 500, statusMessage: '服务端未初始化管理员账号，请配置 ADMIN_PASSWORD 后重启' })
  }
  const admin = authApp.authenticateAdmin(username, password)
  if (!admin) throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })

  setCookie(event, 'jx_admin_v2', makeToken(admin.id, Number(admin.session_version || 1)), {
    httpOnly: true, sameSite: 'lax', secure: true, maxAge: 30 * 24 * 3600, path: '/',
  })
  return {
    ok: true,
    me: { id: admin.id, username: admin.username, role: admin.role, dept: admin.dept, display_name: admin.display_name }
  }
})
