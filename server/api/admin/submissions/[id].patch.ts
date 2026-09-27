// 管理端：更新状态 / 留言（部门隔离 + 审计）
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: '非法 ID' })
  const body = await readBody(event).catch(() => ({}))
  const fields: any = {}
  if (body.status !== undefined) {
    const s = String(body.status)
    if (!['pending', 'reviewing', 'accepted', 'rejected'].includes(s)) {
      throw createError({ statusCode: 400, statusMessage: '非法状态' })
    }
    fields.status = s
  }
  if (body.admin_note !== undefined) fields.admin_note = String(body.admin_note).slice(0, 200)
  // dept 不在字段白名单里：部长在 body 里塞 dept:'ai' 会被静默忽略
  // updateSubmission 内部用「改之前」的 dept 判断归属，非本部门 / 不存在 → 404（响应体一致）
  const result = updateSubmission(me, id, fields)
  if (result.changed && fields.status !== undefined) {
    audit(me.id, me.username, 'status', result.before.code, `${result.before.status} -> ${fields.status}`)
  }
  if (result.changed && fields.admin_note !== undefined) {
    audit(me.id, me.username, 'note', result.before.code, '')
  }
  return { ok: true }
})
