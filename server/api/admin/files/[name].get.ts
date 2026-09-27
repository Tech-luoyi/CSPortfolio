// 管理端：下载/预览上传的文件（仅管理员，且必须属于本部门）
// 安全关键：绝不能「只校验文件名格式就按名读盘」——必须先从 DB 反查文件归属，
// 否则配合列表接口暴露的路径，可下载全站简历。
import { join, extname } from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  const me = requireIdentity(event)
  const name = String(getRouterParam(event, 'name') || '')
  // 只允许纯文件名（UUID.ext），杜绝路径穿越
  if (!/^[a-f0-9]{32}\.[a-z0-9]{1,6}$/i.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '非法文件名' })
  }

  // 归属校验：查不到 → 404；存在但非本部门（且非 super）→ 404。
  // 用 404 而非 403：403 等于确认「该文件存在，只是不属于你」，可横向枚举文件名。
  const scope = deptOf(me)
  const owner = getFileOwner(name)
  // 合并两处 404 判断（语义等价：查不到文件 / 查到了但不属于本部门）；状态码与文案保持不变
  if (owner === null || (scope !== null && owner !== scope)) {
    throw createError({ statusCode: 404, statusMessage: '文件不存在' })
  }

  const base = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
  const full = join(base, name)
  const info = await stat(full).catch(() => null)
  if (!info || !info.isFile()) throw createError({ statusCode: 404, statusMessage: '文件不存在' })

  const ext = extname(name).toLowerCase()
  const types: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.zip': 'application/zip'
  }
  setHeader(event, 'Content-Type', types[ext] || 'application/octet-stream')
  setHeader(event, 'Content-Disposition', `attachment; filename="${name}"`)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  // 流式返回，避免把整份文件读进内存
  return sendStream(event, createReadStream(full))
})
