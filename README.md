<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="Status Page Logo">
</p>

<h1 align="center">Status Page</h1>

<p align="center">
  基于 Cloudflare Workers 与 D1 的轻量级公开状态页。
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/ZTH7/Status-Page">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
</p>

Status Page 定时检查 HTTP 服务，把当前状态、每日汇总和故障区间保存到 Cloudflare D1，并通过只读网页公开展示。项目没有登录、后台管理和在线编辑功能；站点与监控配置保存在 Cloudflare 加密的构建 Secret 中，不需要提交到公开仓库。

主要功能：

- 支持每 1、5 或 10 分钟检查一次；
- 支持 `GET`、`HEAD`、期望状态码、重定向、超时和自定义 User-Agent；
- 默认连续失败 2 次变为黄色，首次失败持续 60 分钟后变为红色；
- 默认连续成功 2 次恢复绿色；
- 黄色故障和绿色恢复各通知一次，升级红色不通知；
- 使用每日聚合而不是保存每分钟的原始结果；
- 默认保留并展示最近 90 天历史，并每日清理更早的数据；
- 支持明暗模式、默认主题和星露谷风格主题；
- 可选 Telegram、Slack 和 Discord 通知。

## 纯网页部署

部署只需要 GitHub 与 Cloudflare 账户，不需要在电脑上安装 Node.js、npm 或 Wrangler，也不需要克隆仓库或执行命令。

仓库中的 `.node-version` 会让 Cloudflare Workers Builds 自动使用 Node.js 22。

### 方式一：Deploy to Cloudflare

点击上方 **Deploy to Cloudflare** 按钮，然后：

1. 登录并授权 GitHub 与 Cloudflare；
2. 选择 Cloudflare 账户；
3. 填写新仓库名称、Worker 名称和 D1 名称；
4. 接受项目自动识别的构建与部署设置；
5. 创建项目。

Cloudflare 会在你的 GitHub 账户中创建一份独立仓库副本、配置 Workers Builds、创建并绑定 D1，然后部署 Worker。这个方式不保留 GitHub 的 Fork 关系，但后续代码和部署完全属于你的账户。

首次生产部署必须提供两份私有配置。如果设置向导允许添加 **Build variables and secrets**，请直接按下一节填写。如果首次构建先开始并提示缺少 `STATUS_SITE_CONFIG_YAML` 与 `STATUS_MONITORS_CONFIG_YAML`，这是预期的安全保护：添加两个 Secret 后在 Cloudflare 的部署页面点击 **Retry deployment** 即可。

### 方式二：保留 GitHub Fork 关系

如果希望 GitHub 明确显示 Fork 关系：

1. 在 GitHub 网页打开本仓库并点击 **Fork**；
2. 登录 Cloudflare Dashboard；
3. 进入 **Workers & Pages → Create application → Import a repository**；
4. 选择刚刚 Fork 的仓库；
5. 添加下一节中的两个构建 Secret；
6. 保存并部署。

推荐设置如下：

| 设置                          | 值                             |
| ----------------------------- | ------------------------------ |
| Production branch             | `main`                         |
| Root directory                | 留空                           |
| Build command                 | `npm run build`                |
| Deploy command                | `npm run deploy`               |
| Non-production deploy command | `npx wrangler versions upload` |

仓库已经声明 D1 binding。Cloudflare 会自动创建资源并写入实际绑定，不需要复制数据库 UUID，也不需要编辑 `wrangler.jsonc` 的数据库 ID。

## 填写私有网站与监控配置

在 Cloudflare 项目的 **Settings → Builds → Build variables and secrets** 中添加两个加密的 **Secret**：

| Secret 名称                   | 内容                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `STATUS_SITE_CONFIG_YAML`     | [config/site.example.yaml](config/site.example.yaml) 的完整内容         |
| `STATUS_MONITORS_CONFIG_YAML` | [config/monitors.example.yaml](config/monitors.example.yaml) 的完整内容 |

操作方法：

1. 在 GitHub 网页打开上表中的 example 文件；
2. 复制完整内容；
3. 在 Cloudflare Secret 输入框中粘贴；
4. 直接在输入框中替换示例值；
5. 保存两个 Secret；
6. 在 **Deployments** 页面重新运行生产部署。

两个 Secret 必须同时存在。生产部署不会使用 example 配置作为后备，避免把示例网站意外部署上线。Secret 的值不会写入 GitHub 仓库，也不会在 Cloudflare 保存后再次显示；修改时需要粘贴一份新的完整 YAML。

YAML 只能使用空格缩进，不能使用 Tab。布尔值写成 `true` 或 `false`。

### 网站配置

`STATUS_SITE_CONFIG_YAML` 的主要字段：

| 字段                    | 说明                                       |
| ----------------------- | ------------------------------------------ |
| `title`                 | 网站标题                                   |
| `url`                   | 状态页最终访问地址                         |
| `logo`                  | `public/` 中的 Logo 路径，默认 `/logo.svg` |
| `theme`                 | `default` 或 `stardew-inspired`            |
| `colorMode`             | `system`、`light` 或 `dark`                |
| `historyDays`           | 历史数据保留和展示天数，范围 1–365         |
| `requestTimeoutSeconds` | 默认请求超时，必须短于检查间隔             |
| `userAgent`             | 探测请求的 User-Agent                      |
| `thresholds`            | 全局黄色、红色与恢复阈值                   |
| `labels`                | 页面文案，必须保留 example 中的全部键      |

默认阈值：

```yaml
thresholds:
  degradedAfterFailures: 2
  outageAfterMinutes: 60
  recoverAfterSuccesses: 2
```

其中 `outageAfterMinutes` 按首次失败后的实际分钟计算，与检查频率无关。

### 监控项配置

`STATUS_MONITORS_CONFIG_YAML` 示例：

```yaml
monitors:
  - id: website
    name: Website
    description: Public website
    url: https://www.example.com/
    method: GET
    expectStatus: 200
    followRedirect: false
    linkable: true
```

每个监控项支持：

| 字段               | 必填 | 说明                                    |
| ------------------ | ---- | --------------------------------------- |
| `id`               | 是   | 唯一 ID，只能使用小写字母、数字和连字符 |
| `name`             | 是   | 页面显示名称                            |
| `description`      | 否   | 简短说明                                |
| `url`              | 是   | 需要检查的 HTTP 或 HTTPS 地址           |
| `method`           | 是   | `GET` 或 `HEAD`                         |
| `expectStatus`     | 是   | 期望 HTTP 状态码                        |
| `followRedirect`   | 是   | 是否跟随重定向                          |
| `linkable`         | 是   | 是否允许公开 API 和卡片链接到目标 URL   |
| `presentationLogo` | 否   | `public/` 中的服务 Logo 路径            |
| `timeoutSeconds`   | 否   | 当前监控项的超时覆盖值                  |
| `thresholds`       | 否   | 当前监控项的阈值覆盖值                  |

`linkable: false` 时目标 URL 不会出现在公开 API 或页面链接中，但仍会被 Worker 用于检查。

## 更换主题与明暗模式

主题源码位于 `themes/`：

| `theme` 值         | 效果           |
| ------------------ | -------------- |
| `default`          | 简约卡片主题   |
| `stardew-inspired` | 星露谷风格主题 |

在 `STATUS_SITE_CONFIG_YAML` 中修改：

```yaml
theme: default
colorMode: system
```

保存 Secret 并重新部署即可。`colorMode: system` 默认跟随设备，用户仍可在页面上切换明暗模式，选择会保存在浏览器中。

主题在构建时确定，因此修改主题后需要重新部署。公开页面没有主题管理后台。

## 修改检查频率

默认每分钟检查一次。检查频率属于公开的部署设置，不包含敏感信息，可以直接通过 GitHub 网页修改 Fork 仓库中的 `wrangler.jsonc`：

```json
"triggers": { "crons": ["* * * * *"] }
```

可用值：

| 频率       | Cron           |
| ---------- | -------------- |
| 每 1 分钟  | `* * * * *`    |
| 每 5 分钟  | `*/5 * * * *`  |
| 每 10 分钟 | `*/10 * * * *` |

在 GitHub 网页保存修改后，Cloudflare Workers Builds 会自动重新部署。配置解析只接受这三个值。

## D1 自动创建与初始化

项目的 `wrangler.jsonc` 只声明名为 `DB` 的 D1 binding，不包含任何账户专属 UUID。Cloudflare 部署时会：

1. 自动创建或选择 `status-page` D1；
2. 将它绑定为 `DB`；
3. 部署 Worker；
4. 自动执行 `database/schema.sql` 创建所需表和索引。

建表语句使用 `IF NOT EXISTS`，因此每次生产部署重复执行是安全的。用户不需要进入 D1 Console，也不需要运行 Wrangler。

D1 只保存：

- 每个监控项的一行当前状态；
- 每天、每个检查位置的一行聚合数据；
- 故障开始、升级和恢复时间。

不会为每分钟检查保存一行原始结果。每天 UTC 00:00 会清理超过 `historyDays` 的历史聚合和已经恢复的旧故障，仍未恢复的故障会继续保留。

## 配置 Telegram Bot 提醒

Telegram 是可选功能，不配置时会自动跳过。

### 1. 创建 Bot

1. 在 Telegram 打开官方 [@BotFather](https://t.me/BotFather)；
2. 发送 `/newbot`；
3. 按提示设置名称与用户名；
4. 保存 BotFather 返回的 API Token。

Token 等同于机器人密码，不要提交到 GitHub、Issue 或公开截图。

### 2. 获取 Chat ID

1. 打开新建的机器人并点击 **Start**；
2. 在浏览器访问下面的地址，将 `<BOT_TOKEN>` 替换为真实 Token：

```text
https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
```

3. 在返回结果中找到 `result[].message.chat.id`。

群组需要先把机器人加入群组并发送一条机器人可见的消息。群组 ID 通常为负数，复制时保留负号。

### 3. 保存 Worker Secret

在 Cloudflare 打开已经部署的 Worker，进入 **Settings → Variables and Secrets**，添加：

| Secret 名称                 | 值                     |
| --------------------------- | ---------------------- |
| `SECRET_TELEGRAM_API_TOKEN` | BotFather 返回的 Token |
| `SECRET_TELEGRAM_CHAT_ID`   | 个人、群组或频道 ID    |

保存并按 Cloudflare 提示部署新版本。黄色故障和绿色恢复各通知一次；黄色升级红色不会发送通知。

其他可选渠道：

| Secret 名称                  | 用途                   |
| ---------------------------- | ---------------------- |
| `SECRET_SLACK_WEBHOOK_URL`   | Slack Incoming Webhook |
| `SECRET_DISCORD_WEBHOOK_URL` | Discord Webhook        |

这些是 Worker 运行时 Secret，与网站和监控 YAML 使用的 Build Secret 不同。

## 修改配置与重新部署

修改网站、监控项、阈值或主题：

1. 打开 Cloudflare Worker；
2. 进入 **Settings → Builds → Build variables and secrets**；
3. 替换对应 YAML Secret 的完整内容；
4. 打开 **Deployments**；
5. 重新运行最新生产部署。

修改检查频率或上传自定义图片时，可以直接使用 GitHub 网页编辑器提交文件；Cloudflare 会根据提交自动部署。

## GitHub Deploy Action

`.github/workflows/deploy.yml` 提供两个用途：

- 每次 push 和 pull request 自动运行完整检查；
- 在 GitHub Actions 网页手动运行备用生产部署。

只使用 Cloudflare Connect Repo 时，不需要配置 GitHub 部署凭据。若需要备用入口，在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

| GitHub Secret                 | 用途                                           |
| ----------------------------- | ---------------------------------------------- |
| `STATUS_SITE_CONFIG_YAML`     | 完整网站 YAML                                  |
| `STATUS_MONITORS_CONFIG_YAML` | 完整监控项 YAML                                |
| `CLOUDFLARE_API_TOKEN`        | Worker 部署与 Account D1 Edit 权限的限定 Token |
| `CLOUDFLARE_ACCOUNT_ID`       | Cloudflare Account ID                          |

然后进入 **Actions → Verify and deploy → Run workflow**，勾选 `deploy`。备用部署同样会创建 D1 binding 并执行表结构初始化。

## 部署后检查

等待至少两个检查周期，然后确认：

- `workers.dev` 页面可以打开；
- `/api/status` 返回 JSON；
- 新监控在首次检查前显示灰色；
- 正常服务显示绿色；
- 历史条开始产生当天数据；
- Cloudflare Worker 的 **Settings → Triggers** 中存在 Cron；
- Worker 的 **Bindings** 中存在名为 `DB` 的 D1。

Cron 配置更新最多可能需要约 15 分钟传播。刚部署时短暂显示灰色属于正常情况。

## 自定义域名

在 Cloudflare Worker 中打开 **Settings → Domains & Routes → Add → Custom Domain**，填写状态页域名。随后把 `STATUS_SITE_CONFIG_YAML` 中的 `url` 改为最终地址并重新部署。

## 可选：本地开发

只有准备修改项目代码时才需要本地环境。普通部署用户可以完全跳过本节。

```bash
npm install
cp config/site.example.yaml config/site.yaml
cp config/monitors.example.yaml config/monitors.yaml
npm run db:init:local
npm run dev
```

常用开发命令：

| 命令                    | 用途                       |
| ----------------------- | -------------------------- |
| `npm run check`         | 格式、类型、测试和生产构建 |
| `npm run dev`           | 本地开发                   |
| `npm run db:init:local` | 初始化本地 D1              |
| `npm run deploy`        | 构建、部署并初始化远程 D1  |

## 项目结构

```text
config/             公开配置模板
database/           D1 表结构
public/             Logo、图标与公开静态资源
scripts/            构建时配置生成
src/app/            React 前端
src/config/         配置校验
src/domain/         状态机与阈值逻辑
src/worker/         Worker API、检查、D1 与通知
tests/              单元、前端和 Worker/D1 测试
themes/             主题仓库
wrangler.jsonc      Worker、D1 binding 与 Cron
```

## 相关文档

- [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [D1](https://developers.cloudflare.com/d1/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Worker Variables and Secrets](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
