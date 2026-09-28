import { randomUUID } from 'node:crypto'
import { db } from '../../infrastructure/database/sqlite'

// 设置（公告）与文件工具
// ============================================================================
export function getSetting(key: string) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
  return r?.value || ''
}
export function setSetting(key: string, value: string) {
  if (/^code_seq_\d{4}$/.test(key)) {
    const current = Number(getSetting(key) || 0)
    const next = Number(value)
    if (!Number.isSafeInteger(next) || next < current) throw new Error('code sequence cannot decrease')
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function getCurrentCampaign() {
  return db.prepare("SELECT id, year, slug, name, status, starts_at, ends_at, created_at, updated_at FROM campaigns WHERE status = 'active' ORDER BY year DESC LIMIT 1").get() || null
}

export function getCampaignById(id: string) {
  return db.prepare('SELECT id, year, slug, name, status, starts_at, ends_at, created_at, updated_at FROM campaigns WHERE id = ?').get(id) || null
}

export function listCampaigns() {
  return db.prepare('SELECT id, year, slug, name, status, starts_at, ends_at, created_at, updated_at FROM campaigns ORDER BY year DESC, id DESC').all()
}

export function createCampaign(input: { id: string; year: number; slug: string; name: string; status?: string; starts_at?: string; ends_at?: string }) {
  db.exec('BEGIN IMMEDIATE')
  try {
    if ((input.status || 'draft') === 'active') db.prepare("UPDATE campaigns SET status = 'closed', updated_at = datetime('now', 'localtime') WHERE status = 'active'").run()
    db.prepare(`INSERT INTO campaigns (id, year, slug, name, status, starts_at, ends_at)
      VALUES (@id, @year, @slug, @name, @status, @starts_at, @ends_at)`)
      .run({ status: 'draft', starts_at: '', ends_at: '', ...input })
    db.exec('COMMIT')
    return getCampaignById(input.id)
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* keep original error */ }
    throw err
  }
}


// 文件安全名：UUID + 原扩展名（防路径穿越）
export function safeFileName(original: string) {
  const ext = (original.match(/\.([A-Za-z0-9]{1,6})$/) || [])[1]?.toLowerCase() || ''
  return randomUUID().replace(/-/g, '') + (ext ? '.' + ext : '')
}