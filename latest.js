const axios = require('axios');
const { JSDOM } = require('jsdom');
const fs = require('node:fs/promises');
const path = require('node:path');

const SOURCE_URL = 'https://m.zhibo8.com/news.htm';
const DEFAULT_FEED_URL = 'https://raw.githubusercontent.com/lixuetaoleo/zhibo8-morning-news/main/football_latest.xml';
const DEFAULT_OUTPUT = path.join(__dirname, 'football_latest.xml');

function httpURL(value, base = SOURCE_URL) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error(`Unsupported article URL protocol: ${url.protocol}`);
  }
  url.hash = '';
  return url.href;
}

function parseLatest(html) {
  const dom = new JSDOM(html, { url: SOURCE_URL });
  try {
    const section = dom.window.document.querySelector('#news_new');
    if (!section) throw new Error('The latest-news section (#news_new) is missing.');
    const articles = [];
    const seen = new Set();
    for (const row of section.querySelectorAll('li[type="zuqiu"]')) {
      const link = row.querySelector('h2 a[href]');
      const title = link?.textContent.trim().replace(/\s+/g, ' ');
      const href = link?.getAttribute('href')?.trim();
      if (!title || !href) throw new Error('A football entry has no title or link.');
      const url = httpURL(href);
      if (seen.has(url)) continue;
      seen.add(url);
      const image = row.querySelector('img');
      const imageURL = image?.getAttribute('data-src') || image?.getAttribute('src');
      let thumbnail = '';
      try {
        if (imageURL) thumbnail = httpURL(imageURL);
      } catch {
        // The optional thumbnail cannot invalidate a news entry.
      }
      articles.push({
        title,
        url,
        displayTime: row.querySelector('.pass_time')?.textContent.trim() || '',
        thumbnail,
      });
    }
    if (!articles.length) throw new Error('No football entries in the latest-news section.');
    return articles;
  } finally {
    dom.window.close();
  }
}

function shanghaiDate(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value || '')) return undefined;
  const date = new Date(`${value.replace(' ', 'T')}+08:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  // Reject normalized invalid dates such as February 30.
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19);
  if (local !== value.replace(' ', 'T')) return undefined;
  return date.toUTCString();
}

function metadataByURL(rows) {
  if (!Array.isArray(rows)) throw new Error('The daily news response is not an array.');
  const metadata = new Map();
  for (const row of rows) {
    if (row?.type !== 'zuqiu' || typeof row.url !== 'string' || !row.url.trim()) continue;
    try {
      const relative = row.model === 'news' && row.url.startsWith('/')
        ? `/news/web${row.url}` : row.url;
      const url = httpURL(relative);
      const pubDate = shanghaiDate(row.createtime);
      if (pubDate) metadata.set(url, { pubDate });
    } catch {
      // A malformed metadata row does not remove an entry from the HTML list.
    }
  }
  return metadata;
}

function displayedDate(article) {
  const date = new URL(article.url).pathname.match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1];
  const time = article.displayTime.match(/^(\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (!date || !time || date.slice(5) !== time[1]) return undefined;
  return shanghaiDate(`${date} ${time[2]}:00`);
}

function xml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function renderFeed(articles, { selfUrl = DEFAULT_FEED_URL, now = new Date() } = {}) {
  if (!articles.length) throw new Error('Refusing to render an empty feed.');
  httpURL(selfUrl);
  const dates = articles.map((article) => Date.parse(article.pubDate)).filter(Number.isFinite);
  const lastBuildDate = new Date(dates.length ? Math.max(...dates) : now).toUTCString();
  const items = articles.map((article) => {
    const description = `${article.thumbnail ? `<p><img src="${xml(article.thumbnail)}" alt="${xml(article.title)}"></p>` : ''}<p><a href="${xml(article.url)}">阅读全文</a></p>`;
    return `    <item>
      <title>${xml(article.title)}</title>
      <link>${xml(article.url)}</link>
      <guid isPermaLink="true">${xml(article.url)}</guid>
      <description>${xml(description)}</description>
      <category>足球</category>${article.pubDate ? `\n      <pubDate>${xml(article.pubDate)}</pubDate>` : ''}
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>直播吧足球最新资讯</title>
    <link>${SOURCE_URL}</link>
    <description>直播吧手机版“最新资讯”中的足球列表，保留页面顺序。</description>
    <language>zh-cn</language>
    <ttl>15</ttl>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${xml(selfUrl)}" rel="self" type="application/rss+xml" />
${items}
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
        headers: {
          Cookie: 'stype=football',
          'User-Agent': 'Mozilla/5.0 (compatible; Zhibo8FootballRSS/1.0)',
          Referer: SOURCE_URL,
        },
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (attempt === 2 || (status >= 400 && status < 500 && status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }
}

async function generateLatestFeed({
  outputPath = DEFAULT_OUTPUT,
  getText = fetchText,
  now = new Date(),
  selfUrl = process.env.FEED_URL || DEFAULT_FEED_URL,
} = {}) {
  const articles = parseLatest(await getText(SOURCE_URL));
  const dates = [...new Set(articles.map((article) =>
    new URL(article.url).pathname.match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1]
  ).filter(Boolean))];
  if (dates.length > 7) throw new Error('Unexpected date range in the latest-news section.');
  const metadata = new Map();
  await Promise.all(dates.map(async (date) => {
    const url = `https://m.zhibo8.com/json/news/gather/${date.replace(/-/g, '/')}_news_v3.htm`;
    try {
      for (const [key, value] of metadataByURL(JSON.parse(await getText(url)))) metadata.set(key, value);
    } catch (error) {
      console.warn(`Publication metadata unavailable for ${date}: ${error.message}`);
    }
  }));
  for (const article of articles) {
    const pubDate = metadata.get(article.url)?.pubDate || displayedDate(article);
    if (pubDate) article.pubDate = pubDate;
  }
  const content = renderFeed(articles, { selfUrl, now });
  let previous;
  try {
    previous = await fs.readFile(outputPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const changed = previous !== content;
  if (changed) {
    const temporary = `${outputPath}.tmp`;
    try {
      await fs.writeFile(temporary, content, 'utf8');
      await fs.rename(temporary, outputPath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  return { articles, changed, outputPath };
}

if (require.main === module) {
  generateLatestFeed().then(({ articles, changed, outputPath }) => {
    console.log(`${changed ? 'Updated' : 'Unchanged'}: ${outputPath} (${articles.length} football entries)`);
  }).catch((error) => {
    console.error(`RSS generation failed; the existing feed is preserved: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { SOURCE_URL, parseLatest, metadataByURL, renderFeed, generateLatestFeed };
