# CSPortfolio 模块化单体：架构与上线操作

## 架构边界

```text
server/api                 HTTP/Nitro 控制器：协议、状态码、Cookie、响应
        ↓
server/application         用例编排与权限流程
        ↓
server/domain              身份/活动/编号等纯业务规则
        ↑
server/repositories       Repository 契约与 SQLite 查询实现
        ↑
server/infrastructure     SQLite 连接/迁移、本地文件、限流、组装、日志
```

运行时依赖保持 Nuxt 3 + Nitro、SQLite WAL、本地文件、Caddy、单容器单实例。暂不加入 PostgreSQL、Redis、S3、分片上传或多实例。现有 HTTP 路径和主要响应字段保持兼容。

## 数据与编号不变量

- 历史 `submissions` 通过迁移绑定到 `campaigns`；投递码、附件路径、状态和审计行必须逐条保持一致。
- `settings.code_seq_YYYY` 是活动期间数据库内的当前权威序号；SQLite trigger 禁止该值回退或删除。分配编号使用 `BEGIN IMMEDIATE`，并与已有投递码最大值、外部高水位共同取最大值后递增。
- `CODE_SEQUENCE_FLOOR_FILE` 位于 SQLite 之外。它必须从经过核实的当前数据库/历史记录初始化，并与数据库分开备份。文件缺失或数据库序号低于已记录高水位时应用应拒绝启动，禁止通过空文件/旧备份悄悄重置。
- 每次新编号在 SQLite 提交前先原子持久化外部高水位。若进程在此间故障，可能留下序号空洞；不可为了补号而降低高水位。
- 上传保持 busboy 流式处理。超限时保留 `unpipe + end + resume`；临时文件完整写入、校验后再原子改名。任何上传路径改动必须重新运行安全测试和 T1/T2。

## 部署前操作（不得直接在生产库演练）

1. 在生产当前版本在线时用 `VACUUM INTO` 生成一致性 SQLite 副本；不要用 `cp` 复制正在写入的数据库。归档 uploads，并记录 SHA-256、数据库计数、`user_version`、各年 `code_seq`。
2. 将数据库、uploads 和已核实的编号高水位复制到独立 staging 目录；staging 不得挂载生产目录。
3. 以独立临时密钥/端口启动 staging 新镜像。检查 `/api/health/live` 和 `/api/health/ready`。ready 必须成功检查数据库迁移版本与上传目录可写。
4. 比较迁移前后投递总数、每条 code/附件路径/状态、管理员数、审计数和编号设置；确认旧记录都绑定活动。`PRAGMA quick_check` 必须返回 `ok`。
5. 在 staging 运行 `/opt/jxtd-tests/security-tests.mjs`，并补测：game 带作品成功、game 缺作品返回 400、secretary 无作品成功；再核实文件越权为 404、XFF 伪造无法绕过真实 Caddy 链路的限流。该测试脚本可能创建 `ZZTEST` 数据，必须只对 staging 运行。
6. 压测只对隔离 staging 运行，记录 p50/p95/p99、错误率、CPU/RSS、SQLite busy/lock、上传成功率。不要在生产同机上执行 20 个最大体积文件的压测；先在有资源余量的隔离环境明确最大文件策略。
7. 生产发布前确认可验证备份、高水位文件的属主/权限、secret、管理员轮换与回滚步骤。首次部署只允许镜像替换加经 staging 验证的增量迁移；不自动恢复/覆盖生产数据库。

## 外部编号高水位文件

Compose 将 `/runtime/code-sequence-high-water.json` 挂载到宿主机 `./runtime/`。启动新镜像前，运维人员必须从**当前可信数据库**及已知历史最大值核实所有活动年份，准备 JSON，例如 `{"2026":19}`（数值仅示例，发布时须重新核实，不能照抄）。宿主机目录需允许容器 UID 1000 读写；文件权限建议 `0640`、目录 `0750`。不得从旧备份覆盖该文件。

如果 staging / 启动日志提示数据库低于外部高水位：停止发布；不要删除或清空高水位文件。先确认是不是旧数据库恢复，然后把 `settings.code_seq_YYYY` 在已验证备份/当前数据上向前修复，或重新执行正确迁移。

## Caddy 变更

`deploy/Caddyfile.jxtd.example` 是待审的站点配置片段，不会自动修改或 reload 生产 Caddy。它保留显式 XFF 覆写，开启 zstd/gzip、哈希静态资源长缓存及滚动 access log；日志过滤整个 query string 并删除 Cookie、Authorization、来路 XFF。合并前运行当前部署版本的 `caddy fmt`/`caddy validate`，并确认 `/data/logs` 在 Caddy 数据卷中可写。

核查到当前生产 Caddy 总请求体上限为 1.2 GB，应用侧简历上限 25 MiB、作品上限 1 GiB，配置相容。大文件并发会消耗大量磁盘和 I/O；不得在生产同机压测最大文件并发。若要调整任何上限，需同步更新 Caddy 与应用校验、前端提示，并先在隔离 staging 确定磁盘预算和并发策略。

## 密钥与账号

已出现在聊天记录中的 GitHub token 视为泄露：必须在 GitHub 撤销并重新生成，后续不得复用。管理员账号密码轮换为每个账号独立强密码；在确认找回/应急账号后执行，避免锁死管理员。两项均为生产运维动作，不由 staging 自动更改。`SESSION_SECRET` 必须配置且至少 16 字符；禁止回退到默认值。

## 发布与回滚

- 各阶段分别提交；生产部署前先通过 staging 的迁移、功能、安全和性能验收。
- 代码回滚只回滚镜像，不覆盖数据库；兼容的增量迁移通常不回滚。
- 恢复备份前必须比较备份中的序号与外部高水位；若低于高水位，禁止直接启服务。
- 上线后检查 ready、Caddy access log、应用 `request_id` JSON 日志、错误率、响应耗时、RSS 和磁盘空间。日志不应包含 query、密码、Cookie、手机号、QQ、简历地址或上传内容。

## 验收性能目标

先取得 staging 基线，再验证首页 50 VU p95 ≤ 1.5 秒、查询 50 VU p95 ≤ 800 ms、错误率 < 1%；100 VU 只作容量摸底。上传应无死锁、无半文件、无 OOM。最大文件和 20 并发的组合测试仅在隔离且有足够磁盘/内存的 staging 环境执行。首页 gzip JavaScript 以当前实测基线为准，目标不增长并逐步降低 20%；250 KB gzip 仅作优化目标，不作为未经测量的硬承诺。
