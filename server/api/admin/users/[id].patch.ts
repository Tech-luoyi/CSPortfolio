// 修改账号：改密码 / 停用启用 / 改角色部门（仅超级管理员，含自锁防护）
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  if (me.role !== 'super') throw createError({ statusCode: 403, statusMessage: '仅超级管理员可管理账号' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: '非法 ID' })
  const body = await readBody(event).catch(() => ({}))
  if (body.password !== undefined) {
    const pw = String(body.password)
    if (pw.length < 8 || pw.length > 128) {
      throw createError({ statusCode: 400, statusMessage: '密码需为 8-128 位' })
    }
  }
  if (body.role !== undefined && body.role !== 'super' && body.role !== 'dept') {
    throw createError({ statusCode: 400, statusMessage: '角色不合法' })
  }
  if (body.is_active !== undefined &&
      ![true, false, 0, 1, '0', '1'].includes(body.is_active)) {
    throw createError({ statusCode: 400, statusMessage: '启用状态不合法' })
  }
  const target = getAdminById(id) as any
  if (!target) throw createError({ statusCode: 404, statusMessage: '账号不存在' })

  // 自锁防护 1：禁止改自己的 role
  if (body.role !== undefined && id === me.id) {
    throw createError({ statusCode: 400, statusMessage: '不能修改自己的角色' })
  }
  // 自锁防护 2：禁止停用自己
  if (body.is_active !== undefined && id === me.id) {
    const active = body.is_active === true || body.is_active === 1 || body.is_active === '1'
    if (!active) throw createError({ statusCode: 400, statusMessage: '不能停用自己的账号' })
  }

  // 改密码
  if (body.password !== undefined) {
    const pw = String(body.password)
    if (pw.length < 8 || pw.length > 128) throw createError({ statusCode: 400, statusMessage: '密码需为 8-128 位' })
    updateAdminPassword(id, pw)
    audit(me.id, me.username, 'user_password', target.username, '')
  }

  // 停用 / 启用
  if (body.is_active !== undefined) {
    const active = body.is_active === true || body.is_active === 1 || body.is_active === '1'
    // 自锁防护 3：禁止停用最后一个 active super
    if (!active && target.role === 'super' && countActiveSupers(id) === 0) {
      throw createError({ statusCode: 400, statusMessage: '不能停用最后一个超级管理员' })
    }
    setAdminActive(id, active)
    audit(me.id, me.username, active ? 'user_enable' : 'user_disable', target.username, '')
  }

  // 改角色（改自己已被上面拦截）
  if (body.role !== undefined) {
    const role = body.role === 'super' ? 'super' : 'dept'
    // 自锁防护 4：禁止降级最后一个 active super
    if (target.role === 'super' && role !== 'super' && countActiveSupers(id) === 0) {
      throw createError({ statusCode: 400, statusMessage: '不能降级最后一个超级管理员' })
    }
    const dept = role === 'super' ? '' : String(body.dept || target.dept || '').trim()
    if (role === 'dept' && !DEPT_KEYS.includes(dept)) throw createError({ statusCode: 400, statusMessage: '部门不合法' })
    updateAdminRole(id, role, dept)
    audit(me.id, me.username, 'user_role', target.username, `${target.role} -> ${role}`)
  } else if (body.dept !== undefined && target.role !== 'super') {
    // 仅改部门（dept 账号）
    const dept = String(body.dept).trim()
    if (!DEPT_KEYS.includes(dept)) throw createError({ statusCode: 400, statusMessage: '部门不合法' })
    updateAdminRole(id, 'dept', dept)
    audit(me.id, me.username, 'user_dept', target.username, `dept=${dept}`)
  }

  return { ok: true }
})
