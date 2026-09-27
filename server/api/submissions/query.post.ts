// 凭投递码 + 学号查询审核状态；不再支持仅凭可枚举学号读取个人信息。
export default defineEventHandler(async (event) => {
  rateLimit(event, 'query', 30, 3600 * 1000)
  const body = await readBody(event).catch(() => ({}))
  const code = String(body?.code || body?.q || '').trim()
  const studentId = String(body?.student_id || '').trim()
  if (!/^JX-\d{4}-\d{1,20}$/i.test(code) || !/^[A-Za-z0-9]{6,20}$/.test(studentId)) {
    throw createError({ statusCode: 400, statusMessage: '请输入投递码和学号' })
  }
  const row = findPublicByCodeAndStudent(code, studentId)
  if (!row) throw createError({ statusCode: 404, statusMessage: '投递码或学号有误' })
  return { ok: true, data: row }
})
