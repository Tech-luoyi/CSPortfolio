// 学生自助撤回投递。
// 鉴权 = 投递码 + 学号「双因子必须匹配同一行」——投递码是递增序号，单因子等于「知道序号就能撤别人的」。
import { submissionsApp } from '../../infrastructure/bootstrap'
import { adminApp } from '../../infrastructure/bootstrap'
import { storageApp } from '../../infrastructure/bootstrap'

export default defineEventHandler(async (event) => {
  // 撤回限流 20 次/小时：校园网多为 NAT 共享出口，5/h 会变成「整栋楼共享同一配额」而误伤正常学生；
  // 撤回本身由「投递码 + 学号」双因子兜底（单因子不可用），无需靠严苛限额防爆破。
  rateLimit(event, 'withdraw', 20, 3600 * 1000)
  const body = await readBody(event).catch(() => ({}))
  const code = String(body?.code || '').trim()
  const sid = String(body?.student_id || '').trim()
  if (!code || !sid) throw createError({ statusCode: 400, statusMessage: '请提供投递码与学号' })

  const row = submissionsApp.findByCodeAndStudent(code, sid) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '投递码或学号有误' })

  // 状态限制：pending / rejected 可撤；reviewing / accepted 不可撤
  if (row.status === 'reviewing' || row.status === 'accepted') {
    throw createError({ statusCode: 409, statusMessage: '该投递已进入审核流程，无法撤回，请联系部长' })
  }

  const resumeFile = String(row.resume_path || '')
  const workFile = String(row.work_path || '')

  // 顺序：先删 DB 行，再「尽力」删文件。
  // 反过来若 DB 删失败会留下「记录指向已删文件」的坏数据。
  //
  // 硬删（DELETE）是刻意的：student_id 的列级 UNIQUE 随行删除而释放，
  // 学生可立即重投，且无需重建表（SQLite 无法在线改列级约束，软删就得重建表）。
  // settings.code_seq_<年> 完全不碰 ——「序号绝不回退」天然满足。
  submissionsApp.remove(row.id)
  try {
    for (const f of [resumeFile, workFile]) {
      if (f) await storageApp.delete(f).catch(() => {})
    }
  } catch { /* 文件删除失败不影响撤回结果 */ }

  // 审计：记 code + dept + 时间，不存姓名
  adminApp.audit(0, '', 'withdraw', code, `dept=${row.dept}`)
  return { ok: true, message: '已撤回。旧投递码已作废，重新投递会得到新码' }
})
