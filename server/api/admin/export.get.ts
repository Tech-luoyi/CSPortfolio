import { submissionsApp } from '../../infrastructure/bootstrap'

// 管理端：导出记录 CSV（含 BOM，Excel 打开不乱码）。非 super 只能导出本部门。
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  const rows: any[] = submissionsApp.export(me)
  const header = ['投递码', '姓名', '学号', 'QQ', '手机号', '部门', '作品链接', '状态', '管理员留言', '投递时间']
  const statusMap: Record<string, string> = { pending: '待审核', reviewing: '审核中', accepted: '免试通过', rejected: '未通过' }
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [header.map(esc).join(',')]
  for (const r of rows) {
    lines.push([
      r.code, r.name, r.student_id, r.qq, r.phone,
      deptName(r.dept), r.work_url,
      statusMap[r.status] || r.status, r.admin_note, r.created_at
    ].map(esc).join(','))
  }
  // 文件名带部门：super → all，部长 → 部门 key
  const scopeTag = me.role === 'super' ? 'all' : (me.dept || 'dept')
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="jx-submissions-${scopeTag}-${Date.now()}.csv"`)
  return '\ufeff' + lines.join('\n')
})
