const axios = require('axios');
const jsdom = require('jsdom');
const fs = require('fs');
const dayjs = require('dayjs');

const { JSDOM } = jsdom;

// --- 配置区域 ---
const URL = 'https://m.zhibo8.com/news.htm'; // 替换为你的目标URL
const RSS_FILE_PATH = './football_morning_news.xml'; // RSS文件的保存路径
const MAX_ITEMS = 50; // 【优化】只保留最近 50 条，防止文件无限膨胀

// --- 工具函数 ---

function getDateStr() {
  return dayjs().format('YYYY-MM-DD');
}

// 生成单个 item 的 XML 字符串
function createRSSItem(title, url, description) {
  // 建议：RSS标准中 pubDate 最好使用 RFC 822 格式 (如 new Date().toUTCString())
  // 这里为了保持和你原有逻辑一致，继续使用 YYYY-MM-DD，如果阅读器识别有问题请改为 standard date
  return `
    <item>
      <title>${title}</title>
      <link>${url}</link>
      <description><![CDATA[${description}]]></description>
      <pubDate>${getDateStr()}</pubDate>
    </item>
  `;
}

// 生成最终的完整 XML 结构
function createRSSFeed(itemsStr) {
  return `<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0">
    <channel>
      <title>直播8足球早报</title>
      <link>${URL}</link>
      <description>Latest football morning news from Zhibo8</description>
      <lastBuildDate>${getDateStr()} 07:30</lastBuildDate>
      ${itemsStr}
    </channel>
  </rss>`;
}

// 【核心优化】通用的文件更新逻辑：读取旧文件 -> 插入新条目 -> 截断 -> 写入
function updateRSSFile(newItemXml) {
  let existingItems = [];

  if (fs.existsSync(RSS_FILE_PATH)) {
    const fileContent = fs.readFileSync(RSS_FILE_PATH, 'utf8');
    // 【优化】使用非贪婪匹配 (.*?) 获取独立的 item 数组
    existingItems = fileContent.match(/<item>[\s\S]*?<\/item>/g) || [];
  }

  // 将新条目插入到数组最前面
  existingItems.unshift(newItemXml);

  // 【优化】如果超过最大限制，进行截断
  if (existingItems.length > MAX_ITEMS) {
    // console.log(`触发清理：当前 ${existingItems.length} 条，截断至 ${MAX_ITEMS} 条`);
    existingItems = existingItems.slice(0, MAX_ITEMS);
  }

  // 重新组合并写入
  const updatedRSSContent = existingItems.join('\n');
  const finalRSS = createRSSFeed(updatedRSSContent);

  fs.writeFileSync(RSS_FILE_PATH, finalRSS, 'utf8');
  console.log(`RSS feed updated successfully at ${new Date().toISOString()}. Total items: ${existingItems.length}`);
}

// --- 主逻辑 ---

axios
  .get(URL)
  .then((response) => {
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    const dateStr = getDateStr();

    const links = document.querySelectorAll('a');
    let morningNews = {
      title: `${dateStr} `,
      url: '',
      description: '',
    };

    // 查找早报链接
    const findLink = Array.from(links).find((link) => {
      return link.href.includes('zuqiu') && link.href.includes(dateStr) && link.textContent.includes('早报');
    });

    if (findLink) {
      morningNews.title += findLink.textContent;
      morningNews.url = `https://m.zhibo8.com/${findLink.href}`;

      // 获取链接指向页面的内容
      return axios.get(morningNews.url).then((res) => {
        const newsDom = new JSDOM(res.data);
        const newsDocument = newsDom.window.document;

        // 修复img标签
        const images = newsDocument.querySelectorAll('img');
        images.forEach((img) => {
          const imgSrc = img.getAttribute('t-rc');
          if (imgSrc) {
            img.removeAttribute('onload');
            img.style.display = 'inline';
            img.style.height = '100%';
            img.setAttribute('src', imgSrc);
          }
        });

        // 获取内容
        const content = newsDocument.querySelector('.content')?.innerHTML || '内容获取失败';
        morningNews.description = content;

        return morningNews;
      });
    } else {
      morningNews.title += '未查询到早报';
      morningNews.description = '未能找到符合条件的早报链接。';
      return morningNews;
    }
  })
  .then((morningNews) => {
    const { title, url, description } = morningNews;
    // 生成新条目的 XML
    const newItemXml = createRSSItem(title, url, description);
    // 更新文件
    updateRSSFile(newItemXml);
  })
  .catch((error) => {
    // 即使是报错信息，也走通用的更新逻辑，防止报错日志堆积导致文件过大
    const errorItemXml = createRSSItem('查询直播吧早报出错', URL, JSON.stringify(error));
    updateRSSFile(errorItemXml);
    console.error(`RSS feed updated with error:`, error);
  });
