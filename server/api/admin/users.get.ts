// 账号列表（仅超级管理员）
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  if (me.role !== 'super') throw createError({ statusCode: 403, statusMessage: '仅超级管理员可管理账号' })
  return { ok: true, users: listAdmins() }
})
