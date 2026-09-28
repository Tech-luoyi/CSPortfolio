// 管理员退出：服务端递增会话版本，使当前及旧 token 立即失效。
import { deleteCookie } from 'h3'
import { adminApp } from '../../infrastructure/bootstrap'

export default defineEventHandler((event) => {
  const me = requireIdentity(event)
  adminApp.bumpSession(me.id)
  deleteCookie(event, 'jx_admin_v2', { path: '/' })
  return { ok: true }
})
