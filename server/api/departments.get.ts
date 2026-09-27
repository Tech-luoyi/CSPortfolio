// 公开：部门字典（无密钥），供前端渲染部门下拉，避免前端硬编码
export default defineEventHandler(() => {
  return { ok: true, departments: DEPARTMENTS }
})
