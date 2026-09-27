# 无锡学院计算机协会 · 简历作品投递系统

招新用：同学在线投递简历和作品 → 管理员审核 → 通过可免试入会。

**技术栈**：Nuxt 3（Vue 3 全栈，前端 + API 一个项目）+ SQLite（Node 22 内置 `node:sqlite`，零原生依赖）。

## 功能

- **投递页 `/`**：个人信息 + 简历上传（PDF/JPG/PNG ≤25MB）+ 作品附件（PDF/JPG/PNG/ZIP ≤1GB）+ 作品链接/附件 + 一句话自荐；提交后生成投递码（如 `JX-2026-0001`）
- **查询页 `/status`**：凭投递码 + 学号查审核状态（待审核/审核中/免试通过/未通过）+ 管理员留言
- **管理后台 `/admin`**：密码登录；统计、筛选搜索、在线查看简历/作品、改状态、留言、导出 CSV、编辑公告
- **安全**：学号唯一防重复投递、同 IP 限流、上传类型白名单 + UUID 重命名、简历文件仅管理员可下载、管理员密码走环境变量

## 环境要求

- **Node.js ≥ 22.13**（必须，内置 `node:sqlite` 数据库，无需装任何数据库软件）
- 无其他外部依赖

## 本地开发

```bash
npm install
# 设置管理员密码后启动
npm run dev
```

## 生产部署

### 1. 构建

```bash
npm install
npm run build
```

产物在 `.output/`，运行只需要这一个目录 + Node ≥ 22.13：

```bash
ADMIN_PASSWORD=你的管理密码 SESSION_SECRET=随便一串乱码 PORT=3000 node .output/server/index.mjs
```

> 也可以直接本地构建好，把 `.output/` 打包上传到服务器，服务器只装 Node 就能跑。

### 2. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | ✅ | 管理后台登录密码 |
| `SESSION_SECRET` | ✅ | 会话签名密钥，随机长字符串 |
| `PORT` / `HOST` | 可选 | 默认 3000 / 0.0.0.0 |
| `DATA_DIR` | 可选 | SQLite 数据文件目录（默认项目内 `data/`） |
| `UPLOAD_DIR` | 可选 | 简历/作品上传目录（默认项目内 `uploads/`） |

参考 `.env.example`。**`.env` 不要提交到 git。**

### 3. 常驻运行（systemd 示例）

```ini
[Unit]
Description=JX Resume Portal
After=network.target

[Service]
User=www
WorkingDirectory=/opt/jxtd
ExecStart=/usr/bin/node /opt/jxtd/.output/server/index.mjs
Environment=PORT=8100
Environment=HOST=127.0.0.1
EnvironmentFile=/opt/jxtd/.env
Restart=always

[Install]
WantedBy=multi-user.target
```

### 4. Nginx 反代（可选，配域名 + HTTPS）

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;
    client_max_body_size 1.2g;   # 简历 25MB，作品附件 1GB，另留 multipart 开销
    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 数据备份

全部数据只有两处：`data/`（数据库，就一个 .db 文件）和 `uploads/`（上传的文件）。定期打包这两个目录即可。

## 项目结构

```
├─ app.vue                 # 根组件（全局样式在这里 import）
├─ assets/css/main.css     # 全局样式（配色体系：主色 #1F2937）
├─ pages/index.vue         # 投递页
├─ pages/status.vue        # 查询页
├─ pages/admin.vue         # 管理后台
├─ server/api/             # 后端接口
├─ server/utils/db.ts      # 数据库层（node:sqlite，两张表）
└─ server/utils/auth.ts    # 管理员鉴权 / 限流 / 校验
```
