<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="Status Page Logo">
</p>

<h1 align="center">Status Page</h1>

<p align="center">
  基于 Cloudflare Workers 与 D1 的轻量级公开状态页。
</p>

Status Page 按 1、5 或 10 分钟的频率检查 HTTP 服务，将实时状态、每日汇总和故障事件保存到 Cloudflare D1，并通过只读网页公开展示。项目没有登录、后台管理和在线编辑功能；站点、监控项、阈值和主题在构建时从私有配置读取，公开仓库只需保留示例配置。

主要功能：

- 支持 `GET`、`HEAD`、期望状态码、重定向和超时设置；
- 默认连续失败 2 次变为黄色，首个失败持续 60 分钟后变为红色；
- 默认连续成功 2 次恢复绿色；
- 红色升级不发送通知，黄色故障和绿色恢复各通知一次；
- 默认保留并展示最近 90 天历史记录，并每日自动清理更早的数据；
- 支持明暗模式、简约默认主题和可选星露谷风格主题；
- 可选 Slack、Telegram 和 Discord 通知；
- 公开页面只读，不提供任何管理功能。

## 部署前准备

你需要：

- 一个 Cloudflare 账户；
- 一个 GitHub 账户；
- Node.js 22 或更高版本；
- npm。

以下命令均在本项目根目录运行，也就是包含 `package.json` 和 `wrangler.jsonc` 的目录。

## 第一步：创建 Cloudflare D1 数据库

D1 是本项目使用的结构化 SQL 数据库。数据库名称建议保持为 `status-page`，它只是 Cloudflare 内部资源名，不会显示在网站上。

### 方式一：通过 Cloudflare 控制台创建

1. 登录 Cloudflare Dashboard；
2. 打开 **Storage & Databases → D1 SQL database**；
3. 选择 **Create Database**；
4. 数据库名称填写 `status-page`；
5. 创建后复制数据库的 UUID。

### 方式二：通过 Wrangler 创建

先安装依赖并登录 Cloudflare：

```bash
npm install
npx wrangler login
```

创建数据库：

```bash
npx wrangler d1 create status-page
```

命令完成后会返回类似下面的配置：

```json
{
  "binding": "DB",
  "database_name": "status-page",
  "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

其中 `database_id` 就是下一步需要填写的 D1 UUID。

## 第二步：填写 D1 绑定

打开 `wrangler.jsonc`，找到：

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "status-page",
    "database_id": "00000000-0000-0000-0000-000000000000"
  }
]
```

只把全零的 `database_id` 替换为 Cloudflare 返回的真实 UUID：

```json
"database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

不要修改：

- `binding: "DB"`；
- `database_name: "status-page"`。

D1 UUID 是资源标识符，不是访问密钥，可以保存在 `wrangler.jsonc` 中。Cloudflare API Token、Webhook 和机器人 Token 则不能提交到 GitHub。

## 第三步：初始化 D1 表结构

`database/schema.sql` 保存空数据库所需的建表语句。它只负责创建当前版本运行所需的表和索引，不包含任何旧项目数据处理逻辑。

Wrangler 已包含在本项目的开发依赖中，执行 `npm install` 后通过 `npx wrangler` 使用即可，不需要全局安装。确保 Wrangler 已登录到刚才创建 D1 的同一个 Cloudflare 账户，然后执行：

```bash
npx wrangler d1 execute DB --remote --file database/schema.sql
```

Wrangler 会询问是否继续，确认目标数据库正确后选择确认。远程表结构初始化不会在 GitHub Actions 或 Cloudflare Workers Builds 中自动执行。

如果不想在本机执行 Wrangler，也可以在 Cloudflare Dashboard 的 D1 Console 中执行 `database/schema.sql`。初始化 D1 只需执行一次，日常部署不需要重复创建数据库。

## 第四步：配置网站

公开仓库只保留两份无敏感信息的模板：

| 仓库文件                       | 用途                                       |
| ------------------------------ | ------------------------------------------ |
| `config/site.example.yaml`     | 网站信息、默认主题、历史天数和全局故障阈值 |
| `config/monitors.example.yaml` | 被监控的服务及每项服务的可选覆盖配置       |
| `wrangler.jsonc`               | D1 绑定、Worker 名称和检查频率             |

实际部署配置通过两个完整的 YAML 字符串传入：

| 构建 Secret 名称              | 内容来源          |
| ----------------------------- | ----------------- |
| `STATUS_SITE_CONFIG_YAML`     | 完整的网站 YAML   |
| `STATUS_MONITORS_CONFIG_YAML` | 完整的监控项 YAML |

构建脚本的读取优先级为：两个构建 Secret → 本地的 `config/site.yaml` 与 `config/monitors.yaml` → 仓库中的两份 example。两个 Secret 或两个本地文件都必须成对提供，避免误把示例配置部署到生产环境。

本地编辑时，先复制模板：

```bash
cp config/site.example.yaml config/site.yaml
cp config/monitors.example.yaml config/monitors.yaml
```

这两个本地文件已加入 `.gitignore`。配置文件使用 YAML，缩进只能使用空格，布尔值写成 `true` 或 `false`，不要使用 Tab。下面是一份完整的网站配置示例：

```yaml
title: Status Page
url: https://status.example.com
logo: /logo.svg
theme: default
colorMode: system
historyDays: 90
requestTimeoutSeconds: 10
userAgent: StatusPage/2
thresholds:
  degradedAfterFailures: 2
  outageAfterMinutes: 60
  recoverAfterSuccesses: 2
labels:
  allOperational: 所有服务运行正常
  someDegraded: 部分服务出现故障
  someOutage: 部分服务暂时不可用
  statusUnknown: 暂时无法获取服务状态
  operational: 运行正常
  degraded: 出现故障
  outage: 服务中断
  noData: 暂无数据
  searchPlaceholder: 搜索服务
  noServices: 尚未配置服务。
  noMatches: 没有匹配的服务。
  recentIncidents: 最近故障
  noIncidents: 最近没有故障。
  lastChecked: 最后检查
  responseTime: 响应时间
  location: 检查位置
  historyStart: "{days} 天前"
  today: 今天
  startedAt: 首次失败
  escalatedAt: 中断开始
  recoveredAt: 已恢复
  ongoing: 处理中
```

常用配置说明：

| 配置项                  | 说明                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `title`                 | 网站标题                                                    |
| `url`                   | 最终访问地址，首次部署时可先填写计划使用的域名              |
| `logo`                  | `public/` 目录中的 Logo 路径                                |
| `theme`                 | `default` 或 `stardew-inspired`                             |
| `colorMode`             | `system`、`light` 或 `dark`                                 |
| `historyDays`           | 历史数据的保留和展示天数，范围为 1–365                      |
| `requestTimeoutSeconds` | 默认请求超时秒数，必须短于选定的 Cron 间隔                  |
| `userAgent`             | 检查目标服务时发送的自定义 HTTP `User-Agent`，最长 256 字符 |
| `degradedAfterFailures` | 连续失败多少次后变黄                                        |
| `outageAfterMinutes`    | 从首个失败开始多少分钟后变红                                |
| `recoverAfterSuccesses` | 连续成功多少次后恢复绿色                                    |
| `labels`                | 页面上使用的文字，所有字段都需要保留                        |

`labels.historyStart` 中的 `{days}` 会被替换为历史天数，翻译时应保留这个占位符。其他标签不支持自定义占位符。`userAgent` 可以改成自己的项目名，例如 `MyStatusPage/1.0`；不能包含换行，也不要在其中放 Token 或其他秘密。

### 更换网站 Logo

把 SVG、PNG 或 WebP 文件放入 `public/`，然后填写以 `/` 开头的公开路径。例如文件是 `public/my-logo.svg`：

```yaml
logo: /my-logo.svg
```

Logo 文件必须真实存在，否则 `npm run check` 会拒绝构建。浏览器页签图标使用 `public/favicon.svg`，如需替换，请覆盖该文件并保留文件名。

### 更换主题和明暗模式

主题源文件统一存放在 `themes/`，目前内置：

| `theme` 值         | 效果               |
| ------------------ | ------------------ |
| `default`          | 默认简约卡片主题   |
| `stardew-inspired` | 星露谷风格像素主题 |

切换为星露谷风格：

```yaml
theme: stardew-inspired
colorMode: system
```

切回简约主题：

```yaml
theme: default
colorMode: system
```

`colorMode` 的可选值为：

- `system`：首次访问时跟随操作系统；
- `light`：首次访问时使用亮色；
- `dark`：首次访问时使用暗色。

访客仍可使用页面右上角按钮切换明暗模式，选择结果保存在访客自己的浏览器中。`colorMode` 只决定首次访问或尚未保存偏好时的默认值。

主题在构建时确定，修改后运行 `npm run check` 并重新部署。公开页面没有主题管理后台，也不能在运行时切换 `default` 与 `stardew-inspired`。不要只把新文件夹复制到 `themes/` 后直接填写其名称；当前配置只接受上表中的两个主题，开发新主题还需要把主题 ID 注册到类型和构建脚本中。

## 第五步：配置监控项

本地编辑 `config/monitors.yaml`，Cloudflare 部署时则把相同内容保存到 `STATUS_MONITORS_CONFIG_YAML` 构建 Secret：

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
    presentationLogo: /logo.svg
    timeoutSeconds: 15
    thresholds:
      degradedAfterFailures: 3
      outageAfterMinutes: 30
      recoverAfterSuccesses: 2
```

字段说明：

| 字段               | 是否必填 | 说明                                         |
| ------------------ | -------: | -------------------------------------------- |
| `id`               |       是 | 稳定且唯一，最多 64 个小写字母、数字或连字符 |
| `name`             |       是 | 公开显示的服务名称                           |
| `description`      |       否 | 服务说明                                     |
| `url`              |       是 | 实际检查地址                                 |
| `method`           |       是 | `GET` 或 `HEAD`                              |
| `expectStatus`     |       是 | 期望的 HTTP 状态码                           |
| `followRedirect`   |       是 | 是否跟随重定向                               |
| `linkable`         |       是 | 是否将 URL 作为公开链接返回                  |
| `presentationLogo` |       否 | `public/` 目录中的服务 Logo                  |
| `timeoutSeconds`   |       否 | 覆盖全局超时秒数                             |
| `thresholds`       |       否 | 覆盖该监控项的部分阈值                       |

最多可以配置 25 个监控项。每个 `id` 一旦上线就应保持不变，因为状态、故障和历史记录都使用它关联；修改 `name` 不影响历史，修改 `id` 则会被视为一个新服务。

`expectStatus` 检查最终响应是否等于指定状态码。`followRedirect: true` 会跟随跳转并检查最终响应；设置为 `false` 时不跟随跳转。`presentationLogo` 与网站 Logo 一样，必须指向 `public/` 中真实存在的文件，例如上述 `/logo.svg` 对应 `public/logo.svg`。可以先把每项服务的图标放进 `public/services/`，再改成 `/services/文件名.svg`。不需要单项覆盖时，删除 `presentationLogo`、`timeoutSeconds` 和 `thresholds` 即可使用全局配置。

设置 `linkable: false` 后，公开 API 不会返回该监控项的 URL，服务卡片也不会链接到目标。私有构建配置不会写入 GitHub，但监控地址仍会被 Worker 用来发起请求；不要在 URL 中携带密码、Token 或签名参数。设置为 `linkable: true` 等同于明确允许该 URL 出现在公开 API 和页面链接中。

每次修改后先检查配置：

```bash
npm run check
```

如果字段拼写错误、ID 重复、文件路径不存在、数值超出范围或 Cron 不受支持，检查会直接失败并输出原因。

## 第六步：选择检查频率

打开 `wrangler.jsonc`，修改 `triggers.crons` 中唯一的表达式：

| 检查频率   | Cron 表达式    |
| ---------- | -------------- |
| 每分钟     | `* * * * *`    |
| 每 5 分钟  | `*/5 * * * *`  |
| 每 10 分钟 | `*/10 * * * *` |

默认配置为：

```json
"triggers": {
  "crons": ["* * * * *"]
}
```

红色状态使用经过分钟数计算，所以切换 1、5 或 10 分钟检查频率不会改变 `outageAfterMinutes` 的含义。

项目只配置一个 Cron。请求超时必须短于所选间隔，避免前一次检查尚未结束时下一次检查已经开始。

每次检查不会新增一条原始记录。D1 只覆盖每个服务的当前状态、累加每天的汇总数据，并在发生故障时记录开始、升级和恢复时间。因此一分钟频率也不会持续增长逐分钟明细表。

## 第七步：本地检查

确认已按第四步创建两个本地配置文件，然后在上传 GitHub 前执行：

```bash
npm install
npm run check
```

该命令会依次执行配置生成、TypeScript 类型检查、单元测试、前端测试、Worker 与隔离 D1 测试以及生产构建。

如需本地预览：

```bash
npm run db:init:local
npm run dev
```

## 第八步：上传 GitHub

建议把本目录中的内容直接作为 GitHub 仓库根目录。上传后，仓库根目录应直接包含：

```text
package.json
wrangler.jsonc
config/
database/
public/
src/
themes/
```

不要上传 `config/site.yaml`、`config/monitors.yaml`、`.dev.vars`、`.env*`、`.wrangler/`、`dist/`、`node_modules/` 或任何 API Token、Webhook 和机器人凭据；它们都已写入 `.gitignore`。仓库中应只出现 `config/*.example.yaml`。如果实际配置曾经被加入版本控制，仅添加 `.gitignore` 不会隐藏旧记录，公开仓库前必须确认 GitHub 文件列表和历史中都没有它们。

本项目已经按独立仓库组织；Cloudflare 的 Root directory 保持为空即可。

## 第九步：连接 Cloudflare Workers Builds

本项目应部署为 Cloudflare **Worker**，不是 Pages 项目。

在 Cloudflare Dashboard 中依次进入：

```text
Workers & Pages
→ Create application
→ Import a repository
→ Connect GitHub
→ 选择刚才上传的仓库
```

构建设置填写：

| 设置                          | 填写内容                       |
| ----------------------------- | ------------------------------ |
| Worker name                   | `status-page`                  |
| Production branch             | `main`                         |
| Root directory                | 项目位于仓库根目录时留空       |
| Build command                 | `npm run check`                |
| Deploy command                | `npx wrangler deploy`          |
| Non-production deploy command | `npx wrangler versions upload` |

在 **Build variables and secrets** 中添加普通构建变量：

| 变量名         | 值   |
| -------------- | ---- |
| `NODE_VERSION` | `22` |

然后在同一位置添加两个加密的 **Secret**，值应粘贴为对应 YAML 文件的完整内容，而不是文件路径：

| Secret 名称                   | 值                                     |
| ----------------------------- | -------------------------------------- |
| `STATUS_SITE_CONFIG_YAML`     | 本地 `config/site.yaml` 的完整内容     |
| `STATUS_MONITORS_CONFIG_YAML` | 本地 `config/monitors.yaml` 的完整内容 |

这两个是构建阶段 Secret，只在生成 Worker 配置时使用；Telegram 等通知凭据是 Worker 运行时 Secret，两类设置位置和用途不同。不要把监控 YAML 添加成普通明文变量。

Cloudflare 连接 GitHub 时会为 Workers Builds 配置部署授权，不需要把 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID` 写进仓库。

内部 Worker 名称必须与 `wrangler.jsonc` 中的 `name: "status-page"` 一致。它不会显示在网站标题中，网站仍显示 `Status Page`。

确认后选择 **Save and Deploy**。构建过程会安装依赖、执行完整检查、生成并部署前端与 Worker、绑定 D1，并应用一个 Cron Trigger 配置。

### GitHub Deploy Action 是什么

仓库中的 `.github/workflows/deploy.yml` 有两个用途：每次 push 或 pull request 自动检查代码；以及在 GitHub Actions 页面手动选择 `Run workflow` 并勾选 `deploy` 后，作为 Cloudflare Connect Repo 之外的备用生产部署入口。它不会自动初始化 D1、执行 D1 表结构 SQL 或搬迁旧数据。

只使用 Cloudflare Connect Repo 时，不需要配置 GitHub 部署凭据，也不需要运行手动 Deploy job。若要使用这个备用入口，请在 GitHub 仓库的 Actions Secrets 中配置：

| GitHub Secret                 | 用途                         |
| ----------------------------- | ---------------------------- |
| `STATUS_SITE_CONFIG_YAML`     | 完整网站 YAML                |
| `STATUS_MONITORS_CONFIG_YAML` | 完整监控项 YAML              |
| `CLOUDFLARE_API_TOKEN`        | 限定范围的 Worker 部署 Token |
| `CLOUDFLARE_ACCOUNT_ID`       | Cloudflare 账户 ID           |

Deploy job 会先验证两个私有配置均存在并完成构建，再调用 Wrangler 发布。工作流不会主动输出配置值；如果 YAML 解析失败，仍应检查错误日志后再决定是否公开分享。Cloudflare Connect Repo 与手动 Action 共享同一份代码，但各自保存一套 Secret；使用哪条部署路径，就维护哪一处配置。

## 第十步：配置 Telegram Bot 提醒（可选）

如果不需要通知，可以跳过本节。没有配置密钥时，对应通知渠道会自动跳过。

本项目会在服务达到黄色故障阈值时发送一次 Telegram 消息，并在服务恢复绿色时再发送一次。状态从黄色升级为红色时不会发送新消息，也不会按固定间隔重复提醒。

### 10.1 创建机器人并取得 Token

1. 在 Telegram 中打开官方 [@BotFather](https://t.me/BotFather)；
2. 发送 `/newbot`；
3. 按提示填写机器人显示名称和用户名；
4. 保存 BotFather 返回的 HTTP API Token。

Token 的格式通常类似 `123456789:AA...`。它等同于机器人的密码，泄露后应立即在 BotFather 中撤销并重新生成，不要把真实 Token 粘贴到 Issue、提交记录或聊天截图中。

### 10.2 取得接收提醒的 Chat ID

发送到个人会话：

1. 打开刚创建的机器人；
2. 点击 **Start** 或发送 `/start`。机器人不能主动发起与用户的首次会话；
3. 在本地浏览器访问以下地址，把 `<BOT_TOKEN>` 临时替换为真实 Token：

```text
https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
```

4. 在返回 JSON 中找到 `result[].message.chat.id`，它就是 `SECRET_TELEGRAM_CHAT_ID`。

发送到群组：

1. 把机器人加入目标群组，并确保它有发送消息的权限；
2. 在群组中发送一条机器人可见的消息，例如 `/start@你的机器人用户名`；
3. 再调用上面的 `getUpdates`；
4. 找到对应群组消息的 `message.chat.id`。群组或超级群组 ID 通常是负数，复制时必须保留负号。

如果 `result` 为空，先确认已经向机器人或群组发送了一条新消息，然后刷新请求。获取完成后清除包含 Token 的浏览器历史；更稳妥的做法是在本地终端调用同一 API，避免 Token 被浏览器同步。

### 10.3 先测试机器人能否发送消息

访问下面的地址，分别替换 Token 和 Chat ID：

```text
https://api.telegram.org/bot<BOT_TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=Status%20Page%20test
```

收到 `Status Page test` 后再配置 Worker。若返回 `chat not found`，通常是 Chat ID 错误、个人用户尚未点击 Start，或机器人尚未加入目标群组。若向频道发送，需要先把机器人设为有发消息权限的频道管理员；公开频道也可使用 `@频道用户名` 作为 Chat ID。

### 10.4 将 Token 和 Chat ID 保存为 Worker Secret

建议先等待生产 Worker 完成至少两次成功检查，再添加通知密钥。在 Cloudflare Dashboard 打开已部署的 Worker，进入 **Settings → Variables and Secrets**，分别新增两个加密的 **Secret**：

| Secret 名称                 | 填写内容                             |
| --------------------------- | ------------------------------------ |
| `SECRET_TELEGRAM_API_TOKEN` | BotFather 返回的完整 Bot Token       |
| `SECRET_TELEGRAM_CHAT_ID`   | 上一步得到的个人、群组或频道 Chat ID |

保存后按 Cloudflare 提示部署新版本。不要把它们添加到公开的 `wrangler.jsonc`、`config/` 或 Workers Builds 普通变量中。

也可以在已登录 Wrangler 的本地终端中分别执行：

```bash
npx wrangler secret put SECRET_TELEGRAM_API_TOKEN
npx wrangler secret put SECRET_TELEGRAM_CHAT_ID
```

每条命令会提示输入值，直接粘贴后确认，不要把 Secret 写在命令参数中。设置完成后，可等待一次真实的黄色故障与绿色恢复来验证完整通知链路；不要故意中断不受你控制的服务。

### 10.5 其他可选通知渠道

如需同时使用 Slack 或 Discord，再添加相应 Secret：

```bash
npx wrangler secret put SECRET_SLACK_WEBHOOK_URL
npx wrangler secret put SECRET_DISCORD_WEBHOOK_URL
```

- Slack 需要 `SECRET_SLACK_WEBHOOK_URL`；
- Discord 需要 `SECRET_DISCORD_WEBHOOK_URL`。

这些是 Worker 运行时 Secret，不是构建变量。不要写入 `config/`、`wrangler.jsonc`、GitHub 仓库或公开日志。

## 第十一步：验证部署

打开 Cloudflare 提供的 `workers.dev` 地址，确认页面标题和 Logo、明暗模式、服务信息以及 `/api/status` 均正常。`linkable: false` 的监控项不应在公开 API 中返回 URL。

可以通过以下只读命令确认定时任务已经写入 D1：

```bash
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS states FROM monitor_state;"
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS days FROM daily_summaries;"
```

如果 `monitor_state` 仍为空，依次检查 Cron Triggers、名为 `DB` 的 D1 binding、`database_id` 所属账户以及 Worker 日志。

## 第十二步：绑定自定义域名

确认 `workers.dev` 页面、API 和定时检查均正常后：

1. 在 Worker 的 **Settings → Domains & Routes** 中添加自定义域名；
2. 更新 Cloudflare Workers Builds 中的 `STATUS_SITE_CONFIG_YAML`，将 `url` 改为最终地址；
3. 手动触发一次新构建，或推送一次代码变更触发构建；
4. 等待 Cloudflare Connect Repo 重新部署；
5. 检查自定义域名和 `/api/status`。

## 后续更新与回滚

连接仓库后：

- 推送到 `main` 会执行 `npm run check`，成功后自动部署；
- 其他启用的分支使用 `wrangler versions upload` 生成预览版本；
- 配置、监控项和主题的修改应更新对应的 Cloudflare Build Secret，并触发重新部署；
- 回滚 Worker 版本只回滚代码和静态资源，不会回滚 D1 数据或表结构。

如需回滚，在 Cloudflare Worker 的版本历史中选择之前验证过的版本。出现数据库问题时，优先使用只读查询诊断，不要删除或清空 D1。

## 常用命令

| 命令                    | 用途                           |
| ----------------------- | ------------------------------ |
| `npm run dev`           | 启动本地开发环境               |
| `npm run check`         | 类型检查、全部测试和生产构建   |
| `npm run db:init:local` | 初始化本地 D1 表结构           |
| `npm run deploy`        | 从本地构建并通过 Wrangler 部署 |

更严格的预览、生产切换和回滚顺序见 [运维手册](docs/operations.md)。

## Cloudflare 官方文档

- [Cloudflare D1 入门](https://developers.cloudflare.com/d1/get-started/)
- [D1 Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Vite 插件](https://developers.cloudflare.com/workers/vite-plugin/)
- [Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Telegram Bot 创建教程](https://core.telegram.org/bots/tutorial)
- [Telegram Bot API](https://core.telegram.org/bots/api)
