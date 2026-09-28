import { adminApp } from '../../infrastructure/bootstrap'

// 创建后台账号（仅超级管理员）—— 容器内无交互式 CLI，这是建部门账号的唯一途径
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  if (me.role !== 'super') throw createError({ statusCode: 403, statusMessage: '仅超级管理员可管理账号' })

  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')
  const displayName = String(body?.display_name || '').trim().slice(0, 20)
  const role = body?.role === 'super' ? 'super' : 'dept'
  const dept = String(body?.dept || '').trim()

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw createError({ statusCode: 400, statusMessage: '用户名需 3-20 位字母数字下划线' })
  if (password.length < 8 || password.length > 128) throw createError({ statusCode: 400, statusMessage: '密码需为 8-128 位' })
  if (role === 'dept' && !DEPT_KEYS.includes(dept)) throw createError({ statusCode: 400, statusMessage: '部门不合法' })
  if (adminApp.getByUsername(username)) throw createError({ statusCode: 409, statusMessage: '用户名已存在' })

  const id = adminApp.create(username, password, role, role === 'super' ? '' : dept, displayName)
  adminApp.audit(me.id, me.username, 'user_create', username, `role=${role} dept=${role === 'super' ? '' : dept}`)
  return { ok: true, id }
})
