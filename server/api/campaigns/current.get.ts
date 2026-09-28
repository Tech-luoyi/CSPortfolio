import { campaignsApp } from '../../infrastructure/bootstrap'

export default defineEventHandler(() => {
  const campaign = campaignsApp.current() as any
  if (!campaign) throw createError({ statusCode: 503, statusMessage: '当前没有开放的招新活动' })
  return { ok: true, campaign: { id: campaign.id, year: campaign.year, slug: campaign.slug, name: campaign.name, status: campaign.status } }
})
