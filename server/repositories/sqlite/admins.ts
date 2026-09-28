import { db } from '../../infrastructure/database/sqlite'
import { hashPassword } from '../../utils/crypto'

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
