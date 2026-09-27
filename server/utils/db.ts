// 数据库层：node:sqlite（Node 22 内置，零原生依赖，跨平台）
// 表：submissions 投递记录 / settings 键值对（公告等） / admins 后台账号 / audit_log 审计日志
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './crypto'
import { DEPT_KEYS } from './departments'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || join(__dirname, '../../data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'portal.db'))
db.exec('PRAGMA journal_mode = WAL')

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

// ============================================================================
// 身份与作用域（越权防线的地基）
// ============================================================================

export interface Identity {
  id: number
  username: string
  role: string        // 'dept' | 'super'
  dept: string        // role='dept' 时有意义
  display_name: string
}

/** 作用域：null = 全部（仅超级管理员可产生）；string = 限定到某部门 */
export type Scope = string | null

/**
 * 由身份推导作用域。
 * fail-closed：身份缺失直接抛错，绝不返回 null。
 * 「看全部」只能由 role === 'super' 这一个条件产生 —— 这是整套防线最重要的一条纪律。
 */
export function deptOf(me: Identity): Scope {
  if (!me || !me.role) throw new Error('deptOf: 缺少身份')
  return me.role === 'super' ? null : me.dept
}

/** 把作用域注入 WHERE 条件。scope 未提供（undefined）时抛错 —— 忘记传应炸，而不是放开 */
function applyScope(where: string[], params: any, scope: Scope): void {
  if (scope === undefined as unknown) throw new Error('applyScope: scope 未提供（拒绝默认放行）')
  if (scope !== null) { where.push('dept = @dept'); params.dept = scope }
}

/** 统一的资源不存在错误（404 与「无权」不可区分，避免存在性 oracle） */
function recordNotFound() {
  return createError({ statusCode: 404, statusMessage: '记录不存在' })
}

// 显式列白名单：替换 SELECT *，避免无意中把新增的敏感列暴露给列表接口。
// resume_path / work_path 必须保留 —— 后台要凭它拼 /api/admin/files/<name> 下载 URL。
// 【安全依赖】它之所以安全，是因为 files 接口会反查文件归属并做部门校验；
// 若日后改动 files 接口的归属判断，必须同步维护这里的列清单（不要把路径暴露给跨部门用户）。
const SUBMISSION_COLUMNS =
  'id, code, name, student_id, qq, phone, dept, resume_path, resume_name, work_url, work_path, work_name, ' +
  'intro, status, admin_note, reviewer_id, reviewed_at, dept_changed_by, dept_changed_at, created_at, updated_at'

// ============================================================================
// 投递记录
// ============================================================================
const pad = (n: number) => String(n).padStart(4, '0')

// 投递码序号存在 settings 里、按年分开（code_seq_2026 …），不再从 submissions.id 推导。
// 旧写法用 SELECT MAX(id)+1：表一旦被清空，MAX(id) 变成 NULL，码就退回 JX-YYYY-0001，
// 与清库前已经发到学生手里的码重号。
// 这里全程是同步调用，Node 单线程下不会被其它请求插入；且 INSERT 抛错时不会执行到
// setSetting，序号不会空跳。
export function createSubmission(data: any) {
  const year = new Date().getFullYear()
  const seqKey = `code_seq_${year}`
  const next = Number(getSetting(seqKey) || 0) + 1
  const code = `JX-${year}-${pad(next)}`
  // 注意：INSERT 已去掉 direction、改为写 dept。
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO submissions
      (code, name, student_id, qq, phone, dept, resume_path, resume_name, work_url, work_path, work_name, intro)
      VALUES (@code, @name, @student_id, @qq, @phone, @dept, @resume_path, @resume_name, @work_url, @work_path, @work_name, @intro)`)
      .run({ code, work_url: '', work_path: '', work_name: '', phone: '', dept: '', intro: '', ...data })
    setSetting(seqKey, String(next))
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* 保留原始错误 */ }
    throw err
  }
  return code
}

/**
 * 公开查询（凭学号或投递码）。
 * 只返回本人可公开的字段，绝不返回 qq/phone/resume_path 等隐私。
 */
export function findByStudentId(studentId: string) {
  const row = db.prepare(
    'SELECT code, name, dept, status, admin_note, created_at FROM submissions WHERE student_id = ? ORDER BY id DESC LIMIT 1'
  ).get(studentId)
  return row || null
}

/** 公开查询必须同时提供投递码和学号，避免仅凭可枚举学号泄露状态。 */
export function findPublicByCodeAndStudent(code: string, studentId: string) {
  const row = db.prepare(
    'SELECT code, name, dept, status, admin_note, created_at FROM submissions WHERE code = ? AND student_id = ? LIMIT 1'
  ).get(code, studentId)
  return row || null
}

/** 兼容内部旧调用；公开路由不应使用单字段查询。 */
export function findByQuery(q: string) {
  return findByStudentId(q)
}

/** 撤回用：投递码 + 学号必须匹配「同一行」（双因子） */
export function getByCodeAndStudent(code: string, studentId: string) {
  const row = db.prepare(
    'SELECT id, code, student_id, dept, status, resume_path, work_path FROM submissions WHERE code = ? AND student_id = ? LIMIT 1'
  ).get(code, studentId)
  return row || null
}

/**
 * 管理端列表（分页 + 状态筛选 + 搜索 + 部门隔离）。
 * @param me         当前身份（必填；作用域由 deptOf(me) 推导，fail-closed）
 * @param deptFilter 仅 super 生效的可选部门筛选；部长传入会被忽略
 */
export function listSubmissions(
  me: Identity,
  status: string,
  search: string,
  page: number,
  size = 20,
  deptFilter: string | null = null,
) {
  const scope = deptOf(me)
  const where: string[] = []
  const params: any = {}
  if (status && status !== 'all') { where.push('status = @status'); params.status = status }
  if (search) { where.push('(name LIKE @s OR student_id LIKE @s OR code LIKE @s)'); params.s = `%${search}%` }
  // 部门作用域：部长强制本部门（deptFilter 被忽略）
  applyScope(where, params, scope)
  // 仅 super（scope === null）在显式传入合法部门时才做二次筛选
  if (scope === null && deptFilter && DEPT_KEYS.includes(deptFilter)) {
    where.push('dept = @deptFilter'); params.deptFilter = deptFilter
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  // total 与 rows 必须用同一 WHERE，否则 total 会泄露全量计数
  const total = (db.prepare(`SELECT COUNT(*) as c FROM submissions ${whereSql}`).get(params) as any).c
  const rows = db.prepare(
    `SELECT ${SUBMISSION_COLUMNS} FROM submissions ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit: size, offset: (page - 1) * size })
  return { total, rows, page, size }
}

/** 按 id 取单行（不受作用域限制；仅供 super-only 路由如改派使用） */
export function getSubmissionById(id: number) {
  return db.prepare(`SELECT ${SUBMISSION_COLUMNS} FROM submissions WHERE id = ?`).get(id) || null
}

/**
 * 更新状态 / 留言（带部门隔离）。
 * 关键纪律：用「改之前」的 dept 判断归属，防「先改后越权」；
 * 同时 WHERE 也带 dept 条件做纵深防御。
 * dept 绝不出现在字段白名单里 —— 部长塞 dept:'ai' 必须被静默忽略。
 * 返回 { changed, before }，before 供路由写审计日志（不含隐私字段）。
 */
export function updateSubmission(me: Identity, id: number, fields: { status?: string; admin_note?: string }) {
  const scope = deptOf(me)
  const row = db.prepare('SELECT code, dept, status, admin_note FROM submissions WHERE id = ?').get(id) as any
  // 先做归属判断（即使本次没有任何字段变更，也保持一致的不存在/无权响应，避免存在性 oracle）
  // 合并两处 404（记录不存在 / 非本部门）；状态码与文案保持不变
  if (!row || (scope !== null && row.dept !== scope)) throw recordNotFound()

  const sets: string[] = []
  const params: any = { id }
  if (fields.status !== undefined) { sets.push('status = @status'); params.status = fields.status }
  if (fields.admin_note !== undefined) { sets.push('admin_note = @admin_note'); params.admin_note = fields.admin_note }
  if (!sets.length) return { changed: false, before: row }

  // 记录审核人与审核时间
  sets.push('reviewer_id = @reviewer_id'); params.reviewer_id = me.id
  sets.push("reviewed_at = datetime('now', 'localtime')")
  sets.push("updated_at = datetime('now', 'localtime')")
  const whereDept = scope !== null ? ' AND dept = @dept' : ''
  if (scope !== null) params.dept = scope
  db.prepare(`UPDATE submissions SET ${sets.join(', ')} WHERE id = @id${whereDept}`).run(params)
  return { changed: true, before: row }
}

/** 统计（带部门隔离）。保留 SUM(...) || 0 空集兜底（空集时 SUM 返回 NULL）。 */
export function stats(me: Identity) {
  const scope = deptOf(me)
  const where: string[] = []
  const params: any = {}
  applyScope(where, params, scope)
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const r = db.prepare(`SELECT COUNT(*) as total,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='reviewing' THEN 1 ELSE 0 END) as reviewing,
    SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) as accepted,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
    FROM submissions ${whereSql}`).get(params) as any
  return {
    total: r.total || 0,
    pending: r.pending || 0,
    reviewing: r.reviewing || 0,
    accepted: r.accepted || 0,
    rejected: r.rejected || 0,
  }
}

/** 按部门分组统计（super-only），用于超管的部门总览 */
export function statsByDept() {
  return db.prepare(`SELECT dept,
    COUNT(*) as total,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='reviewing' THEN 1 ELSE 0 END) as reviewing,
    SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) as accepted,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
    FROM submissions GROUP BY dept`).all()
}

/** 导出（带部门隔离）：非 super 只会拿到本部门记录 */
export function allForExport(me: Identity) {
  const scope = deptOf(me)
  const where: string[] = []
  const params: any = {}
  applyScope(where, params, scope)
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  return db.prepare(
    `SELECT code, name, student_id, qq, phone, dept, work_url, status, admin_note, created_at
     FROM submissions ${whereSql} ORDER BY id ASC`
  ).all(params)
}

/**
 * 由文件名反查所属部门（files 接口的归属校验用）。
 * 返回 dept 字符串；查不到返回 null（调用方应对 null 与「非本部门」都返回 404）。
 */
export function getFileOwner(name: string): string | null {
  const row = db.prepare('SELECT dept FROM submissions WHERE resume_path = ? OR work_path = ? LIMIT 1').get(name, name) as any
  return row ? String(row.dept ?? '') : null
}

/** 硬删一行（撤回用）。刻意 DELETE：student_id 的列级 UNIQUE 随行删除而释放，学生可立即重投且无需重建表 */
export function deleteSubmission(id: number) {
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id)
}

/** 改派部门（super-only）。记录 dept_changed_by / dept_changed_at */
export function reassignDept(id: number, to: string, by: number) {
  db.prepare(`UPDATE submissions
    SET dept = @to, dept_changed_by = @by, dept_changed_at = datetime('now', 'localtime'),
        updated_at = datetime('now', 'localtime')
    WHERE id = @id`).run({ id, to, by })
}

// ============================================================================
// 后台账号（admins）
// ============================================================================

/** 登录用：按用户名取账号（含 password_hash） */
export function getAdminByUsername(username: string) {
  return db.prepare(
    'SELECT id, username, password_hash, role, dept, display_name, is_active, session_version FROM admins WHERE username = ? LIMIT 1'
  ).get(username) || null
}

/** 身份回查用：按 id 取账号（不含 password_hash）—— requireIdentity 每次请求调用 */
export function getAdminById(id: number) {
  return db.prepare(
    'SELECT id, username, role, dept, display_name, is_active, session_version FROM admins WHERE id = ? LIMIT 1'
  ).get(id) || null
}

export function createAdmin(username: string, password: string, role: string, dept: string, displayName: string): number {
  const hash = hashPassword(password)
  const info = db.prepare(
    'INSERT INTO admins (username, password_hash, role, dept, display_name) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, role, dept, displayName)
  return Number(info.lastInsertRowid)
}

export function listAdmins() {
  return db.prepare(
    'SELECT id, username, role, dept, display_name, is_active, created_at, updated_at FROM admins ORDER BY id ASC'
  ).all()
}

export function updateAdminPassword(id: number, password: string) {
  const hash = hashPassword(password)
  db.prepare("UPDATE admins SET password_hash = ?, session_version = session_version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?").run(hash, id)
}

/** 立即废止该管理员现有 token（用于退出登录等场景）。 */
export function bumpAdminSession(id: number) {
  db.prepare("UPDATE admins SET session_version = session_version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?").run(id)
}

export function setAdminActive(id: number, active: boolean) {
  db.prepare("UPDATE admins SET is_active = ?, session_version = session_version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?").run(active ? 1 : 0, id)
}

/** 修改角色与（dept 角色时的）部门 */
export function updateAdminRole(id: number, role: string, dept: string) {
  db.prepare("UPDATE admins SET role = ?, dept = ?, session_version = session_version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?").run(role, dept, id)
}

/** 统计 active 的 super 数量；excludeId 用于「排除自己后是否还有其它 super」的自锁判断 */
export function countActiveSupers(excludeId = 0): number {
  const r = db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super' AND is_active = 1 AND id <> ?").get(excludeId) as any
  return r.c || 0
}

/** 是否存在任何管理员账号（首次引导与登录接口判断用） */
export function hasAnyAdmin(): boolean {
  return Number((db.prepare('SELECT COUNT(*) as c FROM admins').get() as any)?.c || 0) > 0
}

/** 写审计日志。刻意不存姓名/QQ/手机，避免审计表变成第二份隐私库 */
export function audit(actorId: number, actorName: string, action: string, target: string, detail: string) {
  db.prepare(
    'INSERT INTO audit_log (actor_id, actor_name, action, target, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(actorId, actorName, action, target, detail)
}

// ============================================================================
// 首次引导：绝不允许「admins 表空时任意密码即可登录」（那等于把首次访问者送成超管）
//   有 ADMIN_PASSWORD → 建 admin / role='super' / dept=''
//   无 ADMIN_PASSWORD → 打醒目警告，登录接口会返回 500（见 login.post.ts）
// ============================================================================
if (!hasAnyAdmin()) {
  const pw = process.env.ADMIN_PASSWORD
  if (pw) {
    createAdmin('admin', pw, 'super', '', '超级管理员')
    console.warn('[jxtd] 首次引导：已根据 ADMIN_PASSWORD 创建超级管理员账号「admin」，请登录后尽快修改密码')
  } else {
    console.warn('⚠️ [jxtd] admins 表为空且未配置 ADMIN_PASSWORD —— 后台目前无法登录。请设置 ADMIN_PASSWORD 后重启以完成首次引导。')
  }
}

// ============================================================================
// 设置（公告）与文件工具
// ============================================================================
export function getSetting(key: string) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
  return r?.value || ''
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// 文件安全名：UUID + 原扩展名（防路径穿越）
export function safeFileName(original: string) {
  const ext = (original.match(/\.([A-Za-z0-9]{1,6})$/) || [])[1]?.toLowerCase() || ''
  return randomUUID().replace(/-/g, '') + (ext ? '.' + ext : '')
}

export default db
