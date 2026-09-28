import { DatabaseSync } from 'node:sqlite'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || join(__dirname, '../../../data')
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(join(dataDir, 'portal.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

// ============================================================================
// 基线 schema —— 必须是「终态」。
// 新库走这里的 CREATE、老库走下面的 ALTER 迁移，两条路径必须收敛到同一形，
// 否则会出现「新库有列、老库没有」的诡异分叉，后续查询随机报错。
//
// direction 列：保留在 schema 里但代码完全停用（不读不写）。
//   保留是为了「回滚安全」—— 旧代码 INSERT 时会写 direction，若 drop 掉则回滚即失败。
//   招新一轮结束后可安全 drop。
// ============================================================================
db.exec(`
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  student_id TEXT UNIQUE NOT NULL,
  qq TEXT NOT NULL,
  phone TEXT DEFAULT '',
  direction TEXT NOT NULL DEFAULT '',        -- 停用列，仅为回滚安全保留
  dept TEXT NOT NULL DEFAULT '',             -- 意向部门（稳定 key：game/ai/dev/secretary）
  resume_path TEXT NOT NULL,
  resume_name TEXT DEFAULT '',
  work_url TEXT DEFAULT '',
  work_path TEXT DEFAULT '',
  work_name TEXT DEFAULT '',
  intro TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  reviewer_id INTEGER NOT NULL DEFAULT 0,    -- 最近一次审核的管理员 id
  reviewed_at TEXT NOT NULL DEFAULT '',      -- 最近一次审核时间（应用写入）
  dept_changed_by INTEGER NOT NULL DEFAULT 0,
  dept_changed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
`)

// ============================================================================
// 幂等迁移
// SQLite 实测约束（已在容器 node 22.13.1 / SQLite 3.47.2 验证）：
//   - 没有 ADD COLUMN IF NOT EXISTS → 必须用 PRAGMA table_info 探列
//   - 非空表加 NOT NULL 列必须带「常量」默认值；DEFAULT (datetime('now')) 会被拒
//     → 审计时间列只能 TEXT NOT NULL DEFAULT ''，由应用写入
//   - PRAGMA user_version = ? 不支持占位符，只能拼接常量数字
//   - 事务内 DDL 与 PRAGMA user_version 都可回滚 → 迁移整体包 BEGIN/COMMIT
//   - 建部分唯一索引前必须先查重，否则重复值会让索引创建失败并连带整个迁移回滚
// ============================================================================

/** 探列：SQLite 无 ADD COLUMN IF NOT EXISTS 的替代方案 */
function hasColumn(table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(c => c.name === col)
}

/** 幂等加列（列名与声明均为代码内常量，不存在注入风险） */
function addColumnIfMissing(table: string, col: string, decl: string): void {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
}

/** 建部分唯一索引前先查重：发现重复则抛错，让整个迁移回滚（不留下半迁移状态） */
function assertNoDuplicate(table: string, col: string): void {
  const dup = db.prepare(
    `SELECT ${col} AS v, COUNT(*) AS c FROM ${table} WHERE ${col} <> '' GROUP BY ${col} HAVING COUNT(*) > 1 LIMIT 1`
  ).get() as any
  if (dup) {
    throw new Error(`迁移中止：${table}.${col} 存在重复值「${dup.v}」(${dup.c} 行)，无法创建唯一索引，请先人工清理`)
  }
}

/** 迁移数组：下标 + 1 = 目标 user_version。每一步都必须幂等可重放。 */
const MIGRATIONS: Array<() => void> = [
  // ---- v1：建 admins / audit_log；submissions 加部门与审计列；建部分唯一索引 ----
  () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'dept',
      dept          TEXT NOT NULL DEFAULT '',
      display_name  TEXT NOT NULL DEFAULT '',
      is_active     INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      actor_id   INTEGER NOT NULL DEFAULT 0,
      actor_name TEXT NOT NULL DEFAULT '',
      action     TEXT NOT NULL,
      target     TEXT NOT NULL DEFAULT '',
      detail     TEXT NOT NULL DEFAULT ''
    );
    `)
    // submissions 加列（老库在此补列；新库已在基线里，探列后为 no-op）
    addColumnIfMissing('submissions', 'dept', "TEXT NOT NULL DEFAULT ''")
    addColumnIfMissing('submissions', 'reviewer_id', 'INTEGER NOT NULL DEFAULT 0')
    addColumnIfMissing('submissions', 'reviewed_at', "TEXT NOT NULL DEFAULT ''")
    addColumnIfMissing('submissions', 'dept_changed_by', 'INTEGER NOT NULL DEFAULT 0')
    addColumnIfMissing('submissions', 'dept_changed_at', "TEXT NOT NULL DEFAULT ''")
    // 唯一索引（部分索引：空串不参与约束，老记录是空串也不冲突）
    assertNoDuplicate('submissions', 'resume_path')
    assertNoDuplicate('submissions', 'work_path')
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_resume ON submissions(resume_path) WHERE resume_path <> ''")
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_work ON submissions(work_path) WHERE work_path <> ''")
  },
  // ---- v2：老数据 direction → dept 映射（仅对 dept 为空的行） ----
  () => {
    const map: Array<[string, string]> = [
      ['后端开发', 'dev'],
      ['前端开发', 'dev'],
      ['算法 / AI', 'ai'],
      ['算法/AI', 'ai'],
    ]
    for (const [from, to] of map) {
      db.prepare("UPDATE submissions SET dept = ? WHERE dept = '' AND direction = ?").run(to, from)
    }
  },
  // ---- v3：管理员会话版本，用于密码修改/退出时立即废止旧 token ----
  () => {
    addColumnIfMissing('admins', 'session_version', 'INTEGER NOT NULL DEFAULT 1')
    // 部署会让现有 cookie 重新登录，避免旧格式 token 继续存活。
    db.exec('UPDATE admins SET session_version = 2 WHERE session_version = 1')
  },
  // ---- v4：活动隔离；历史数据原样迁入当前活动，学号唯一约束调整为活动内唯一 ----
  () => {
    db.exec(`CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      starts_at TEXT NOT NULL DEFAULT '',
      ends_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )`)
    const latest = db.prepare('SELECT code FROM submissions ORDER BY id DESC LIMIT 1').get() as any
    const codeYear = String(latest?.code || '').match(/^JX-(\d{4})-/)?.[1]
    const year = Number(codeYear || new Date().getFullYear())
    const campaignId = `recruitment-${year}`
    db.prepare(`INSERT OR IGNORE INTO campaigns (id, year, slug, name, status)
      VALUES (?, ?, ?, ?, 'active')`).run(campaignId, year, String(year), `${year} 招新`)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_one_active ON campaigns(status) WHERE status = 'active'")

    if (!hasColumn('submissions', 'campaign_id')) {
      db.exec(`CREATE TABLE submissions_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        student_id TEXT NOT NULL,
        qq TEXT NOT NULL,
        phone TEXT DEFAULT '',
        direction TEXT NOT NULL DEFAULT '',
        dept TEXT NOT NULL DEFAULT '',
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        resume_path TEXT NOT NULL,
        resume_name TEXT DEFAULT '',
        work_url TEXT DEFAULT '',
        work_path TEXT DEFAULT '',
        work_name TEXT DEFAULT '',
        intro TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT DEFAULT '',
        reviewer_id INTEGER NOT NULL DEFAULT 0,
        reviewed_at TEXT NOT NULL DEFAULT '',
        dept_changed_by INTEGER NOT NULL DEFAULT 0,
        dept_changed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )`)
      const beforeCount = Number((db.prepare('SELECT COUNT(*) AS c FROM submissions').get() as any)?.c || 0)
      const auditCountBefore = Number((db.prepare('SELECT COUNT(*) AS c FROM audit_log').get() as any)?.c || 0)
      db.prepare(`INSERT INTO submissions_v4 (
        id, code, name, student_id, qq, phone, direction, dept, campaign_id,
        resume_path, resume_name, work_url, work_path, work_name, intro, status,
        admin_note, reviewer_id, reviewed_at, dept_changed_by, dept_changed_at,
        created_at, updated_at
      ) SELECT id, code, name, student_id, qq, phone, direction, dept, ?,
        resume_path, resume_name, work_url, work_path, work_name, intro, status,
        admin_note, reviewer_id, reviewed_at, dept_changed_by, dept_changed_at,
        created_at, updated_at
        FROM submissions`).run(campaignId)
      const migratedCount = Number((db.prepare('SELECT COUNT(*) AS c FROM submissions_v4').get() as any)?.c || 0)
      const mismatch = db.prepare(`SELECT COUNT(*) AS c FROM submissions AS old
        LEFT JOIN submissions_v4 AS migrated ON migrated.id = old.id
        WHERE migrated.id IS NULL OR
          old.code IS NOT migrated.code OR old.name IS NOT migrated.name OR
          old.student_id IS NOT migrated.student_id OR old.qq IS NOT migrated.qq OR
          old.phone IS NOT migrated.phone OR old.direction IS NOT migrated.direction OR
          old.dept IS NOT migrated.dept OR old.resume_path IS NOT migrated.resume_path OR
          old.resume_name IS NOT migrated.resume_name OR old.work_url IS NOT migrated.work_url OR
          old.work_path IS NOT migrated.work_path OR old.work_name IS NOT migrated.work_name OR
          old.intro IS NOT migrated.intro OR old.status IS NOT migrated.status OR
          old.admin_note IS NOT migrated.admin_note OR old.reviewer_id IS NOT migrated.reviewer_id OR
          old.reviewed_at IS NOT migrated.reviewed_at OR old.dept_changed_by IS NOT migrated.dept_changed_by OR
          old.dept_changed_at IS NOT migrated.dept_changed_at OR old.created_at IS NOT migrated.created_at OR
          old.updated_at IS NOT migrated.updated_at`).get() as any
      const auditCountAfter = Number((db.prepare('SELECT COUNT(*) AS c FROM audit_log').get() as any)?.c || 0)
      if (beforeCount !== migratedCount || Number(mismatch?.c || 0) !== 0 || auditCountBefore !== auditCountAfter) {
        throw new Error('v4 migration data-preservation assertion failed')
      }
      db.exec('DROP TABLE submissions')
      db.exec('ALTER TABLE submissions_v4 RENAME TO submissions')
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_campaign_student ON submissions(campaign_id, student_id)')
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_resume ON submissions(resume_path) WHERE resume_path <> ''")
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_work ON submissions(work_path) WHERE work_path <> ''")
    db.exec('CREATE INDEX IF NOT EXISTS ix_sub_campaign_dept_status_id ON submissions(campaign_id, dept, status, id DESC)')
    db.exec('CREATE INDEX IF NOT EXISTS ix_sub_campaign_status_id ON submissions(campaign_id, status, id DESC)')
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_code_seq_no_decrease
      BEFORE UPDATE OF value ON settings
      WHEN OLD.key = NEW.key AND NEW.key GLOB 'code_seq_[0-9]*'
        AND CAST(NEW.value AS INTEGER) < CAST(OLD.value AS INTEGER)
      BEGIN SELECT RAISE(ABORT, 'code sequence cannot decrease'); END`)
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_code_seq_no_delete
      BEFORE DELETE ON settings WHEN OLD.key GLOB 'code_seq_[0-9]*'
      BEGIN SELECT RAISE(ABORT, 'code sequence cannot be deleted'); END`)
    const seqKey = `code_seq_${year}`
    const currentSeq = Number((db.prepare('SELECT value FROM settings WHERE key = ?').get(seqKey) as any)?.value || 0)
    const codes = db.prepare('SELECT code FROM submissions WHERE code GLOB ?').all(`JX-${year}-*`) as any[]
    const maxStored = codes.reduce((max, row) => Math.max(max, Number(String(row.code).match(/^JX-\d{4}-(\d+)$/)?.[1] || 0)), 0)
    if (maxStored > currentSeq) db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(seqKey, String(maxStored))
  },
]

/** 逐版本递进迁移；每一步都在事务内执行，失败即 ROLLBACK 并抛错（让进程起不来） */
function runMigrations(): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as any)?.user_version || 0)
  for (let v = current; v < MIGRATIONS.length; v++) {
    const next = v + 1
    db.exec('BEGIN')
    try {
      MIGRATIONS[v]()
      // PRAGMA 不支持占位符 → 拼接常量数字（next 为循环内常量，无注入风险）
      db.exec(`PRAGMA user_version = ${next}`)
      db.exec('COMMIT')
    } catch (err) {
      try { db.exec('ROLLBACK') } catch { /* 回滚失败也继续抛原始错误 */ }
      throw err
    }
  }
}


runMigrations()

let sequenceFloors: Record<string, number> | null = null

function loadSequenceFloors(): Record<string, number> {
  if (sequenceFloors) return sequenceFloors
  const file = process.env.CODE_SEQUENCE_FLOOR_FILE
  if (!file) return (sequenceFloors = {})
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取编号高水位文件 ${file}`, { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('编号高水位文件格式无效')
  const floors: Record<string, number> = {}
  for (const [year, value] of Object.entries(parsed as Record<string, unknown>)) {
    const sequence = Number(value)
    if (!/^\d{4}$/.test(year) || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`编号高水位配置无效：${year}`)
    }
    floors[year] = sequence
  }
  sequenceFloors = floors
  return floors
}

export function getSequenceFloor(year: number): number {
  return loadSequenceFloors()[String(year)] || 0
}

export function advanceSequenceFloor(year: number, sequence: number): void {
  const file = process.env.CODE_SEQUENCE_FLOOR_FILE
  if (!file) return
  const floors = loadSequenceFloors()
  const key = String(year)
  const next = Math.max(floors[key] || 0, sequence)
  if (next === (floors[key] || 0)) return
  const updated = { ...floors, [key]: next }
  const temporary = `${file}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx', mode: 0o640 })
    // fsync on a read-only descriptor fails with EPERM on Windows; open read/write.
    fd = openSync(temporary, 'r+')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
    // Windows does not support fsync() on directory handles (EPERM). The file
    // itself is fsynced above before rename; POSIX systems also sync the parent
    // directory so the name update is durable across a crash.
    if (process.platform !== 'win32') {
      const dirFd = openSync(dirname(file), 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    }
    sequenceFloors = updated
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd) } catch { /* preserve original error */ } }
    try { unlinkSync(temporary) } catch { /* preserve original error */ }
    throw new Error('无法持久化投递码外部高水位', { cause: error })
  }
}

function assertSequenceFloorsNotAheadOfDatabase(): void {
  const floors = loadSequenceFloors()
  for (const [year, floor] of Object.entries(floors)) {
    const value = db.prepare('SELECT value FROM settings WHERE key = ?').get(`code_seq_${year}`) as any
    const stored = Number(value?.value || 0)
    if (!Number.isSafeInteger(stored) || stored < floor) {
      throw new Error(`数据库投递码序号低于外部高水位：${year} settings=${stored} floor=${floor}；禁止启动以避免重号`)
    }
  }
}

assertSequenceFloorsNotAheadOfDatabase()

// ============================================================================

export const EXPECTED_SCHEMA_VERSION = 4
export function databaseIsMigrated(): boolean {
  const version = Number((db.prepare('PRAGMA user_version').get() as any)?.user_version || 0)
  return version >= EXPECTED_SCHEMA_VERSION
}

export function databaseReadiness() {
  db.prepare('SELECT 1').get()
  const schemaVersion = Number((db.prepare('PRAGMA user_version').get() as any)?.user_version || 0)
  return { schemaVersion, migrated: schemaVersion >= EXPECTED_SCHEMA_VERSION }
}
