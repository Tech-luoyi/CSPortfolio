// 当前登录身份（前端修登录态判定 bug 依赖它：与数据量彻底解耦）
export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  return { ok: true, me }
})
