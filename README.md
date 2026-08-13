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

Status Page 定时检查 HTTP 服务，把当前状态、每日汇总和故障区间保存到 Cloudflare D1，并通过只读网页公开展示。站点与监控配置保存在 Cloudflare 加密的构建 Secret 中，公开仓库只包含配置模板。

主要功能：

- 支持每 1、5 或 10 分钟检查一次；
- 支持 `GET`、`HEAD`、期望状态码、重定向、超时和自定义 User-Agent；
- 默认连续失败 2 次变为黄色，首次失败持续 60 分钟后变为红色；
- 默认连续成功 2 次恢复绿色；
- 黄色故障和绿色恢复各通知一次，升级红色不通知；
- 使用紧凑的每日聚合记录检查历史；
- 默认保留并展示最近 90 天历史，并每日清理更早的数据；
- 支持明暗模式、默认主题和星露谷风格主题；
- 可选 Telegram、Slack 和 Discord 通知。

## 纯网页部署

部署流程在 GitHub 与 Cloudflare 网页中完成。

仓库中的 `.node-version` 会让 Cloudflare Workers Builds 自动使用 Node.js 22。

### 方式一：Deploy to Cloudflare

点击上方 **Deploy to Cloudflare** 按钮，然后：

1. 登录并授权 GitHub 与 Cloudflare；
2. 选择 Cloudflare 账户；
3. 填写新仓库名称、Worker 名称和 D1 名称；
4. 接受项目自动识别的构建与部署设置；
5. 创建项目。

Cloudflare 会在你的 GitHub 账户中创建一份独立仓库副本、配置 Workers Builds、创建并绑定 D1，然后部署 Worker。仓库和部署资源都属于你的账户。

首次生产部署必须提供两份私有配置。如果设置向导允许添加 **Build variables and secrets**，请直接按下一节填写。如果首次构建先开始并提示缺少 `STATUS_SITE_CONFIG_JSON` 与 `STATUS_MONITORS_CONFIG_JSON`，这是预期的安全保护：添加两个 Secret 后在 Cloudflare 的部署页面点击 **Retry deployment** 即可。

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

仓库已经声明 D1 binding，Cloudflare 会自动创建资源并写入实际绑定。

## 填写私有网站与监控配置

在 Cloudflare 项目的 **Settings → Builds → Build variables and secrets** 中添加两个加密的 **Secret**：

| Secret 名称                   | 内容                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `STATUS_SITE_CONFIG_JSON`     | [config/site.example.json](config/site.example.json) 的完整内容         |
| `STATUS_MONITORS_CONFIG_JSON` | [config/monitors.example.json](config/monitors.example.json) 的完整内容 |

操作方法：

1. 在 GitHub 网页打开上表中的 example 文件；
2. 复制完整内容；
3. 在 Cloudflare Secret 输入框中粘贴；
4. 直接在输入框中替换示例值；
5. 保存两个 Secret；
6. 在 **Deployments** 页面重新运行生产部署。

两个 Secret 必须同时存在，生产部署只接受这两份私有配置。Secret 的值保存在 Cloudflare 中并以加密方式处理；修改时需要粘贴一份新的完整 JSON。

JSON 不依赖换行或缩进。Cloudflare 输入框若只接受单行，可直接删除 example 文件中的换行和缩进后粘贴；不要删除引号、逗号、冒号或括号。布尔值写成不带引号的 `true` 或 `false`，键名和字符串必须使用双引号。

### 网站配置

`STATUS_SITE_CONFIG_JSON` 的主要字段：

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

```json
{
  "thresholds": {
    "degradedAfterFailures": 2,
    "outageAfterMinutes": 60,
    "recoverAfterSuccesses": 2
  }
}
```

其中 `outageAfterMinutes` 按首次失败后的实际分钟计算，与检查频率无关。

### 监控项配置

`STATUS_MONITORS_CONFIG_JSON` 示例：

```json
{
  "monitors": [
    {
      "id": "website",
      "name": "Website",
      "description": "Public website",
      "url": "https://www.example.com/",
      "method": "GET",
      "expectStatus": 200,
      "followRedirect": false,
      "linkable": true
    }
  ]
}
```

每个监控项支持：

| 字段               | 必填 | 说明                                           |
| ------------------ | ---- | ---------------------------------------------- |
| `id`               | 是   | 唯一 ID，只能使用小写字母、数字和连字符        |
| `name`             | 是   | 页面显示名称                                   |
| `description`      | 否   | 简短说明                                       |
| `url`              | 是   | 需要检查的 HTTP 或 HTTPS 地址                  |
| `method`           | 是   | `GET` 或 `HEAD`                                |
| `expectStatus`     | 是   | 期望 HTTP 状态码                               |
| `followRedirect`   | 是   | 是否跟随重定向                                 |
| `linkable`         | 是   | 是否允许公开 API 和卡片链接到目标 URL          |
| `presentationLogo` | 否   | `public/` 中的服务图标路径，可覆盖网站 favicon |
| `timeoutSeconds`   | 否   | 当前监控项的超时覆盖值                         |
| `thresholds`       | 否   | 当前监控项的阈值覆盖值                         |

`linkable: false` 时目标 URL 不会出现在公开 API 或页面链接中，但仍会被 Worker 用于检查。
未设置 `presentationLogo` 时，公开可链接的监控会尝试加载目标根域名的 `/favicon.ico`；加载失败或目标不公开时，卡片会显示服务名称的首字符标记。

## 更换主题与明暗模式

主题源码位于 `themes/`：

| `theme` 值         | 效果           |
| ------------------ | -------------- |
| `default`          | 简约卡片主题   |
| `stardew-inspired` | 星露谷风格主题 |

在 `STATUS_SITE_CONFIG_JSON` 中修改：

```json
{
  "theme": "stardew-inspired",
  "colorMode": "system"
}
```

保存 Secret 并重新部署即可。`colorMode: system` 默认跟随设备，用户仍可在页面上切换明暗模式，选择会保存在浏览器中。

主题在构建时确定，因此修改主题后需要重新部署。公开页面没有主题管理后台。
Cloudflare 网页部署读取的是 `STATUS_SITE_CONFIG_JSON` Build Secret；修改本地
`config/site.json` 或仓库中的 example 文件不会替换已经保存的 Build Secret。构建日志会输出实际采用的主题和监控数量，但不会输出目标 URL 或其他私有配置。

## 修改检查频率

默认每 5 分钟检查一次。检查频率属于公开的部署设置，不包含敏感信息，可以直接通过 GitHub 网页修改 Fork 仓库中的 `wrangler.jsonc`：

```json
"triggers": { "crons": ["*/5 * * * *"] }
```

可用值：

| 频率       | Cron           |
| ---------- | -------------- |
| 每 1 分钟  | `* * * * *`    |
| 每 5 分钟  | `*/5 * * * *`  |
| 每 10 分钟 | `*/10 * * * *` |

在 GitHub 网页保存修改后，Cloudflare Workers Builds 会自动重新部署。配置解析只接受这三个值。

## D1 自动创建与初始化

项目的 `wrangler.jsonc` 声明名为 `DB` 的 D1 binding。Cloudflare 部署时会：

1. 自动创建或选择 `status-page` D1；
2. 将它绑定为 `DB`；
3. 部署 Worker；
4. 自动执行 `database/schema.sql` 创建所需表和索引。

建表语句使用 `IF NOT EXISTS`，因此每次生产部署重复执行是安全的。

D1 保存：

- 每个监控项的一行当前状态；
- 每天、每个检查位置的一行聚合数据；
- 故障开始、升级和恢复时间。

每天 UTC 00:00 会清理超过 `historyDays` 的历史聚合和已经恢复的故障，仍未恢复的故障会继续保留。

## 配置 Telegram Bot 提醒

Telegram 是可选通知渠道。

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

这些是 Worker 运行时 Secret，与网站和监控 JSON 使用的 Build Secret 不同。

## 修改配置与重新部署

修改网站、监控项、阈值或主题：

1. 打开 Cloudflare Worker；
2. 进入 **Settings → Builds → Build variables and secrets**；
3. 替换对应 JSON Secret 的完整内容；
4. 打开 **Deployments**；
5. 重新运行最新生产部署。

修改检查频率或上传自定义图片时，可以直接使用 GitHub 网页编辑器提交文件；Cloudflare 会根据提交自动部署。

## GitHub Deploy Action

`.github/workflows/deploy.yml` 提供两个用途：

- 每次 push 和 pull request 自动运行完整检查；
- 在 GitHub Actions 网页手动运行备用生产部署。

Cloudflare Connect Repo 是主部署入口。若需要 GitHub Actions 备用入口，在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

| GitHub Secret                 | 用途                                           |
| ----------------------------- | ---------------------------------------------- |
| `STATUS_SITE_CONFIG_JSON`     | 完整网站 JSON                                  |
| `STATUS_MONITORS_CONFIG_JSON` | 完整监控项 JSON                                |
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

在 Cloudflare Worker 中打开 **Settings → Domains & Routes → Add → Custom Domain**，填写状态页域名。随后把 `STATUS_SITE_CONFIG_JSON` 中的 `url` 改为最终地址并重新部署。

如果该域名仍绑定旧 Worker 或 Pages 项目，先从旧项目移除该 Custom Domain 或 Route，再把它添加到新版 Worker。完成后访问 `/api/status` 应返回 JSON；若仍显示旧页面，或返回 `could not find api/status/index.html in your content namespace`，说明请求尚未到达新版 Worker。

## 可选：本地开发

本地开发环境用于修改和验证项目代码。

```bash
npm install
cp config/site.example.json config/site.json
cp config/monitors.example.json config/monitors.json
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
