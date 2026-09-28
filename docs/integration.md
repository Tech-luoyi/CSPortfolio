# CSPortfolio 接口对接文档

> 基于 VPS `/opt/jxtd` 当前代码，2026-09-28；供学生端、管理端及受控的校内系统对接。接口尚未版本化，变更时须同步回归和更新本文。不要将本项目的私有数据目录当作集成接口。

## 1. 接入边界

- 基础地址：部署环境的 HTTPS 站点根地址，以下以 `https://<your-domain>` 表示；路径均以 `/api` 开头。
- 推荐浏览器与 API **同源**访问；当前未承诺跨源 CORS。跨源系统应由其服务端建立受控代理，先评审认证、来源与个人信息处理，不应在浏览器中直连并假设已开放 CORS。
- 请求、响应 JSON 默认为 UTF-8；投递为 `multipart/form-data`，浏览器传 `FormData` 时不要手动设置带 boundary 的 `Content-Type`。
- 所有响应包含 `X-Request-Id`；报障时提供此值、发生时间、路由和 HTTP 状态，不提供学生个人信息、Cookie 或文件内容。
- 成功响应通常有 `ok: true`；失败为非 2xx，错误文案以 `statusMessage` 为主。调用方以 HTTP 状态判断，不要依赖中文文案稳定性。
- 管理 API 使用 Secure、HttpOnly、SameSite=Lax Cookie `jx_admin_v2`；浏览器同源请求自动携带，跨域 `fetch` 不能默认依赖 Cookie。不要将密码或 Cookie 写入前端日志或 URL。

## 2. 学生端接口

| 方法与路径 | 入参 | 成功响应重点 | 备注 |
|---|---|---|---|
| `GET /api/departments` | 无 | `{ok, departments:[{key,name,work}]}` | `work` 为 `required` 或 `hidden`；部门以接口为准，不硬编码。 |
| `GET /api/campaigns/current` | 无 | `{ok, campaign:{id,year,slug,name,status}}` | 无开放活动时 503。学生不得自行指定 `campaign_id`。 |
| `GET /api/announcement` | 无 | `{ok, announcement}` | 公开公告。 |
| `POST /api/submissions` | multipart，见下文 | `{ok, code, message}` | 成功后立即保存投递码；同学号重复可能 409。 |
| `POST /api/submissions/query` | JSON `{code,student_id}` | `{ok,data:{code,name,dept,status,admin_note,created_at}}` | 两项必须匹配同一条记录；错误返回 404，不返回 QQ/手机号/附件。 |
| `POST /api/submissions/withdraw` | JSON `{code,student_id}` | `{ok,message}` | 仅 `pending`、`rejected` 可撤；`reviewing`、`accepted` 返回 409；撤回使旧码失效。 |

投递码格式为 `JX-年份-序号`（例如 `JX-2026-0011`），不可由客户端推算或自增。学号为 6–20 位字母数字；查询接口兼容 `q` 作为 `code` 的别名，但新对接统一使用 `code`。查询和撤回均不能只凭学号。

### 投递 multipart 字段

| 字段 | 类型与规则 |
|---|---|
| `name` | 必填，1–20 字。 |
| `student_id` | 必填，6–20 位字母数字。 |
| `qq` | 必填，5–12 位数字，首位不为 0。 |
| `phone` | 可选，填写时为 11 位、首位 1 的数字。 |
| `dept` | 必填；从部门接口取得稳定 `key`。当前 `game`、`ai`、`dev` 需要作品，`secretary` 不接收作品。 |
| `resume` | 必填文件；至多 25 MiB；扩展名 pdf/jpg/jpeg/png，内容魔数需匹配。 |
| `work` | 作品附件，可选；至多 1 GiB；pdf/jpg/jpeg/png/zip，内容魔数需匹配。 |
| `work_url` | 作品链接，可选，填写时以 `http://` 或 `https://` 开头。 |
| `intro` | 自荐语，可选，至多 200 字。 |

作品必填部门的 `work` **或** `work_url` 至少一项；文秘部两项均不能提供。最多 2 个文件、20 个普通字段；反向代理还可能有总请求体限制。上传失败应保留表单输入并允许重试，客户端应防重复点击；提交超时先用投递码/学号查询或联系管理员，避免盲目重复提交。投递、查询、撤回当前分别按可信客户端 IP 限流约 100/小时、30/小时、20/小时，具体保护策略可能调整。

```bash
BASE='https://<your-domain>'
curl -fsS "$BASE/api/departments"
curl -fsS "$BASE/api/campaigns/current"
curl -fsS -X POST "$BASE/api/submissions" \
  -F 'name=示例同学' -F 'student_id=20260001' -F 'qq=12345678' \
  -F 'dept=game' -F 'resume=@./resume.pdf' -F 'work_url=https://example.org/project'
curl -fsS -X POST "$BASE/api/submissions/query" \
  -H 'Content-Type: application/json' \
  -d '{"code":"JX-2026-0011","student_id":"20260001"}'
```

以上为示意值，不要提交真实个人信息到示例域名，也不要把投递码与学号组合记录在公开日志中。前端可通过 `XMLHttpRequest.upload.onprogress` 取得上传进度；进度 100% 仅代表请求体已发送，不代表服务端入库成功，仍须等待 2xx 和 `code`。

## 3. 管理端接口

登录接口：`POST /api/admin/login`，JSON `{username,password}`；成功响应 `{ok,me:{id,username,role,dept,display_name}}` 并设置 HttpOnly Cookie。`POST /api/admin/logout` 使当前账号旧会话失效；`GET /api/admin/me` 返回当前 `{ok,me}`。登录同时按 IP（当前 100/10 分钟）和账号（当前 10/10 分钟）保护。登录失败 401，未登录管理请求 401；密码修改、账号停用、角色/部门变更后旧会话失效。

| 方法与路径 | 用途/入参 | 权限与返回 |
|---|---|---|
| `GET /api/admin/submissions` | 查询参数 `status`、`search`、`page`；超级管理员可选 `dept` | `{ok,data:{total,rows,page,size},stats}`；超级管理员另有 `byDept`。部门账号始终只看本部门，不能用 `dept` 越权。 |
| `PATCH /api/admin/submissions/:id` | JSON `{status?,admin_note?}`；状态为 `pending/reviewing/accepted/rejected`，留言至多 200 字 | 仅所属部门或超级管理员；成功 `{ok:true}`。 |
| `POST /api/admin/submissions/:id/reassign` | JSON `{dept}`（兼容 `{to}`） | 仅超级管理员；`{ok,warning,from,to}`，缺作品时可能附 warning。 |
| `GET /api/admin/files/:name` | 下载已关联的附件文件名 | 需身份和归属校验；跨部门/不存在 404；非法文件名 400；流式附件响应。不可直接访问 `/uploads`。 |
| `GET /api/admin/export` | 下载 CSV | 仅导出当前有权访问部门的数据；包含个人信息，应控制保存与传播。 |
| `GET /api/admin/users` | 账号列表 | 仅超级管理员；`{ok,users}`。 |
| `POST /api/admin/users` | JSON `{username,password,display_name?,role,dept?}` | 仅超级管理员；成功 `{ok,id}`；用户名 3–20 位字母数字下划线，密码 8–128 字符。 |
| `PATCH /api/admin/users/:id` | JSON 可含 `password/is_active/role/dept` | 仅超级管理员；旧会话失效、自锁保护。 |
| `POST /api/admin/campaigns` | JSON `{year,slug,name,status?}` | 仅超级管理员；`status` 为 `active` 或 `draft`，成功 `{ok,campaign}`。 |
| `POST /api/announcement` | JSON `{announcement}`（至多 300 字） | 仅超级管理员；成功 `{ok:true}`。 |

当前角色仅 `super` 与 `dept`。敏感列表、CSV、文件必须通过 API 做服务端权限判断；客户端隐藏按钮不是权限控制。管理界面应使用同源 `fetch`、避免在第三方站点嵌入，并确保仅在 HTTPS 下登录。

```js
// 同源管理端示例：由浏览器保存 HttpOnly Cookie，不读取 Cookie 内容。
const login = await fetch('/api/admin/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify({ username: userInput, password: passwordInput })
})
if (!login.ok) throw new Error(`登录失败 ${login.status}`)
const list = await fetch('/api/admin/submissions?page=1&status=all', {
  credentials: 'same-origin'
})
if (!list.ok) throw new Error(`读取失败 ${list.status}`)
const { data } = await list.json()
```

## 4. 健康检查与错误处理

| 路径 | 成功响应 | 适用场景 |
|---|---|---|
| `GET /api/health/live` | `{ok:true,status:'live'}` | 仅验证进程存活。 |
| `GET /api/health/ready` | `{ok:true,status:'ready',schemaVersion}` | 数据库可读、迁移完成、关键目录可写；失败 503。 |
| `GET /api/health` | 同 ready | 历史兼容路径，新的监控应显式选择 live/ready。 |

常见状态：200 成功；400 字段/格式错误（含非法文件名）；401 未登录/登录失败；403 功能级权限不足；404 查无记录或资源级越权；409 重复投递/状态冲突；413 文件/总请求体超限；415 文件内容与扩展名不符；429 限流；503 当前无开放活动或未就绪。具体路由可能有更细的响应，不要把所有 5xx 解释为活动未开放。429 响应可能含 `data.retryAfterMs`，客户端应退避，不自动密集重试。

## 5. 运维与扩展对接规则

- 不直连 SQLite，不绕过 Repository 写入，不从 `data/`、`uploads/`、`runtime/` 读取私有文件；这些目录也不得由 Caddy 公开托管。
- 不用学生端 API 批量抓取个人数据；管理端导出必须服从部门权限和最小化原则。
- 发布对接客户端前，在隔离环境验证：部门策略、作品必填/隐藏、重复投递、查询与撤回双凭据、会话失效、资源越权 404、上传超限和弱网重试。
- 如需外部系统服务账号、跨源 CORS、Webhook 或批量同步，应另行设计鉴权、授权、审计、数据保存期限；当前接口未提供这些承诺。
- 架构、部署和备份细节见 [`architecture-and-operations.md`](architecture-and-operations.md)；压测容量见 [`performance-extreme-2026-09-28.md`](performance-extreme-2026-09-28.md)。
