import type { SettingsRepository } from '../repositories/contracts'

export function createSettingsApp(settings: SettingsRepository) {
  return Object.freeze({
    get(key: string) { return settings.get(key) },
    set(key: string, value: string) { return settings.set(key, value) },
  })
}
