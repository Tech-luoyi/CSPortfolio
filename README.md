# CSPortfolio / 无锡学院计算机协会招新投递系统

面向一年一次招新的轻量级、模块化单体应用：学生在线投递简历与作品，管理员按部门审核、留言、导出和管理招新活动。

> ⚠️ **分支提示（2026-09-28）**：GitHub 的 `main` 分支是历史生产基线（当前为 `2a07087`），已经过期，不应继续用于部署或压测。当前重构代码位于 `refactor/modular-monolith-20260927` 分支；部署前请确认使用该分支的最新提交，并核对构建镜像与压测记录。

> 当前定位：**学生端体验优先的高性能模块化单体**。在同年一次招新、单机单实例的约束下，优先把代码边界、可靠性、移动端体验和可观测性做好；暂不为尚未发生的规模引入 PostgreSQL、Redis、对象存储或多实例。

## 目录

- [功能与路由](#功能与路由)
- [运行架构](#运行架构)
- [代码分层](#代码分层)
- [数据与安全边界](#数据与安全边界)
- [开发与构建](#开发与构建)
- [配置项](#配置项)
- [Docker + Caddy 部署](#docker--caddy-部署)
- [备份与恢复](#备份与恢复)
- [测试与性能基线](#测试与性能基线)
- [升级边界](#升级边界)
- [对接文档](#对接文档)

## 功能与路由

### 学生端

- `/`：填写个人信息、选择意向部门、上传简历和作品、填写作品链接与自荐语。
- `/status`：凭投递码和学号查询审核状态及管理员留言。
- 学生首页只加载学生端组件；管理后台依赖按路由加载。
- 上传采用流式处理，文件先写入临时文件，校验完成后再原子改名，避免产生半文件。

### 管理端

- `/admin`：管理员登录、投递列表筛选、查看文件、审核状态、留言、部门调整、导出 CSV、公告和管理员管理。
- 管理员按 `super` / 部门角色限制可见范围。
- `/api/health/live`：进程存活检查，不依赖完整业务就绪。
- `/api/health/ready`：数据库可读、迁移完成、关键目录可写后才返回成功。

### API 兼容性

现有 API 路径和主要响应字段保持兼容，不创建 API v2。HTTP 控制器只负责协议适配，业务流程由 `server/application/` 处理。

## 运行架构

```text
浏览器（学生 / 管理员）
          │ HTTPS
          ▼
Caddy（TLS、真实客户端 IP、压缩、静态缓存、access log）
          │ reverse_proxy
          ▼
Nuxt 3 + Nitro（单容器、单实例）
          │
          ├── Application：用例编排、权限流程、事务边界
          ├── Domain：编号、活动、权限等纯业务规则
          ├── Repository：SQLite 数据访问
          ├── LocalFileStorage：本地上传文件
          └── MemoryRateLimiter：当前实例内限流
                    │
                    ├── SQLite WAL 数据库：data/portal.db
                    ├── 上传目录：uploads/
                    └── 运行时高水位：runtime/code-sequence-high-water.json
```

当前生产部署保留以下组件：

```text
Nuxt 3 + Nitro + SQLite WAL + 本地文件存储 + Caddy + Docker 单实例
```

当前不引入：

```text
PostgreSQL / Redis / S3 / 分片上传 / 多实例 / Kubernetes / API v2
```

只有在出现第二次招新、多组织共用、SQLite 写锁瓶颈、单机资源不足或正式高可用要求时，才评估替换基础设施。

## 代码分层

```text
server/
├── api/                         # Nitro HTTP 控制器：参数、Cookie、状态码、响应
│   ├── admin/                   # 登录、审核、文件、导出、管理员
│   ├── campaigns/               # 当前活动查询
│   ├── health/                  # live / ready
│   ├── submissions/             # 查询、撤回
│   ├── announcement.ts
│   ├── departments.get.ts
│   └── submissions.post.ts
├── application/                 # 用例编排、事务、权限流程
│   ├── auth.ts
│   ├── submissions.ts
│   ├── campaigns.ts
│   ├── admin.ts
│   ├── settings.ts
│   ├── storage.ts
│   └── health.ts
├── domain/                      # 纯业务规则和领域类型
├── repositories/                # 数据访问契约与 SQLite 适配器
│   ├── contracts/
│   └── sqlite/
├── infrastructure/              # 技术实现与组合根
│   ├── database/                # SQLite 初始化、WAL、迁移、编号高水位
│   ├── storage/                 # 当前为本地文件存储
│   ├── rate-limit/              # 当前为内存限流
│   └── bootstrap.ts             # 统一组装依赖
├── middleware/                  # request_id、结构化请求上下文
└── utils/                       # 密码哈希、鉴权等基础能力

pages/
├── index.vue                    # 学生投递页
├── status.vue                   # 学生查询页
└── admin.vue                    # 管理后台（路由级懒加载）

deploy/
└── Caddyfile.jxtd.example      # 待审 Caddy 站点片段

docs/
├── integration.md              # API 对接文档
├── architecture-and-operations.md
└── performance-extreme-2026-09-28.md
```

依赖方向固定为：

```text
API → Application → Domain + Repository Interfaces
Infrastructure → Repository Interfaces
```

API 禁止直接写 SQL 或操作文件系统；Domain 不依赖 Nuxt、SQLite 或 Node HTTP 对象；SQLite、本地存储和内存限流均在 `bootstrap.ts` 组装。

## 数据与安全边界

### 数据

- SQLite 使用 WAL、`busy_timeout`、`foreign_keys=ON` 和短事务。
- `campaigns` 保存招新活动；`submissions.campaign_id` 隔离不同活动。
- `settings.code_seq_YYYY` 是运行时编号序号；编号在事务中分配，只允许递增。
- `runtime/code-sequence-high-water.json` 位于 SQLite 之外，防止恢复旧数据库后编号回退重号。
- 已有投递迁移到活动时必须保持 code、状态、附件路径、审计记录逐条一致。

### 认证与权限

- `SESSION_SECRET` 缺失或使用默认值时拒绝启动。
- `ADMIN_PASSWORD` 只用于空 `admins` 表的首次引导；首次登录后应立即在后台为每个管理员设置互不相同的强密码。已有管理员不会因重启被覆盖。
- `session_version` 在改密码、停用、改角色/部门等操作后递增，每次请求回查，旧会话立即失效。
- 文件下载必须通过管理员身份和投递归属校验；越权、路径穿越统一返回 404。
- 学生投递按真实客户端 IP 保持现有限流语义；登录同时按 IP 和账号维度保护，避免同一出口下管理员互相影响。
- 日志只保留 `request_id`、路由、状态码、耗时和 actor/admin ID；不得记录手机号、QQ、简历地址、密码、Cookie 或完整上传内容。

### 上传

- 简历上限 25 MiB；作品上限 1 GiB，最终上限还受 Caddy 总请求体限制约束。
- 使用 busboy 流式解析；超限处理必须保留 `unpipe + end + resume`，避免解析器死锁。
- 临时文件完整写入并校验后原子重命名；失败时清理临时文件。
- 当前不做分片上传。对现有招新规模，单次流式上传更简单且更容易回滚。

## 开发与构建

### 环境要求

- Node.js `>= 22.13`（使用内置 `node:sqlite`）。
- npm。
- 生产推荐使用 Docker，不要求宿主机安装 Node。

### 本地开发

```bash
npm ci
cp .env.example .env
# 编辑 .env：至少设置 SESSION_SECRET；空库首次引导还需要 ADMIN_PASSWORD
npm run dev
```

### 构建与启动

```bash
npm ci
npm run build
NODE_ENV=production \
SESSION_SECRET='生成一段随机长字符串' \
ADMIN_PASSWORD='仅首次引导使用的强密码' \
node .output/server/index.mjs
```

生产环境不应在命令行历史中直接写密码，使用受保护的 `.env` 或 secret 管理方式。

## 配置项

完整示例见 [`.env.example`](.env.example)。

| 变量 | 必填 | 说明 |
|---|---:|---|
| `SESSION_SECRET` | 是 | Cookie/session 签名密钥；必须是随机长字符串，禁止默认值 |
| `ADMIN_PASSWORD` | 空库首次启动时是 | 仅当 `admins` 表为空时创建 `admin` 超级管理员；已有账号不会覆盖 |
| `DATA_DIR` | 否 | SQLite 数据目录，Docker 默认 `/data` |
| `UPLOAD_DIR` | 否 | 上传文件目录，Docker 默认 `/uploads` |
| `CODE_SEQUENCE_FLOOR_FILE` | 否 | 编号外部高水位，Docker 默认 `/runtime/code-sequence-high-water.json` |
| `HOST` | 否 | 默认 `0.0.0.0` |
| `PORT` | 否 | 默认 `3000` |
| `TZ` | 否 | 建议生产设置为 `Asia/Shanghai` |

## Docker + Caddy 部署

推荐的生产方式是 Docker Compose 运行单个 `jxtd` 容器，由 Caddy 在外层负责 HTTPS 和反向代理。

```bash
git checkout <经过审核的版本>
cp .env.example .env
chmod 600 .env
# 编辑 .env，设置 SESSION_SECRET；首次空库再设置 ADMIN_PASSWORD
mkdir -p data uploads runtime
# 让挂载目录可被容器运行用户读写；实际 UID 以镜像检查结果为准
chown -R 1000:1000 data uploads runtime

docker compose build --pull
docker compose up -d

docker compose ps
docker compose logs --tail=200 jxtd
curl -fsS http://127.0.0.1:3000/api/health/ready
```

`docker-compose.yml` 使用三个持久化目录：

- `data/`：SQLite 数据库及 WAL/SHM 文件；
- `uploads/`：简历和作品；
- `runtime/`：编号高水位等运行时状态。

`deploy/Caddyfile.jxtd.example` 需要人工合并并在当前 Caddy 环境执行 `caddy fmt`、`caddy validate` 后再 reload。它包含：

- 显式覆盖 `X-Forwarded-For`，不信任客户端伪造值；
- zstd/gzip 压缩；
- `/_nuxt/*` 内容哈希资源一年缓存；
- access log 脱敏、滚动和基本安全响应头；
- 1.2 GB 总请求体上限，与应用侧作品/简历限制相容。

部署时只替换镜像，不用旧数据库覆盖新数据库；数据库迁移必须先在隔离环境验证。

## 备份与恢复

SQLite WAL 数据库禁止在写入过程中直接 `cp portal.db`。一致性备份必须使用 SQLite 的 `VACUUM INTO` 或等价的在线备份 API，并同时归档上传文件和编号高水位文件。

建议最小备份集合：

```text
data/portal.db（通过 VACUUM INTO 生成）
uploads/（文件归档）
runtime/code-sequence-high-water.json
```

每次备份记录：

- 数据库和归档的 SHA-256；
- `PRAGMA quick_check`；
- `PRAGMA user_version`；
- `submissions`、`admins`、`audit_log`、`campaigns` 行数；
- 每个活动的 `settings.code_seq_YYYY`；
- 高水位文件内容和文件权限。

备份必须异地同步，并定期在独立目录做恢复演练。恢复旧备份前，先比较其中的序号与已知历史高水位；如果恢复版本更低，必须停止启动并人工确认，不能静默回退。

## 测试与性能基线

### 必过回归

```bash
# 在隔离 staging 环境运行，不要直接对生产库执行
node /opt/jxtd-tests/security-tests.mjs
```

发布前还要重跑：

- 已通过的 26 项越权测试；
- game 带作品：HTTP 200；
- game 不带作品：HTTP 400；
- secretary 不带作品：HTTP 200；
- XFF 伪造不能绕过限流；
- 文件越权返回 404，路径穿越被拦截；
- 改密码、停用、改角色后旧会话失效；
- 缺少 `SESSION_SECRET` 时拒绝启动。

### 2026-09-28 极限压测摘要

测试对象为 GitHub 最新重构镜像 `jxtd-refactor:github-c848948` 的隔离实例，详细数据见 [`docs/performance-extreme-2026-09-28.md`](docs/performance-extreme-2026-09-28.md)。

| 场景 | 结果 |
|---|---|
| health 100/200/400 VU | 0% 错误；p95 211/279/475 ms |
| ready 100/200/400 VU | 0% 错误；p95 143/263/480 ms |
| 首页 50 VU | 0% 错误；p95 783 ms |
| 首页 100 VU | 0.61% 网络超时 |
| 首页 200 VU | 6.3% 网络超时；p95 10 s，出现明显退化 |
| 查询 50/100/200 VU | 0% 错误；p95 111/188/385 ms |
| 25 MiB 上传，1/3/5/10/20 并发 | 39 次全部 HTTP 200；无 OOM、死锁或半文件 |
| 最大 RSS | 236.3 MiB / 512 MiB |

结论：健康检查和查询接口余量较好，首页在 100 VU 开始出现网络超时，200 VU 不适合作为当前单机承诺容量。当前只建议对外承诺招新窗口的几十级并发；如需更高并发，应先改善首页 SSR/静态缓存或升级机器，并重新压测。

## 升级边界

只有出现以下任一条件，才评估 PostgreSQL、Redis、对象存储或多实例：

- 同年出现第二次招新；
- 多个组织共用系统；
- SQLite 写锁成为真实瓶颈；
- 单机 CPU、内存、磁盘或备份窗口不足；
- 发生单容器宕机导致业务不可用；
- 学校提出正式高可用、灾备或审计要求。

在此之前，保持模块化单体能以最低运维成本交付清晰、可靠、可回滚的系统。

## 对接文档

学生端、管理端接口字段、认证、限流和调用示例请见 [`docs/integration.md`](docs/integration.md)；其余专题见 [`docs/README.md`](docs/README.md)。
