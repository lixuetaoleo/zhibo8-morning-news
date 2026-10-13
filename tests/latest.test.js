'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  parseLatest,
  metadataByURL,
  renderFeed,
  generateLatestFeed,
} = require('../latest');

const SOURCE_URL = 'https://m.zhibo8.com/news.htm';
const SELF_URL = 'https://example.github.io/zhibo8-morning-news/football_latest.xml';
const NOW = new Date('2026-10-13T15:00:00Z');
const PINNED_URL = 'https://m.zhibo8.com/news/web/zuqiu/2026-10-13/pinned.htm';
const NEWEST_URL = 'https://m.zhibo8.com/news/web/zuqiu/2026-10-13/latest.htm';

function entry({ type = 'zuqiu', href, title, displayTime = '3分钟', thumbnail = '/images/football.jpg' }) {
  return `<li class="lite" type="${type}">
    <div class="icon_video"><a href="${href}"><img data-src="${thumbnail}" class="img-lazy" /></a></div>
    <h2><a href="${href}">${title}</a></h2>
    <p class="lite_bot"><span class="pass_time">${displayTime}</span></p>
  </li>`;
}

function section(id, entries) {
  return `<div class="module" id="${id}">
    <div class="head"><h2>最新资讯</h2></div>
    <div class="content"><div class="panel nba_p"><div class="list"><ul class="ent">
      ${entries.join('\n')}
      <li class="loading">加载中...</li>
    </ul></div></div></div>
  </div>`;
}

const LATEST_HTML = `<!doctype html><html><body>
  ${section('news_top', [entry({ href: '/news/web/zuqiu/2026-10-13/recommended.htm', title: '推荐区足球文章' })])}
  ${section('news_new', [
    entry({ href: 'news/web/zuqiu/2026-10-13/pinned.htm', title: '置顶足球文章', displayTime: '10-13 12:00', thumbnail: '//tu.duoduocdn.com/pinned.jpg' }),
    entry({ type: 'nba', href: '/news/web/nba/2026-10-13/nba.htm', title: '篮球文章' }),
    entry({ href: '/news/web/zuqiu/2026-10-13/latest.htm', title: '最新足球 &amp; 特别 &lt;报道&gt;', thumbnail: 'https://tu.duoduocdn.com/latest.jpg' }),
    entry({ type: 'other', href: '/news/web/other/2026-10-13/other.htm', title: '综合文章' }),
    entry({ href: PINNED_URL, title: '重复的置顶文章', displayTime: '10-13 13:00' }),
  ])}
</body></html>`;

const METADATA = [
  { model: 'news', type: 'zuqiu', url: '/zuqiu/2026-10-13/pinned.htm', createtime: '2026-10-13 12:00:23' },
  { model: 'news', type: 'zuqiu', url: '/zuqiu/2026-10-13/latest.htm', createtime: '2026-10-13 21:08:03' },
];

function xmlDocument(xml) {
  return new JSDOM(xml, { contentType: 'text/xml' }).window.document;
}

function feedItems(xml) {
  return Array.from(xmlDocument(xml).querySelectorAll('channel > item'));
}

async function temporaryOutput(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhibo8-latest-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'football_latest.xml');
}

test('最新资讯只保留足球，排除推荐和其他类型，链接绝对化并按页面顺序去重', () => {
  assert.deepEqual(parseLatest(LATEST_HTML), [
    { title: '置顶足球文章', url: PINNED_URL, displayTime: '10-13 12:00', thumbnail: 'https://tu.duoduocdn.com/pinned.jpg' },
    { title: '最新足球 & 特别 <报道>', url: NEWEST_URL, displayTime: '3分钟', thumbnail: 'https://tu.duoduocdn.com/latest.jpg' },
  ]);
});

test('缺少最新资讯、没有足球或足球标题链接损坏时抛错', () => {
  const invalidPages = [
    section('news_top', [entry({ href: '/news/web/zuqiu/2026-10-13/a.htm', title: '只有推荐' })]),
    section('news_new', [entry({ type: 'nba', href: '/news/web/nba/2026-10-13/a.htm', title: '只有篮球' })]),
    section('news_new', ['<li type="zuqiu"><h2>失去链接</h2></li>']),
    section('news_new', ['<li type="zuqiu"><h2><a>失去地址</a></h2></li>']),
    section('news_new', ['<li type="zuqiu"><h2><a href="/news/web/zuqiu/2026-10-13/a.htm"> </a></h2></li>']),
  ];
  for (const html of invalidPages) assert.throws(() => parseLatest(html));
});

test('元数据按足球原文 URL 匹配，发布时间按北京时间转成 RSS 日期', () => {
  const metadata = metadataByURL([
    ...METADATA,
    { model: 'news', type: 'nba', url: '/nba/2026-10-13/nba.htm', createtime: '2026-10-13 21:08:03' },
    { model: 'news', type: 'zuqiu', url: '/zuqiu/2026-10-13/bad.htm', createtime: 'unavailable' },
    { model: 'news', type: 'zuqiu', url: '/zuqiu/2026-02-30/impossible.htm', createtime: '2026-02-30 21:08:03' },
    { model: 'news', type: 'zuqiu', url: '/zuqiu/2026-10-13/empty.htm', createtime: '' },
  ]);
  assert.ok(metadata instanceof Map);
  assert.deepEqual(metadata.get(PINNED_URL), { pubDate: 'Tue, 13 Oct 2026 04:00:23 GMT' });
  assert.deepEqual(metadata.get(NEWEST_URL), { pubDate: 'Tue, 13 Oct 2026 13:08:03 GMT' });
  assert.equal(metadata.size, 2);
});

test('RSS 保留置顶和页面顺序，lastBuildDate 使用最大发布时间', () => {
  const metadata = metadataByURL(METADATA);
  const articles = parseLatest(LATEST_HTML).map((article) => ({ ...article, ...metadata.get(article.url) }));
  const document = xmlDocument(renderFeed(articles, { selfUrl: SELF_URL, now: NOW }));
  const items = Array.from(document.querySelectorAll('channel > item'));
  assert.equal(document.documentElement.tagName, 'rss');
  assert.equal(document.documentElement.getAttribute('version'), '2.0');
  assert.deepEqual(items.map((item) => item.querySelector('link').textContent), [PINNED_URL, NEWEST_URL]);
  assert.equal(document.querySelector('lastBuildDate').textContent, 'Tue, 13 Oct 2026 13:08:03 GMT');
  assert.deepEqual(items.map((item) => item.querySelector('pubDate').textContent), [
    'Tue, 13 Oct 2026 04:00:23 GMT',
    'Tue, 13 Oct 2026 13:08:03 GMT',
  ]);
});

test('RSS XML 正确处理标题、URL 和描述里的特殊字符，GUID 固定为原文 URL', () => {
  const title = '足球 & <报道> "双引号" \'单引号\' ]]> ⚽';
  const url = `${NEWEST_URL}?team=A&opponent=B`;
  const xml = renderFeed([{ title, url, displayTime: '3分钟 & 最新', thumbnail: 'https://example.com/p.jpg?a=1&b=2' }], { selfUrl: SELF_URL, now: NOW });
  const document = xmlDocument(xml);
  const item = document.querySelector('item');
  assert.equal(item.querySelector('title').textContent, title);
  assert.equal(item.querySelector('link').textContent, url);
  assert.equal(item.querySelector('guid').textContent, url);
  assert.equal(item.querySelector('guid').getAttribute('isPermaLink'), 'true');
  assert.equal(item.querySelector('pubDate'), null);
  assert.equal(document.querySelector('lastBuildDate').textContent, NOW.toUTCString());
  const atomLinks = Array.from(document.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'link'));
  assert.ok(atomLinks.some((link) => link.getAttribute('rel') === 'self' && link.getAttribute('href') === SELF_URL));
});

test('生成源取 HTML 的列表和 JSON 的时间，第二次更新保留 GUID 且无重复累积', async (t) => {
  const outputPath = await temporaryOutput(t);
  const requests = [];
  const getText = async (url) => {
    requests.push(url);
    return url === SOURCE_URL ? LATEST_HTML : JSON.stringify(METADATA);
  };
  await generateLatestFeed({ outputPath, getText, selfUrl: SELF_URL, now: NOW });
  const firstXml = await fs.readFile(outputPath, 'utf8');
  const firstItems = feedItems(firstXml);
  assert.equal(firstItems.length, 2);
  assert.deepEqual(firstItems.map((item) => item.querySelector('guid').textContent), [PINNED_URL, NEWEST_URL]);
  assert.equal(firstItems[1].querySelector('pubDate').textContent, 'Tue, 13 Oct 2026 13:08:03 GMT');
  assert.ok(requests.includes(SOURCE_URL));
  assert.ok(requests.includes('https://m.zhibo8.com/json/news/gather/2026/10/13_news_v3.htm'));
  await generateLatestFeed({ outputPath, getText, selfUrl: SELF_URL, now: new Date('2026-10-13T15:05:00Z') });
  const secondItems = feedItems(await fs.readFile(outputPath, 'utf8'));
  assert.deepEqual(secondItems.map((item) => item.querySelector('guid').textContent), [PINNED_URL, NEWEST_URL]);
});

test('HTML 请求失败或解析失败时保留旧文件，不写入错误条目', async (t) => {
  const outputPath = await temporaryOutput(t);
  const previous = renderFeed([{ title: '已有足球资讯', url: PINNED_URL, displayTime: '12分钟', thumbnail: '' }], { selfUrl: SELF_URL, now: NOW });
  for (const getText of [
    async () => { throw new Error('network unavailable'); },
    async (url) => url === SOURCE_URL ? '<html><body>访问失败</body></html>' : '[]',
    async (url) => url === SOURCE_URL ? section('news_new', []) : '[]',
    async (url) => url === SOURCE_URL ? section('news_new', ['<li type="zuqiu"><h2>结构变化</h2></li>']) : '[]',
  ]) {
    await fs.writeFile(outputPath, previous);
    await assert.rejects(generateLatestFeed({ outputPath, getText, selfUrl: SELF_URL, now: NOW }));
    assert.equal(await fs.readFile(outputPath, 'utf8'), previous);
  }
});

test('JSON 请求失败、JSON 无效或没有匹配时继续生成，只有确定的页面时间回退为发布时间', async (t) => {
  const outputPath = await temporaryOutput(t);
  for (const metadataText of [null, 'invalid-json', '[]']) {
    const getText = async (url) => {
      if (url === SOURCE_URL) return LATEST_HTML;
      if (metadataText === null) throw new Error('metadata unavailable');
      return metadataText;
    };
    await generateLatestFeed({ outputPath, getText, selfUrl: SELF_URL, now: NOW });
    const items = feedItems(await fs.readFile(outputPath, 'utf8'));
    assert.equal(items.length, 2);
    assert.equal(items[0].querySelector('pubDate').textContent, 'Tue, 13 Oct 2026 04:00:00 GMT');
    assert.equal(items[1].querySelector('pubDate'), null);
    assert.deepEqual(items.map((item) => item.querySelector('guid').textContent), [PINNED_URL, NEWEST_URL]);
  }
});

test('页面列表更新时替换旧快照，消失的文章不会继续留在源里', async (t) => {
  const outputPath = await temporaryOutput(t);
  await generateLatestFeed({ outputPath, getText: async (url) => url === SOURCE_URL ? LATEST_HTML : JSON.stringify(METADATA), selfUrl: SELF_URL, now: NOW });
  const nextHtml = section('news_new', [entry({ href: NEWEST_URL, title: '最新足球 &amp; 特别 &lt;报道&gt;' })]);
  await generateLatestFeed({ outputPath, getText: async (url) => url === SOURCE_URL ? nextHtml : JSON.stringify(METADATA), selfUrl: SELF_URL, now: NOW });
  const items = feedItems(await fs.readFile(outputPath, 'utf8'));
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelector('guid').textContent, NEWEST_URL);
});
