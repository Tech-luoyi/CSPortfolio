import { advanceSequenceFloor, db, getSequenceFloor } from '../../infrastructure/database/sqlite'
import { getCurrentCampaign, getSetting, setSetting } from './campaigns-settings'
import { DEPT_KEYS } from '../../utils/departments'
import { deptOf, type Identity, type Scope } from '../../domain/auth/identity'
import { nextSequence, formatSubmissionCode } from '../../domain/submission/numbering'

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
// 显式列白名单：替换 SELECT *，避免无意中把新增的敏感列暴露给列表接口。
// resume_path / work_path 必须保留 —— 后台要凭它拼 /api/admin/files/<name> 下载 URL。
// 【安全依赖】它之所以安全，是因为 files 接口会反查文件归属并做部门校验；
// 若日后改动 files 接口的归属判断，必须同步维护这里的列清单（不要把路径暴露给跨部门用户）。
const SUBMISSION_COLUMNS =
  'id, code, name, student_id, qq, phone, dept, campaign_id, resume_path, resume_name, work_url, work_path, work_name, ' +
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
  db.exec('BEGIN IMMEDIATE')
  let code = ''
  try {
    const campaign = getCurrentCampaign() as any
    if (!campaign) throw new Error('当前没有开放的招新活动')
    const year = Number(campaign.year)
    if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('当前招新活动年份无效')
    const seqKey = `code_seq_${year}`
    const storedSeq = Number(getSetting(seqKey) || 0)
    const rows = db.prepare('SELECT code FROM submissions WHERE code GLOB ?').all(`JX-${year}-*`) as any[]
    const pattern = new RegExp(`^JX-${year}-(\\d+)$`)
    const maxExisting = rows.reduce((max, row) => Math.max(max, Number(String(row.code).match(pattern)?.[1] || 0)), 0)
    const next = nextSequence(storedSeq, maxExisting, getSequenceFloor(year))
    code = formatSubmissionCode(year, next)
    db.prepare(`INSERT INTO submissions
      (code, name, student_id, qq, phone, dept, campaign_id, resume_path, resume_name, work_url, work_path, work_name, intro)
      VALUES (@code, @name, @student_id, @qq, @phone, @dept, @campaign_id, @resume_path, @resume_name, @work_url, @work_path, @work_name, @intro)`)
      .run({ code, campaign_id: campaign.id, work_url: '', work_path: '', work_name: '', phone: '', dept: '', intro: '', ...data })
    setSetting(seqKey, String(next))
    advanceSequenceFloor(year, next)
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
export function findByStudentId(studentId: string, campaignId?: string) {
  const campaign = campaignId || (getCurrentCampaign() as any)?.id
  const row = campaign
    ? db.prepare('SELECT code, name, dept, status, admin_note, created_at FROM submissions WHERE student_id = ? AND campaign_id = ? ORDER BY id DESC LIMIT 1').get(studentId, campaign)
    : db.prepare('SELECT code, name, dept, status, admin_note, created_at FROM submissions WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(studentId)
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
    'SELECT id, code, student_id, dept, campaign_id, status, resume_path, work_path FROM submissions WHERE code = ? AND student_id = ? LIMIT 1'
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
