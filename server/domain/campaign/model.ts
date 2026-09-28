export interface Campaign {
  id: string
  year: number
  slug: string
  name: string
  status: 'draft' | 'active' | 'closed' | string
  starts_at: string
  ends_at: string
  created_at?: string
  updated_at?: string
}

export interface CreateCampaignInput {
  id: string
  year: number
  slug: string
  name: string
  status?: 'draft' | 'active' | 'closed'
  starts_at?: string
  ends_at?: string
}
