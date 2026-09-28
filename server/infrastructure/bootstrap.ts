import { LocalFileStorage } from './storage/local'
import { memoryRateLimiter } from './rate-limit/memory'
import {
  SqliteAdminRepository,
  SqliteCampaignRepository,
  SqliteHealthRepository,
  SqliteSettingsRepository,
  SqliteSubmissionRepository,
} from '../repositories/sqlite'
import { createAdminApp } from '../application/admin'
import { createAuthApp } from '../application/auth'
import { createCampaignsApp } from '../application/campaigns'
import { createHealthApp } from '../application/health'
import { createSettingsApp } from '../application/settings'
import { createStorageApp } from '../application/storage'
import { createSubmissionsApp } from '../application/submissions'

// Composition root: concrete adapters are created here and injected into application services.
export const repositories = Object.freeze({
  submissions: new SqliteSubmissionRepository(),
  campaigns: new SqliteCampaignRepository(),
  admins: new SqliteAdminRepository(),
  settings: new SqliteSettingsRepository(),
  health: new SqliteHealthRepository(),
})

export const fileStorage = new LocalFileStorage()
export const rateLimiter = memoryRateLimiter

export const adminApp = createAdminApp(repositories.admins)
export const authApp = createAuthApp(repositories.admins)
export const campaignsApp = createCampaignsApp(repositories.campaigns)
export const healthApp = createHealthApp(repositories.health, fileStorage)
export const settingsApp = createSettingsApp(repositories.settings)
export const storageApp = createStorageApp(fileStorage)
export const submissionsApp = createSubmissionsApp(repositories.submissions)
