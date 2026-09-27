// 提交投递：multipart 流式解析（文件收集逻辑对齐 upload-api）
//
// 相较旧实现的三处改动：
// 1. 流式落盘 —— busboy 边收边写，不再把整个请求缓冲进内存
//    （旧版 readMultipartFormData 会先读完整个 body 才判断 25MB，1.6G 内存的机器上是个靶子）
// 2. 魔数校验 —— 文件落盘后读文件头比对真实类型，扩展名不再单独可信
// 3. 失败回滚 —— 任何一步出错都把已写入的文件删干净，不留孤儿文件
import busboy from 'busboy'
import { createWriteStream } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

// 单个文件大小：简历 25 MiB，作品附件 1 GiB。流式写盘，避免把大作品读进内存。
const MAX_RESUME_BYTES = 25 * 1024 * 1024
const MAX_WORK_BYTES = 1024 * 1024 * 1024
const MAX_FILES = 2
const MAX_FIELDS = 20
const MAX_FIELD_BYTES = 4 * 1024

// 简历只收文档/图片；作品额外允许压缩包
const RESUME_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png'])
const WORK_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'zip'])

// 扩展名 → 期望的真实类型
const KIND_OF_EXT: Record<string, string> = {
  pdf: 'pdf', jpg: 'jpg', jpeg: 'jpg', png: 'png', zip: 'zip'
}

const SIG_PDF = Buffer.from('%PDF-')
const SIG_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// 读文件头判断真实类型（文件头不会因为改扩展名而改变）
async function sniffKind(path: string): Promise<string | null> {
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(8)
    const { bytesRead } = await handle.read(head, 0, 8, 0)
    if (bytesRead < 4) return null
    if (head.subarray(0, 5).equals(SIG_PDF)) return 'pdf'
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
    if (head.subarray(0, 8).equals(SIG_PNG)) return 'png'
    // ZIP 的本地文件头 / 空归档尾记录
    if (head[0] === 0x50 && head[1] === 0x4b) return 'zip'
    return null
  } finally {
    await handle.close()
  }
}

function extOf(filename: string): string {
  return (filename.match(/\.([A-Za-z0-9]{1,6})$/) || [])[1]?.toLowerCase() || ''
}

interface Stored {
  storageName: string
  originalName: string
  size: number
  ext: string
}

export default defineEventHandler(async (event) => {
  // 同 IP 每小时最多 100 次。
  // 招新时同学多在同一校园网 NAT 出口后面，此前的 10 次/小时会把整个宿舍
  // 或教学楼的人挡在门外（实测同 IP 第 11 个请求就开始 429）。
  rateLimit(event, 'submit', 100, 3600 * 1000)

  const req = event.node.req
  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.startsWith('multipart/form-data')) {
    throw createError({ statusCode: 400, statusMessage: '请求格式不正确' })
  }

  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
  await mkdir(uploadDir, { recursive: true })

  const fields: Record<string, string> = {}
  const stored: Record<string, Stored> = {}
  const writtenPaths: string[] = []
  const outputs: any[] = []
  let failure: any = null

  // 只记第一个错误，避免后续清理动作覆盖掉真正的失败原因
  const fail = (statusCode: number, statusMessage: string) => {
    if (!failure) failure = createError({ statusCode, statusMessage })
  }

  const bus = busboy({
    headers: req.headers,
    limits: {
      fileSize: MAX_WORK_BYTES,
      files: MAX_FILES,
      fields: MAX_FIELDS,
      fieldSize: MAX_FIELD_BYTES,
      parts: MAX_FILES + MAX_FIELDS
    }
  })

  const pending: Promise<void>[] = []

  bus.on('field', (name: string, value: string) => {
    if (!(name in fields)) fields[name] = String(value).trim()
  })
  bus.on('filesLimit', () => fail(400, '文件数量超出限制'))
  bus.on('fieldsLimit', () => fail(400, '表单字段过多'))
  bus.on('partsLimit', () => fail(400, '请求内容过多'))

  bus.on('file', (name: string, stream: any, info: any) => {
    const slot = name === 'resume' ? 'resume' : name === 'work' ? 'work' : null
    const originalName = String(info?.filename || '')
    const ext = extOf(originalName)
    const allowed = slot === 'resume' ? RESUME_EXT : slot === 'work' ? WORK_EXT : null

    // 字段名不认识 / 同一字段重复 / 扩展名不在白名单 —— 丢弃数据，不落盘
    if (!slot || stored[slot] || !allowed || !allowed.has(ext)) {
      if (!slot) fail(400, '存在无法识别的文件字段')
      else if (!allowed) fail(400, '文件字段不合法')
      else if (stored[slot]) fail(400, '同一文件字段重复提交')
      else fail(400, `不支持的文件类型：${ext ? '.' + ext : '（无扩展名）'}（仅允许 ${[...allowed].join('/')}）`)
      stream.resume()
      return
    }

    // 前一个文件已经失败时，继续排空当前流但不再落盘，避免无意义地写入大文件。
    if (failure) {
      stream.resume()
      return
    }

    const storageName = safeFileName(originalName)
    const target = join(uploadDir, storageName)
    writtenPaths.push(target)
    const output = createWriteStream(target, { flags: 'wx' })
    outputs.push(output)

    const maxBytes = slot === 'resume' ? MAX_RESUME_BYTES : MAX_WORK_BYTES
    const maxLabel = slot === 'resume' ? '简历' : '作品'
    const maxText = slot === 'resume' ? '25MB' : '1GB'
    let observedBytes = 0
    let truncated = false
    const record: Stored = { storageName, originalName, size: 0, ext }

    // 简历有比 busboy 全局上限更小的独立上限，因此同时做按字段计数。
    // 超过上限时必须先把 source 从 pipe 上摘下来、收尾输出流、再把 source
    // resume 排空；否则 busboy 会因无人读取而停住，整个请求可能死锁。
    stream.on('data', (chunk: Buffer) => {
      if (truncated || failure) return
      observedBytes += chunk.length
      if (observedBytes > maxBytes) {
        truncated = true
        fail(413, `${maxLabel}文件超过 ${maxText} 限制`)
        stream.unpipe(output)
        output.end()
        stream.resume()
      }
    })
    // 作品超过 1 GiB 时由 busboy 全局上限触发；简历通常会先被上面的字段上限拦截。
    stream.on('limit', () => {
      truncated = true
      fail(413, `${maxLabel}文件超过 ${maxText} 限制`)
      stream.unpipe(output)
      output.end()
      stream.resume()
    })

    pending.push(new Promise<void>((resolve) => {
      output.on('close', () => {
        if (truncated || failure) return resolve()
        record.size = output.bytesWritten
        stored[slot] = record
        resolve()
      })
      output.on('error', () => { fail(500, '文件写入失败'); resolve() })
      stream.on('error', () => { fail(400, '上传中断'); resolve() })
      stream.pipe(output)
    }))
  })

  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    bus.on('close', done)
    bus.on('error', () => { fail(400, '表单解析失败'); done() })
    req.on('error', () => { fail(400, '请求中断'); done() })
    req.on('aborted', () => {
      fail(400, '请求已中断')
      // 客户端半途断开时输出流不会自然收尾，必须显式关掉，
      // 否则 pending 永远不 resolve，回滚逻辑也就跑不到，文件会变成孤儿。
      for (const o of outputs) o.destroy()
      done()
    })
    req.pipe(bus)
  })

  // 兜底：正常情况下 pending 早已 resolve；万一还有流悬挂也不能让请求永远挂着
  await Promise.race([
    Promise.all(pending),
    new Promise((resolve) => setTimeout(resolve, 10_000))
  ])

  // 任何一步失败都把本次已写入的文件删干净，不留孤儿
  const rollback = async () => {
    await Promise.all(writtenPaths.map(p => unlink(p).catch(() => {})))
  }

  if (failure) {
    await rollback()
    throw failure
  }

  if (!stored.resume) {
    await rollback()
    throw createError({ statusCode: 400, statusMessage: '请上传简历文件' })
  }

  // 魔数校验：扩展名可以随便改，文件头不会骗人
  for (const [slot, label] of [['resume', '简历'], ['work', '作品']] as const) {
    const item = stored[slot]
    if (!item) continue
    const actual = await sniffKind(join(uploadDir, item.storageName))
    if (!actual || actual !== KIND_OF_EXT[item.ext]) {
      await rollback()
      throw createError({
        statusCode: 415,
        statusMessage: `${label}文件内容与扩展名不符（.${item.ext}），请上传真实文件`
      })
    }
  }

  // 部门校验放在流式解析之后：dept 白名单 + 按部门作品策略（hidden 不收作品 / required 作品必填）
  const invalid = validateSubmission(fields, fields.dept || '', !!stored.work)
  if (invalid) {
    await rollback()
    throw createError({ statusCode: 400, statusMessage: invalid })
  }

  // 学号唯一性预检查（DB 层 UNIQUE 仍作为最终兜底）。
  // 409 回显已有记录的投递码（P1-3：学生自己的信息，不构成泄露；免去「反复试」）
  const existing = findByStudentId(fields.student_id) as any
  if (existing) {
    await rollback()
    throw createError({ statusCode: 409, statusMessage: `该学号已投递过，你的投递码是 ${existing.code}，请截图保存并到查询页查看进度` })
  }

  try {
    const code = createSubmission({
      name: fields.name,
      student_id: fields.student_id,
      qq: fields.qq,
      phone: fields.phone || '',
      dept: fields.dept || '',
      resume_path: stored.resume.storageName,
      resume_name: stored.resume.originalName,
      work_url: fields.work_url || '',
      work_path: stored.work?.storageName || '',
      work_name: stored.work?.originalName || '',
      intro: fields.intro || ''
    })
    return { ok: true, code, message: '投递成功！请截图保存你的投递码' }
  } catch (err: any) {
    await rollback()
    if (String(err?.message || '').includes('UNIQUE')) {
      // DB UNIQUE 兜底（并发竞态）：同样回显已有记录的投递码
      const dup = findByStudentId(fields.student_id) as any
      throw createError({
        statusCode: 409,
        statusMessage: dup
          ? `该学号已投递过，你的投递码是 ${dup.code}，请截图保存并到查询页查看进度`
          : '该学号已投递过，请通过查询页查看进度'
      })
    }
    throw createError({ statusCode: 500, statusMessage: '保存失败，请稍后重试' })
  }
})
