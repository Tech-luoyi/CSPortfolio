// 超管改派投递到其它部门（独立接口：语义清晰、权限边界独立、只在 super 路由加守卫）
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  // 功能级无权 → 403（对部长而言是「功能不存在」，不涉及资源存在性，不产生 oracle）
  if (me.role !== 'super') throw createError({ statusCode: 403, statusMessage: '仅超级管理员可改派部门' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: '非法 ID' })
  const body = await readBody(event).catch(() => ({}))
  const to = String(body?.dept ?? body?.to ?? '').trim()
  if (!DEPT_KEYS.includes(to)) throw createError({ statusCode: 400, statusMessage: '目标部门不合法' })

  const row = getSubmissionById(id) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '记录不存在' })

  const from = String(row.dept || '')
  if (from === to) return { ok: true, warning: null, from, to }

  // 改到「作品必填」部门但记录无作品 —— 允许并返回 warning（改派是补救动作，硬拒会把流程卡死）
  let warning: string | null = null
  const policy = deptPolicy(to)
  const hasWork = !!row.work_url || !!row.work_path
  if (policy?.work === 'required' && !hasWork) {
    warning = `目标部门（${deptName(to)}）要求作品，但该记录没有作品，请线下补充`
  }
  // 改到文秘部（作品隐藏）时：保留 work_path / work_url 与文件，绝不删除（不可逆）
  reassignDept(id, to, me.id)
  audit(me.id, me.username, 'reassign', row.code, `${from} -> ${to}`)
  return { ok: true, warning, from, to }
})
