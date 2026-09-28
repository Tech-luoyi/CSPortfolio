import { settingsApp } from '../infrastructure/bootstrap'

// 公告读取（公开）+ 写入（仅超级管理员）
export default defineEventHandler(async (event) => {
  if (event.method === 'GET') {
    return { ok: true, announcement: settingsApp.get('announcement') }
  }
  const me = requireIdentity(event)
  // 严格部门隔离下，部长不该改全局公告 —— 功能级权限用 403（对部长而言「功能不存在」，不产生存在性 oracle）
  if (me.role !== 'super') throw createError({ statusCode: 403, statusMessage: '仅超级管理员可修改公告' })
  const body = await readBody(event).catch(() => ({}))
  settingsApp.set('announcement', String(body?.announcement || '').slice(0, 300))
  return { ok: true }
})
