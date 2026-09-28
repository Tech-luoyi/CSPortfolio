import { campaignsApp } from '../../infrastructure/bootstrap'
import { adminApp } from '../../infrastructure/bootstrap'

export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  if (me.role !== 'super') throw createError({ statusCode: 403, statusMessage: '仅超级管理员可管理招新活动' })
  const body = await readBody(event).catch(() => ({}))
  const year = Number(body?.year)
  const slug = String(body?.slug || '').trim().toLowerCase()
  const name = String(body?.name || '').trim()
  const status = body?.status === 'active' ? 'active' : 'draft'
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw createError({ statusCode: 400, statusMessage: '活动年份不合法' })
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw createError({ statusCode: 400, statusMessage: '活动 slug 不合法' })
  if (!name || name.length > 80) throw createError({ statusCode: 400, statusMessage: '活动名称需为 1-80 个字符' })
  const id = `recruitment-${year}-${slug}`
  const campaign = campaignsApp.create({ id, year, slug, name, status })
  adminApp.audit(me.id, me.username, 'campaign_create', id, `year=${year} status=${status}`)
  return { ok: true, campaign }
})
