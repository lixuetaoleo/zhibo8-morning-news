# 直播吧足球 RSS

把[直播吧资讯页面](https://m.zhibo8.com/news.htm)的足球「最新资讯」生成 RSS 2.0，通过 GitHub Actions 更新，使用仓库原始文件链接订阅。原有足球早报继续保留。

## 订阅

| RSS | 订阅地址 | 更新方式 |
| --- | --- | --- |
| 足球最新资讯 | [football_latest.xml](https://raw.githubusercontent.com/lixuetaoleo/zhibo8-morning-news/main/football_latest.xml) | 计划每 15 分钟更新 |
| 足球早报 | [football_morning_news.xml](https://raw.githubusercontent.com/lixuetaoleo/zhibo8-morning-news/main/football_morning_news.xml) | 北京时间 07:11 至 12:41，每半小时检查 |

把对应链接复制到 RSS 阅读器即可。两个源分别由 [latest.js](latest.js) 和 [index.js](index.js) 生成，工作流见 [最新资讯任务](.github/workflows/update_latest_rss.yml)和[早报任务](.github/workflows/update_rss.yml)。

## 最新资讯的范围

- 请求携带 `Cookie: stype=football`，再显式筛选 `#news_new li[type="zuqiu"]`。返回的 HTML 仍包含其他类型，上游在[页面脚本](https://m.zhibo8.com/v2/js/action_v2.js?v=1.5)中按类型筛选。
- 收录当前页面「最新资讯」的全部足球条目，保持页面顺序和置顶位置，使用文章 URL 作为稳定 GUID。跨日后的条目范围随页面变化，历史条目由阅读器保存。
- [每日资讯 JSON 示例](https://m.zhibo8.com/json/news/gather/2026/10/13_news_v3.htm)仅用于补充发布时间，条目范围以页面为准。时间按北京时间处理。JSON 暂时不可用时，优先解析页面中的绝对时间，相对时间条目省略 `pubDate`。
- 页面请求失败、解析失败或没有有效足球条目时，任务失败并保留旧 XML。RSS 内容没有变化时跳过提交。实现与验证见 [latest.js](latest.js) 和 [tests/latest.test.js](tests/latest.test.js)。

## 足球早报的更新

- 按北京时间查找当天足球早报，上午多次检查，收录正文并保留最多 50 条历史早报。
- 使用文章 URL 去重。当天早报已经收录时跳过正文请求，也跳过重复提交。
- 当天早报尚未发布，或请求、解析失败时，保留上一版 RSS。后续任务继续检查。
- `pubDate` 使用早报实际发布时间，输出 RSS 使用的 RFC 日期格式。实现与验证见 [index.js](index.js) 和 [tests/morning.test.js](tests/morning.test.js)，原文示例见 [2026 年 10 月 14 日足球早报](https://m.zhibo8.com/news/web/zuqiu/2026-10-14/6ace72c1b5926native.htm)。

## GitHub 自动更新

[最新资讯工作流](.github/workflows/update_latest_rss.yml)按 UTC 每小时第 7、22、37、52 分钟运行，也支持在仓库 **Actions → Update Zhibo8 Football Latest RSS → Run workflow** 手动触发。`main` 分支相关脚本、测试、依赖或该工作流发生变化时也会运行。任务通过仓库自带的 `GITHUB_TOKEN` 提交 XML，无需额外密钥。[GitHub Token 权限说明](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)

[早报工作流](.github/workflows/update_rss.yml)按 UTC `11,41 0-4,23 * * *` 运行，对应北京时间 07:11 至 12:41，每半小时一次。可在 **Actions → Update Zhibo8 RSS → Run workflow** 手动触发，`main` 分支早报脚本、测试或工作流发生变化时也会运行。早报任务仅提交自己的 XML，与最新资讯任务同时更新仓库时会先同步分支，最多重试 3 次。

GitHub 定时任务可能延迟，负载高时也可能跳过。定时任务只在默认分支运行，公开仓库连续 60 天没有活动时会自动停用。[GitHub 官方调度说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 本地运行

安装 Node.js 22，然后运行：

```sh
npm ci
node --test tests/latest.test.js
node latest.js
```

生成文件为仓库根目录的 `football_latest.xml`。可通过 `FEED_URL` 设置 RSS 自身的订阅地址，GitHub 工作流会自动使用当前仓库和默认分支的 raw 链接。入口与配置见 [latest.js](latest.js)。

生成足球早报：

```sh
node --test tests/morning.test.js
node index.js
```

生成文件为 `football_morning_news.xml`，同样支持通过 `FEED_URL` 设置自身的订阅地址。入口与配置见 [index.js](index.js)。
