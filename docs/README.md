> ⚠️ GitHub `main` 是历史生产基线，当前已过期；架构、性能和对接文档以 `refactor/modular-monolith-20260927` 分支为准。

# CSPortfolio 文档索引

| 文档 | 用途 |
|---|---|
| [`../README.md`](../README.md) | 项目总览、开发、部署、配置、备份和快速验收 |
| [`integration.md`](integration.md) | 学生端、管理端 API、字段、鉴权、错误码和对接示例 |
| [`architecture-and-operations.md`](architecture-and-operations.md) | 分层架构、数据不变量、安全流程、发布、回滚和运维手册 |
| [`performance-extreme-2026-09-28.md`](performance-extreme-2026-09-28.md) | 2026-09-28 GitHub 重构版本的隔离极限压测结果与容量限制 |
| [`../deploy/Caddyfile.jxtd.example`](../deploy/Caddyfile.jxtd.example) | Caddy 反向代理、压缩、缓存、日志和安全头示例 |
| [`../.env.example`](../.env.example) | 环境变量模板；不要把真实 `.env` 提交到 Git |

## 文档维护规则

- 修改架构、部署、健康检查、备份、迁移或性能门槛时，同时更新 README 和对应专题文档。
- 性能数字必须注明日期、镜像、环境和限制；未经实测不得写成容量承诺。
- 已暴露的 secret、token、管理员密码不得写入文档、日志或 Git。
- 生产迁移、恢复和 Caddy reload 需要先在隔离环境验证。
