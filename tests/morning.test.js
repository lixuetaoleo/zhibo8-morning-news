'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  getDateStr,
  findDailyMorning,
  parseMorning,
  extractMorningContent,
  generateMorningFeed,
} = require('../index');

const DATE = '2026-10-14';
const NOW = new Date('2026-10-13T23:30:00Z');
const SOURCE_URL = 'https://m.zhibo8.com/news.htm';
const DAILY_URL = 'https://m.zhibo8.com/json/news/gather/2026/10/14_news_v3.htm';
const ARTICLE_URL = 'https://m.zhibo8.com/news/web/zuqiu/2026-10-14/morning.htm';
const SELF_URL = 'https://raw.githubusercontent.com/example/repo/main/football_morning_news.xml';
const PUBLISHED = 'Tue, 13 Oct 2026 23:15:27 GMT';
const TITLE = '早报：足球 & <经典> "引号" ]]> ⚽';
const DAILY_ROW = {
  model: 'news',
  type: 'zuqiu',
  title: TITLE,
  url: '/zuqiu/2026-10-14/morning.htm',
  createtime: '2026-10-14 07:15:27',
};

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function htmlEntry(href, title, type = 'zuqiu') {
  return `<li class="lite" type="${type}"><h2><a href="${xml(href)}">${xml(title)}</a></h2><p><span class="pass_time">10-14 07:15</span></p></li>`;
}

function listHTML(entries, id = 'news_new') {
  return `<!doctype html><html><body><div id="${id}"><ul>${entries.join('\n')}</ul></div></body></html>`;
}

const ARTICLE_HTML = `<!doctype html><html><body>
  <div class="content"><aside>外部导航</aside>
    <div id="content" class="content-box" onclick="alert('container')">
      <style>p{display:none}</style><script>throw new Error('must be removed')</script>
      <p onclick="alert('paragraph')">比赛战报 2 &lt; 3 &amp; 足球 "引用" ]]&gt; ⚽</p>
      <img t-rc="/images/morning.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="display:none" onload="alert('loaded')" onerror="alert('error')">
      <img data-src="//tu.duoduocdn.com/second.jpg" onmouseover="alert('hover')">
      <a href="/news/web/zuqiu/2026-10-14/match.htm" onclick="alert('link')">阅读全文</a>
    </div>
  </div>
</body></html>`;

function historicalItem(index, description = '<p>完整的历史正文</p>') {
  const date = new Date(Date.UTC(2026, 9, 13 - index));
  const dateStr = date.toISOString().slice(0, 10);
  return {
    title: `${dateStr} 早报：历史第${index}篇`,
    url: `https://m.zhibo8.com/news/web/zuqiu/${dateStr}/old-${index}.htm`,
    description,
    pubDate: date.toUTCString(),
  };
}

function previousFeed(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
    <title>足球早报</title><link>${SOURCE_URL}</link><description>已有 RSS</description>
    ${items.map((item) => `<item><title>${xml(item.title)}</title><link>${xml(item.url)}</link>
      <description>${xml(item.description || '')}</description>${item.pubDate ? `<pubDate>${xml(item.pubDate)}</pubDate>` : ''}
    </item>`).join('\n')}
  </channel></rss>`;
}

function readItems(content) {
  return Array.from(new JSDOM(content, { contentType: 'text/xml' }).window.document.querySelectorAll('channel > item'));
}

async function temporaryOutput(t, previous) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhibo8-morning-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'football_morning_news.xml');
  if (previous !== undefined) await fs.writeFile(outputPath, previous);
  return outputPath;
}

function normalRequests(requests = []) {
  return async (url) => {
    requests.push(url);
    if (url === DAILY_URL) return JSON.stringify([DAILY_ROW]);
    if (url === ARTICLE_URL) return ARTICLE_HTML;
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('日期使用北京时间，UTC 日期跨天后仍请求当天早报', () => {
  assert.equal(getDateStr(new Date('2026-10-13T15:59:59Z')), '2026-10-13');
  assert.equal(getDateStr(new Date('2026-10-13T16:00:00Z')), DATE);
  assert.equal(getDateStr(NOW), DATE);
});

test('JSON 只选 URL 日期一致、标题以早报开头的当天足球新闻', () => {
  const result = findDailyMorning([
    { ...DAILY_ROW, type: 'nba', url: '/nba/2026-10-14/nba.htm' },
    { ...DAILY_ROW, model: 'video', url: '/zuqiu/2026-10-14/video.htm' },
    { ...DAILY_ROW, title: '昨晚足球早报汇总', url: '/zuqiu/2026-10-14/other.htm' },
    { ...DAILY_ROW, url: '/zuqiu/2026-10-13/yesterday.htm' },
    DAILY_ROW,
  ], DATE);
  assert.deepEqual(result, { title: `${DATE} ${TITLE}`, url: ARTICLE_URL, pubDate: PUBLISHED });
  assert.equal(findDailyMorning([], DATE), null);
  assert.throws(() => findDailyMorning({ rows: [DAILY_ROW] }, DATE));
});

test('HTML 早报链接支持相对、根相对和绝对地址，标题中的特殊字符保留', () => {
  for (const href of ['news/web/zuqiu/2026-10-14/morning.htm', '/news/web/zuqiu/2026-10-14/morning.htm', ARTICLE_URL]) {
    const result = parseMorning(listHTML([
      htmlEntry('/news/web/nba/2026-10-14/nba.htm', '早报：篮球', 'nba'),
      htmlEntry('/news/web/zuqiu/2026-10-13/yesterday.htm', '早报：昨天'),
      htmlEntry('/news/web/zuqiu/2026-10-14/other.htm', '球迷谈早报文章'),
      htmlEntry(href, TITLE),
    ]), DATE);
    assert.equal(result.title, `${DATE} ${TITLE}`);
    assert.equal(result.url, ARTICLE_URL);
  }
  assert.equal(parseMorning(listHTML([htmlEntry(ARTICLE_URL, '早报:英文冒号')], 'news_top'), DATE).url, ARTICLE_URL);
  assert.equal(parseMorning(listHTML([htmlEntry('/news/web/zuqiu/2026-10-13/yesterday.htm', '早报：昨天')]), DATE), null);
});

test('正文使用内容区并修复懒加载图片，去掉脚本、样式标签和事件属性', () => {
  const content = extractMorningContent(ARTICLE_HTML, ARTICLE_URL);
  const document = new JSDOM(content, { url: ARTICLE_URL }).window.document;
  assert.ok(document.body.textContent.includes('比赛战报 2 < 3 & 足球 "引用" ]]> ⚽'));
  assert.ok(!document.body.textContent.includes('外部导航'));
  assert.equal(document.querySelector('script, style'), null);
  for (const element of document.querySelectorAll('*')) {
    assert.ok(!Array.from(element.attributes).some((attribute) => /^on/i.test(attribute.name)));
  }
  const images = Array.from(document.querySelectorAll('img'));
  assert.deepEqual(images.map((image) => image.getAttribute('src')), [
    'https://m.zhibo8.com/images/morning.jpg',
    'https://tu.duoduocdn.com/second.jpg',
  ]);
  assert.ok(images.every((image) => image.style.display !== 'none'));
  assert.throws(() => extractMorningContent('<html><body>没有正文</body></html>', ARTICLE_URL));
  assert.ok(extractMorningContent('<div class="content"><p>旧版正文</p></div>', ARTICLE_URL).includes('旧版正文'));
});

test('从当天 JSON 发布早报，XML 正确转义并保留历史与 RFC 日期', async (t) => {
  const outputPath = await temporaryOutput(t, previousFeed([historicalItem(0)]));
  const requests = [];
  const result = await generateMorningFeed({ outputPath, getText: normalRequests(requests), now: NOW, selfUrl: SELF_URL });
  assert.equal(result.status, 'updated');
  assert.equal(result.items.length, 2);
  assert.deepEqual(requests, [DAILY_URL, ARTICLE_URL]);
  const items = readItems(await fs.readFile(outputPath, 'utf8'));
  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector('title').textContent, `${DATE} ${TITLE}`);
  assert.equal(items[0].querySelector('link').textContent, ARTICLE_URL);
  assert.equal(items[0].querySelector('guid').textContent, ARTICLE_URL);
  assert.equal(items[0].querySelector('guid').getAttribute('isPermaLink'), 'true');
  assert.equal(items[0].querySelector('pubDate').textContent, PUBLISHED);
  const body = new JSDOM(items[0].querySelector('description').textContent).window.document;
  assert.ok(body.body.textContent.includes('比赛战报 2 < 3 & 足球 "引用" ]]> ⚽'));
  assert.equal(body.querySelector('script, style'), null);
  assert.equal(body.querySelector('img').getAttribute('src'), 'https://m.zhibo8.com/images/morning.jpg');
  assert.equal(items[1].querySelector('link').textContent, historicalItem(0).url);
});

test('JSON 无匹配、无效或请求失败时用页面列表找到当天早报', async (t) => {
  const outputPath = await temporaryOutput(t);
  for (const dailyResponse of ['[]', 'invalid-json', null]) {
    await fs.rm(outputPath, { force: true });
    const requests = [];
    const getText = async (url) => {
      requests.push(url);
      if (url === DAILY_URL) {
        if (dailyResponse === null) throw new Error('Daily JSON unavailable');
        return dailyResponse;
      }
      if (url === SOURCE_URL) return listHTML([htmlEntry('news/web/zuqiu/2026-10-14/morning.htm', TITLE)], 'news_top');
      if (url === ARTICLE_URL) return ARTICLE_HTML;
      throw new Error(`Unexpected URL: ${url}`);
    };
    const result = await generateMorningFeed({ outputPath, getText, now: NOW, selfUrl: SELF_URL });
    assert.equal(result.status, 'updated');
    assert.deepEqual(requests, [DAILY_URL, SOURCE_URL, ARTICLE_URL]);
    assert.equal(readItems(await fs.readFile(outputPath, 'utf8'))[0].querySelector('guid').textContent, ARTICLE_URL);
  }
});

test('已收录相同标题和 URL 的完整早报时不重复请求正文或修改文件', async (t) => {
  const previous = previousFeed([{ title: `${DATE} ${TITLE}`, url: ARTICLE_URL, description: '<p>已抓取的完整正文</p>', pubDate: PUBLISHED }]);
  const outputPath = await temporaryOutput(t, previous);
  const requests = [];
  const getText = async (url) => {
    requests.push(url);
    if (url === DAILY_URL) return JSON.stringify([DAILY_ROW]);
    throw new Error('Existing morning article must not be fetched again');
  };
  const result = await generateMorningFeed({ outputPath, getText, now: NOW, selfUrl: SELF_URL });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.items.length, 1);
  assert.ok(!requests.includes(ARTICLE_URL));
  assert.equal(await fs.readFile(outputPath, 'utf8'), previous);
});

test('当天尚未发布时返回 pending 并保留原 RSS，也不会创建空源', async (t) => {
  const previous = previousFeed([historicalItem(0)]);
  const outputPath = await temporaryOutput(t, previous);
  const getText = async (url) => {
    if (url === DAILY_URL) return '[]';
    if (url === SOURCE_URL) return listHTML([htmlEntry('/news/web/zuqiu/2026-10-13/yesterday.htm', '早报：昨天')]);
    throw new Error('Unpublished article must not be fetched');
  };
  const result = await generateMorningFeed({ outputPath, getText, now: NOW, selfUrl: SELF_URL });
  assert.equal(result.status, 'pending');
  assert.equal(await fs.readFile(outputPath, 'utf8'), previous);
  await fs.rm(outputPath);
  assert.equal((await generateMorningFeed({ outputPath, getText, now: NOW, selfUrl: SELF_URL })).status, 'pending');
  await assert.rejects(fs.stat(outputPath), { code: 'ENOENT' });
});

test('列表或文章 HTTP 失败、正文解析失败时抛错并完整保留原文件', async (t) => {
  const previous = previousFeed([historicalItem(0)]);
  const outputPath = await temporaryOutput(t, previous);
  for (const getText of [
    async () => { throw new Error('All upstream requests unavailable'); },
    async (url) => { if (url === DAILY_URL) return JSON.stringify([DAILY_ROW]); throw new Error('Article unavailable'); },
    async (url) => url === DAILY_URL ? JSON.stringify([DAILY_ROW]) : '<html><body>没有正文</body></html>',
  ]) {
    await assert.rejects(generateMorningFeed({ outputPath, getText, now: NOW, selfUrl: SELF_URL }));
    assert.equal(await fs.readFile(outputPath, 'utf8'), previous);
  }
});

test('更新时通过 XML 读取历史、按 URL 去重，清理旧错误占位并最多保留 50 篇', async (t) => {
  const history = Array.from({ length: 55 }, (_, index) => historicalItem(index));
  const duplicate = { ...history[0], title: history[0].title + ' 重复' };
  const errorPlaceholder = { title: '查询直播吧早报出错', url: SOURCE_URL, description: '<p>Network Error</p>' };
  const outputPath = await temporaryOutput(t, previousFeed([history[0], duplicate, errorPlaceholder, ...history.slice(1)]));
  const result = await generateMorningFeed({ outputPath, getText: normalRequests(), now: NOW, selfUrl: SELF_URL });
  assert.equal(result.status, 'updated');
  const items = readItems(await fs.readFile(outputPath, 'utf8'));
  assert.equal(items.length, 50);
  const links = items.map((item) => item.querySelector('link').textContent);
  assert.equal(new Set(links).size, links.length);
  assert.equal(links[0], ARTICLE_URL);
  assert.equal(links[1], history[0].url);
  assert.ok(!links.includes(SOURCE_URL));
  assert.ok(items.every((item) => !item.querySelector('title').textContent.includes('出错')));
});
