// 管理端：投递列表（分页 + 状态筛选 + 搜索）+ 统计（全部按登录身份的部门隔离）
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  const q = getQuery(event)
  const status = String(q.status || 'all')
  const search = String(q.search || '').slice(0, 30)
  const page = Math.max(1, Number(q.page) || 1)
  // 仅 super 可传 dept 参数做二次筛选；部长传的 dept 会被 listSubmissions 内部忽略
  const deptFilter = me.role === 'super' ? (String(q.dept || '').trim() || null) : null

  const { total, rows, size } = listSubmissions(me, status, search, page, 20, deptFilter)
  const payload: any = {
    ok: true,
    data: { total, rows: rows.map((r: any) => ({ ...r, admin: true })), page, size },
    stats: stats(me),
  }
  // super 额外返回按部门分组的统计，供后台部门标签页使用
  if (me.role === 'super') payload.byDept = statsByDept()
  return payload
})
