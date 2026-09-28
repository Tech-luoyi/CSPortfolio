import type { CampaignRepository } from '../repositories/contracts'

export function createCampaignsApp(campaigns: CampaignRepository) {
  return Object.freeze({
    current() { return campaigns.getCurrent() },
    get(id: string) { return campaigns.getById(id) },
    list() { return campaigns.list() },
    create(input: { id: string; year: number; slug: string; name: string; status?: string; starts_at?: string; ends_at?: string }) {
      return campaigns.create(input)
    },
  })
}
