const axios = require('axios');
const { JSDOM } = require('jsdom');
const fs = require('node:fs/promises');
const path = require('node:path');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));

const SOURCE_URL = 'https://m.zhibo8.com/news.htm';
const DEFAULT_OUTPUT = path.join(__dirname, 'football_morning_news.xml');
const DEFAULT_FEED_URL = 'https://raw.githubusercontent.com/lixuetaoleo/zhibo8-morning-news/main/football_morning_news.xml';
const MAX_ITEMS = 50;

function getDateStr(now = new Date()) {
  return dayjs(now).tz('Asia/Shanghai').format('YYYY-MM-DD');
}

function httpURL(value, base = SOURCE_URL) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol.');
  url.hash = '';
  return url.href;
}

function publicationDate(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value || '')) return undefined;
  const date = new Date(`${value.replace(' ', 'T')}+08:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19) !== value.replace(' ', 'T')) return undefined;
  return date.toUTCString();
}

function morningItem(title, href, dateStr, pubDate) {
  if (!/^早报[：:]/.test(title || '') || !href) return null;
  const url = httpURL(href);
  if (!new URL(url).pathname.startsWith(`/news/web/zuqiu/${dateStr}/`)) return null;
  return { title: `${dateStr} ${title.trim()}`, url, ...(pubDate ? { pubDate } : {}) };
}

function findDailyMorning(rows, dateStr) {
  if (!Array.isArray(rows)) throw new Error('The daily news response is not an array.');
  for (const row of rows) {
    if (row?.type !== 'zuqiu' || row.model !== 'news' || typeof row.url !== 'string') continue;
    const href = row.url.startsWith('/') ? `/news/web${row.url}` : row.url;
    const item = morningItem(row.title, href, dateStr, publicationDate(row.createtime));
    if (item) return item;
  }
  return null;
}

function parseMorning(html, dateStr) {
  const dom = new JSDOM(html, { url: SOURCE_URL });
  try {
    if (!dom.window.document.querySelector('#news_new, #news_top')) {
      throw new Error('The news list is missing.');
    }
    for (const link of dom.window.document.querySelectorAll('#news_new li[type="zuqiu"] h2 a[href], #news_top li[type="zuqiu"] h2 a[href]')) {
      const time = link.closest('li').querySelector('.pass_time')?.textContent.trim();
      const absolute = time?.match(/^(\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
      const pubDate = absolute && dateStr.slice(5) === absolute[1]
        ? publicationDate(`${dateStr} ${absolute[2]}:00`) : undefined;
      const item = morningItem(link.textContent.trim(), link.getAttribute('href'), dateStr, pubDate);
      if (item) return item;
    }
    return null;
  } finally {
    dom.window.close();
  }
}

function extractMorningContent(html, url) {
  const dom = new JSDOM(html, { url });
  try {
    const content = dom.window.document.querySelector('#content.content-box, #content')
      || dom.window.document.querySelector('.content');
    if (!content) throw new Error('The morning article body is missing.');
    for (const unwanted of content.querySelectorAll('script, style, iframe, object, form, .media-zone, .play_btn')) unwanted.remove();
    for (const element of content.querySelectorAll('*')) {
      for (const attr of [...element.attributes]) {
        if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
      }
      if (element.tagName === 'IMG') {
        const src = element.getAttribute('t-rc') || element.getAttribute('t-src')
          || element.getAttribute('data-src') || element.getAttribute('src');
        try {
          if (!src) throw new Error('Missing image URL.');
          element.setAttribute('src', httpURL(src, url));
          element.setAttribute('style', 'max-width:100%;height:auto;');
        } catch {
          element.remove();
        }
      } else if (element.hasAttribute('href')) {
        try {
          element.setAttribute('href', httpURL(element.getAttribute('href'), url));
        } catch {
          element.removeAttribute('href');
        }
      }
    }
    if (!content.textContent.trim()) throw new Error('The morning article body is empty.');
    return content.innerHTML;
  } finally {
    dom.window.close();
  }
}

function readExistingItems(text) {
  if (!text?.trim()) return [];
  const dom = new JSDOM(text, { contentType: 'text/xml' });
  try {
    if (!dom.window.document.querySelector('rss > channel')) throw new Error('The existing RSS file is invalid.');
    return [...dom.window.document.querySelectorAll('channel > item')].map((item) => {
      const date = item.querySelector('pubDate')?.textContent;
      return {
        title: item.querySelector('title')?.textContent || '',
        url: item.querySelector('link')?.textContent || '',
        description: item.querySelector('description')?.textContent || '',
        ...(/^[A-Za-z]{3}, /.test(date || '') && Number.isFinite(Date.parse(date)) ? { pubDate: date } : {}),
      };
    }).filter((item) => /\/news\/web\/zuqiu\/\d{4}-\d{2}-\d{2}\//.test(item.url)
      && item.description.trim() && !/未查询到早报|查询直播吧早报出错/.test(item.title));
  } finally {
    dom.window.close();
  }
}

function xml(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function renderMorningFeed(items, { now, selfUrl }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>直播8足球早报</title>
    <link>${SOURCE_URL}</link>
    <description>直播吧足球早报全文，保留最近 ${MAX_ITEMS} 期。</description>
    <language>zh-cn</language>
    <ttl>30</ttl>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
    <atom:link href="${xml(selfUrl)}" rel="self" type="application/rss+xml" />
${items.map((item) => `    <item>
      <title>${xml(item.title)}</title>
      <link>${xml(item.url)}</link>
      <guid isPermaLink="true">${xml(item.url)}</guid>
      <description>${xml(item.description)}</description>${item.pubDate ? `\n      <pubDate>${xml(item.pubDate)}</pubDate>` : ''}
    </item>`).join('\n')}
  </channel>
</rss>
`;
}

async function fetchText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 20000,
        responseType: 'text',
        maxContentLength: 10 * 1024 * 1024,
        headers: { Cookie: 'stype=football', 'User-Agent': 'Mozilla/5.0 (compatible; Zhibo8MorningRSS/1.0)' },
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (attempt === 2 || (status >= 400 && status < 500 && status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }
}

async function generateMorningFeed({
  outputPath = DEFAULT_OUTPUT,
  getText = fetchText,
  now = new Date(),
  selfUrl = process.env.FEED_URL || DEFAULT_FEED_URL,
} = {}) {
  let previous = '';
  try {
    previous = await fs.readFile(outputPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const existing = readExistingItems(previous);
  const dateStr = getDateStr(now);
  let morning;
  try {
    const dailyURL = `https://m.zhibo8.com/json/news/gather/${dateStr.replace(/-/g, '/')}_news_v3.htm`;
    morning = findDailyMorning(JSON.parse(await getText(dailyURL)), dateStr);
  } catch (error) {
    console.warn(`Daily news metadata unavailable: ${error.message}`);
  }
  if (!morning) morning = parseMorning(await getText(SOURCE_URL), dateStr);
  if (!morning) return { status: 'pending', items: existing };
  if (existing.some((item) => item.url === morning.url && item.title === morning.title && item.description.trim())) {
    return { status: 'unchanged', items: existing };
  }
  morning.description = extractMorningContent(await getText(morning.url), morning.url);
  const seen = new Set();
  const items = [morning, ...existing].filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, MAX_ITEMS);
  const content = renderMorningFeed(items, { now, selfUrl });
  const temporary = `${outputPath}.tmp`;
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, outputPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { status: 'updated', items };
}

if (require.main === module) {
  generateMorningFeed().then(({ status, items }) => {
    console.log(`Morning RSS ${status}: ${items.length} entries.`);
  }).catch((error) => {
    console.error(`Morning RSS generation failed; the existing feed is preserved: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { getDateStr, findDailyMorning, parseMorning, extractMorningContent, readExistingItems, generateMorningFeed };
