// 服务端工具：管理员鉴权 + 限流 + 校验
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getAdminById } from './db'
import type { Identity } from './db'
import { DEPT_KEYS, deptPolicy } from './departments'

// ============================================================================
// 签名密钥：缺失或过短直接抛错拒绝启动。
// 旧代码是 SESSION_SECRET || ADMIN_PASSWORD || 'jx-fallback-secret' ——
// 两者都缺时退化为「公开常量密钥」，任何人都能伪造超管 token，必须删掉这个 fallback。
// ============================================================================
const SECRET = (() => {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET 缺失或过短（至少 16 字符）：拒绝启动，避免使用可预测的签名密钥')
  }
  return s
})()

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex')
}

// ---------- 管理员会话 token（HMAC 签名，无状态，30 天有效） ----------
// 【最关键的一条】token 里只放 uid，绝不放 dept / role。
// 若 token 缓存了 dept：超管改派部门或停用账号后，原部长手里的旧 cookie 仍带旧 dept，
// 查询条件继续按旧部门过滤 → 原部长仍能看到已改派的记录，构成越权。
// 因此 requireIdentity 每次请求都从 DB 回查当前身份。
export function makeToken(uid: number, sessionVersion = 1): string {
  const payload = base64url(JSON.stringify({ uid, sv: sessionVersion, exp: Date.now() + TOKEN_TTL_MS, ver: 3 }))
  return `${payload}.${sign(payload)}`
}

/** 校验 token，成功返回 uid + 会话版本，失败返回 null。 */
function verifyTokenData(token: string | undefined): { uid: number; sessionVersion: number } | null {
  if (!token) return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0 || idx >= token.length - 1) return null
  const payload = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expect = sign(payload)
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expect, 'hex'))) return null
  } catch {
    return null
  }
  let obj: any
  try {
    obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const uid = Number(obj?.uid)
  const exp = Number(obj?.exp)
  const sessionVersion = Number(obj?.sv ?? 1)
  if (!Number.isInteger(uid) || uid <= 0) return null
  if (!Number.isInteger(sessionVersion) || sessionVersion <= 0) return null
  if (!exp || exp < Date.now()) return null
  return { uid, sessionVersion }
}

/** 保留旧调用契约；需要会话版本时使用 requireIdentity。 */
export function verifyToken(token: string | undefined): number | null {
  return verifyTokenData(token)?.uid ?? null
}

// 中间件：校验管理员 Cookie 并回查身份。
// 注意：由 requireAdmin 改名为 requireIdentity（不是改签名）。
// 原函数返回 void，若只改签名，漏改的调用方不会报错、只会静默越权；
// 改名能让漏改处直接变成 ReferenceError，把静默失败变成显式失败。
export function requireIdentity(event: any): Identity {
  const cookies = parseCookies(event) as Record<string, string>
  const token = verifyTokenData(cookies?.jx_admin_v2)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const me = getAdminById(token.uid) as any
  // 每请求回查 DB：改派/停用/密码修改/退出立即生效，不依赖客户端 cookie 的内容。
  if (!me || !me.is_active || Number(me.session_version || 1) !== token.sessionVersion) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return { id: me.id, username: me.username, role: me.role, dept: me.dept, display_name: me.display_name }
}

// ---------- 内存限流：同 IP 单位时间内最多 N 次 ----------
// 来源 IP 取自 Caddy 显式覆写的 XFF（见 Caddyfile 的 `header_up X-Forwarded-For {http.request.remote.host}`）；
// 已实测客户端伪造的 XFF 会被 Caddy 覆盖，无法借此绕过限流。
// 不要改成读 socket 地址：容器内所有请求的远端都是 Caddy 容器的同一个内网 IP，
// 那样等于全站共用一个配额桶，一个人就能把所有人挡在门外，比现在更糟。
const buckets = new Map<string, number[]>()
export function rateLimit(event: any, key: string, max: number, windowMs: number) {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const k = `${key}:${ip}`
  const now = Date.now()
  const list = (buckets.get(k) || []).filter((t: number) => now - t < windowMs)
  if (list.length >= max) {
    throw createError({ statusCode: 429, statusMessage: '请求太频繁，请稍后再试' })
  }
  list.push(now)
  buckets.set(k, list)
  // 简单清理防止内存膨胀
  if (buckets.size > 5000) {
    for (const [bk, bl] of buckets) if (bl.every((t: number) => now - t >= windowMs)) buckets.delete(bk)
  }
}

// ---------- 输入校验 ----------
/**
 * 校验投递字段。
 * @param body        文本表单字段
 * @param dept        意向部门（稳定 key）——必须做白名单校验，否则学生可传 dept=火星部 完成数据面越权
 * @param hasWorkFile 是否已上传作品文件（由上传路由在文件落盘后告知）；作品策略据此判断
 */
export function validateSubmission(body: any, dept: string, hasWorkFile = false): string | null {
  if (!body) return '请求体为空'
  const name = String(body.name || '').trim()
  const studentId = String(body.student_id || '').trim()
  const qq = String(body.qq || '').trim()
  if (name.length < 1 || name.length > 20) return '姓名不合法'
  if (!/^[A-Za-z0-9]{6,20}$/.test(studentId)) return '学号不合法（6-20 位字母数字）'
  if (!/^[1-9][0-9]{4,11}$/.test(qq)) return 'QQ 号不合法'
  if (body.phone && !/^1[0-9]{10}$/.test(String(body.phone))) return '手机号不合法'
  if (body.work_url && !/^https?:\/\/.+/i.test(String(body.work_url))) return '作品链接须以 http(s):// 开头'
  if (body.intro && String(body.intro).length > 200) return '自荐最多 200 字'

  // 部门白名单
  const key = String(dept || '').trim()
  if (!key || !DEPT_KEYS.includes(key)) return '意向部门不合法'
  const policy = deptPolicy(key)
  if (!policy) return '意向部门不合法'

  const hasWorkUrl = !!String(body.work_url || '').trim()
  if (policy.work === 'hidden') {
    // 文秘部：隐藏作品区块、不接受作品字段
    if (hasWorkUrl || hasWorkFile) return `${policy.name}不接收作品，请勿提交作品链接或作品附件`
  } else if (policy.work === 'required') {
    // 作品必填部门：作品链接或作品附件至少一个
    if (!hasWorkUrl && !hasWorkFile) return `${policy.name}需要提交作品（作品链接或作品附件至少一个）`
  }
  return null
}
