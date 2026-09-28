# CSPortfolio 架构与运维手册

> 文档基线：2026-09-28。本文描述当前模块化重构后的代码和单机 Docker 部署，不代表未来 PostgreSQL、Redis、对象存储或多实例方案已经实施。

## 1. 架构决策

系统采用**高性能模块化单体**，目标是服务同年一次招新，在学生端体验、代码边界和可回滚性之间取得平衡。

```text
浏览器
  │ HTTPS
  ▼
Caddy
  ├─ TLS / 压缩 / 静态资源缓存
  ├─ 真实客户端 IP 覆写
  ├─ access log 脱敏与滚动
  └─ 1.2 GB 总请求体上限
  │ reverse_proxy
  ▼
Nuxt 3 + Nitro（Docker，单实例）
  ├─ API 控制器
  ├─ Application 用例层
  ├─ Domain 领域规则
  ├─ Repository 数据访问
  ├─ LocalFileStorage 本地文件
  └─ MemoryRateLimiter 内存限流
  │
  ├─ SQLite WAL：data/portal.db
  ├─ 上传文件：uploads/
  └─ 编号高水位：runtime/code-sequence-high-water.json
```

当前不引入：

```text
PostgreSQL / Redis / S3 / 分片上传 / 多实例 / Kubernetes / API v2
```

原因不是这些技术不可用，而是当前负载和机器规模不足以证明它们值得承担额外的故障面、迁移风险和运维成本。

## 2. 分层和依赖方向

```text
server/
├── api/                         # HTTP/Nitro 控制器
├── application/                 # 用例编排与权限流程
├── domain/                      # 纯业务规则
├── repositories/
│   ├── contracts/               # Repository 接口
│   └── sqlite/                  # SQLite 实现
├── infrastructure/
│   ├── database/                # 连接、迁移、WAL、编号高水位
│   ├── storage/                 # 本地文件存储
│   ├── rate-limit/              # 内存限流
│   └── bootstrap.ts             # Composition Root
├── middleware/                  # request context、request_id
└── utils/                       # 密码哈希、鉴权等基础能力
```

依赖方向固定为：

```text
API → Application → Domain + Repository Interfaces
Infrastructure → Repository Interfaces
```

硬约束：

1. `server/api/` 不直接写 SQL、不直接访问文件系统。
2. `server/domain/` 不导入 Nuxt、Nitro、SQLite 或 Node HTTP 对象。
3. 数据库访问集中在 `server/repositories/`。
4. 文件读写集中在 `FileStorage` 实现。
5. 具体实现只在 `server/infrastructure/bootstrap.ts` 组装。
6. 现有 HTTP 路径和主要响应字段保持兼容，不通过 API v2 逃避迁移兼容问题。

## 3. 模块职责

### API 层

负责解析请求、校验协议输入、读取 Cookie、调用 Application、映射状态码和返回兼容响应。它不决定业务规则，也不拼接 SQL。

### Application 层

负责完整用例，例如登录、投递、审核、重新分配部门、创建活动、健康检查。这里定义事务边界、调用权限校验和协调多个 Repository/Storage。

### Domain 层

只保存不依赖基础设施的规则：部门/角色语义、活动状态、投递编号格式、错误类型和输入约束。Domain 可以被单元测试直接调用。

### Repository 层

Repository 契约描述业务需要的数据操作；SQLite 实现负责 SQL、索引、事务和结果映射。未来替换 PostgreSQL 时，Application 和 Domain 不应被迫改写。

### Infrastructure 层

提供 SQLite 初始化、迁移、WAL 配置、本地文件写入、内存限流和组合根。它可以依赖 Node 和第三方库，但不把这些依赖泄漏给 Domain。

## 4. 数据模型和不变量

主要数据：

- `admins`：管理员账号、角色、部门、启用状态、`session_version`。
- `campaigns`：招新活动（年份、slug、名称、状态、时间范围）。
- `submissions`：学生投递、当前活动、投递码、状态、附件路径、审核信息。
- `audit_log`：管理员动作审计；不记录手机号、QQ、密码、Cookie 或完整简历地址。
- `settings`：活动编号序号等运行时设置。

### 活动隔离

每条投递都有 `campaign_id`。迁移旧数据时：

1. 先用 `VACUUM INTO` 生成一致性备份；
2. 幂等创建当前年份活动；
3. 将历史投递绑定到该活动；
4. 比较迁移前后总数、每条 `id/code/附件路径/状态` 和审计行数；
5. `PRAGMA quick_check` 必须返回 `ok`。

迁移失败必须使进程拒绝启动，不能带着半迁移数据继续服务。

### 编号高水位

- `settings.code_seq_YYYY` 是数据库内当前运行时权威值。
- 更新序号只允许递增；SQLite trigger 禁止回退和删除。
- 分配新编号在短事务中进行，并同时考虑已有投递码最大值。
- `/runtime/code-sequence-high-water.json` 是数据库之外的防回退护栏，必须与数据库分开备份。
- 新编号可能出现空洞，但不能为了补号降低高水位。
- 恢复旧备份前，必须比较备份序号、已知历史序号和外部高水位；低于历史值时禁止直接启动。

## 5. 请求与安全流程

### 管理员登录

```text
请求 → Caddy 覆写真实 IP → 登录按 IP + 账号限流
     → 查 admins → 验证密码 → 签发 session cookie
     → 每次管理请求回查管理员和 session_version
```

密码修改、停用、角色/部门修改会递增 `session_version`，使旧会话立即失效。空 `admins` 表首次启动时才读取 `ADMIN_PASSWORD` 创建 `admin` 超级管理员；已有账号不会被环境变量覆盖。

### 学生投递

```text
请求 → 当前活动检查 → IP 限流 → busboy 流式解析
     → 字段/文件类型/大小校验 → 临时文件写入
     → 原子重命名 → SQLite 短事务写入投递
     → 返回投递码
```

上传超限时必须保留 `unpipe + end + resume`，否则解析器可能死锁。临时文件成功完成前不得出现在正式路径，失败时必须清理。

### 文件下载

管理员下载文件时必须同时满足：管理员身份有效、目标投递存在、路径属于允许的上传目录。越权和路径穿越统一返回 404，避免泄露资源存在性。

## 6. SQLite 运行参数

启动时统一执行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

规则：

- 写事务尽量短，不在事务中执行网络请求或长时间文件复制。
- 不直接复制处于 WAL 写入状态的 `portal.db`。
- 备份使用 `VACUUM INTO` 或等价在线备份，并单独保存 WAL 相关状态。
- 只根据真实查询计划增加索引；主要列表查询使用活动、部门、状态和 id 的组合索引。
- `quick_check`、行数、序号和附件路径是发布前后的固定校验项。

## 7. 反向代理和缓存

`deploy/Caddyfile.jxtd.example` 是待审配置片段，不会自动修改生产 Caddy。合并前执行：

```bash
caddy fmt --overwrite /path/to/Caddyfile
caddy validate --config /path/to/Caddyfile
```

配置要点：

- `header_up X-Forwarded-For {http.request.remote.host}`：不信任客户端自带 XFF。
- `encode zstd gzip`：对 HTML、JSON 和文本响应压缩。
- `/_nuxt/*` 内容哈希资源使用长期 immutable 缓存。
- access log 删除 Cookie、Authorization、XFF，并过滤 query string。
- 保留安全响应头和 1.2 GB 总请求体上限。

首页性能优化必须先取得当前 bundle/SSR 基线，再以首页 JavaScript 不增长、逐步下降约 20% 为目标；250 KB gzip 只能作为优化方向，不能未经测量直接当硬承诺。

## 8. 健康检查

- `/api/health/live`：只回答进程是否存活，适合 liveness。
- `/api/health/ready`：检查数据库可读、迁移已经完成、关键目录可写，适合 Docker/Caddy readiness。

Docker `HEALTHCHECK` 使用 ready，而不是仅检查端口是否打开。

## 9. 备份、发布与回滚

### 备份

最小集合：

```text
data/portal.db（VACUUM INTO 产物）
uploads/（上传文件归档）
runtime/code-sequence-high-water.json
```

每次备份记录 SHA-256、`quick_check`、`user_version`、投递/管理员/审计/活动行数、各年序号和高水位内容，并通过 `rclone` 或等价方式异地同步。没有做过恢复演练的备份不算可用备份。

### 发布

1. 在隔离目录或临时环境构建新镜像。
2. 先运行 ready、API 回归、安全测试和性能测试。
3. 生产执行一次可验证备份，确认高水位文件、secret、目录权限。
4. 优先只替换镜像；增量迁移必须幂等且已在 staging 验证。
5. 发布后观察 ready、Caddy access log、request_id 日志、错误率、p95、RSS 和磁盘空间。

### 回滚

- 代码问题：只回滚镜像，不直接覆盖数据库。
- 数据库恢复：先停止写入，校验计数、投递码、附件路径、审计行和高水位，再启动。
- 如果备份中的编号低于已知历史高水位，禁止静默恢复。

## 10. 测试门槛

安全回归：

```bash
node /opt/jxtd-tests/security-tests.mjs
```

必须通过：

- 26 项越权测试；
- game 带作品：200；
- game 不带作品：400；
- secretary 不带作品：200；
- XFF 伪造不能绕过限流；
- 文件越权为 404、路径穿越拦截；
- 改密码/停用/改角色后旧会话失效；
- 缺少 `SESSION_SECRET` 拒绝启动。

上传路径任何改动后，必须重新运行上述安全脚本和 T1/T2 端到端测试。

## 11. 2026-09-28 极限压测结果

详细记录见 [`performance-extreme-2026-09-28.md`](performance-extreme-2026-09-28.md)。测试镜像为 `jxtd-refactor:github-c848948`，在隔离实例执行，生产容器未重启。

| 场景 | 结果 |
|---|---|
| health 100/200/400 VU | 0% 错误；p95 211/279/475 ms |
| ready 100/200/400 VU | 0% 错误；p95 143/263/480 ms |
| 首页 50 VU | 0% 错误；p95 783 ms |
| 首页 100 VU | 0.61% 网络超时 |
| 首页 200 VU | 6.3% 网络超时；p95 10 s |
| 查询 50/100/200 VU | 0% 错误；p95 111/188/385 ms |
| 25 MiB 上传 1/3/5/10/20 并发 | 39 次全部 HTTP 200；无 OOM、死锁、半文件 |
| 最大容器 RSS | 236.3 MiB / 512 MiB |

结论：健康检查和查询接口表现稳定；首页在 100 VU 开始出现网络超时，200 VU 明显退化。因此当前 VPS 只适合承诺招新窗口的几十级并发；100 VU 以上只作为容量摸底，不应包装成容量保证。需要更高容量时，先做首页 SSR/缓存优化或升级机器，再重新建立基线。

## 12. 升级触发条件

出现以下情况之一再评估 PostgreSQL、Redis、对象存储或多实例：

- 同年第二次招新；
- 多组织共用；
- SQLite 写锁成为实测瓶颈；
- 单机 CPU、内存、磁盘或备份窗口不足；
- 发生单容器宕机导致业务不可用；
- 学校提出正式高可用、灾备或审计要求。
