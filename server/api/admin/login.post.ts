// 管理员登录：用户名 + 密码 → httpOnly Cookie（30 天）
export default defineEventHandler(async (event) => {
  rateLimit(event, 'adminlogin', 10, 600 * 1000) // 10 分钟最多 10 次，防爆破

  // 首次引导未完成（admins 为空且无 ADMIN_PASSWORD）→ 明确 500，绝不允许「任意密码登录」
  if (!hasAnyAdmin()) {
    throw createError({ statusCode: 500, statusMessage: '服务端未初始化管理员账号，请配置 ADMIN_PASSWORD 后重启' })
  }

  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')

  const admin = (username ? getAdminByUsername(username) : null) as any
  let ok = false
  if (admin && admin.is_active) {
    ok = verifyPassword(password, admin.password_hash)
  } else {
    // 用户名不存在 / 已停用：也跑一次哈希比对，抹平响应耗时，防账号枚举
    verifyPassword(password, DUMMY_HASH)
  }
  if (!ok) throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })

  // cookie 换名 jx_admin → jx_admin_v2：旧格式与新格式不兼容，换名让旧 cookie 自然作废
  setCookie(event, 'jx_admin_v2', makeToken(admin.id, Number(admin.session_version || 1)), {
    httpOnly: true, sameSite: 'lax', secure: true, maxAge: 30 * 24 * 3600, path: '/'
  })
  return {
    ok: true,
    me: { id: admin.id, username: admin.username, role: admin.role, dept: admin.dept, display_name: admin.display_name }
  }
})
