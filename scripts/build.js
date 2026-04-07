const https = require('https');
const fs = require('fs');

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DB_ID;

function notionRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.notion.com',
      path,
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) })
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function rt(arr) { return (arr || []).map(t => t.plain_text).join(''); }

function getText(p) {
  if (!p) return '';
  if (p.type === 'title') return rt(p.title);
  if (p.type === 'rich_text') return rt(p.rich_text);
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'multi_select') return p.multi_select.map(s => s.name);
  if (p.type === 'date') return p.date?.start || '';
  if (p.type === 'checkbox') return p.checkbox;
  return '';
}

function mdToHtml(raw) {
  const lines = (raw || '').split('\n');
  const result = [];
  let inList = false;

  for (const line of lines) {
    // 標題
    if (line.startsWith('### ')) { if (inList) { result.push('</ul>'); inList = false; } result.push(`<h3>${line.slice(4)}</h3>`); continue; }
    if (line.startsWith('## '))  { if (inList) { result.push('</ul>'); inList = false; } result.push(`<h2>${line.slice(3)}</h2>`); continue; }
    if (line.startsWith('# '))   { if (inList) { result.push('</ul>'); inList = false; } result.push(`<h2>${line.slice(2)}</h2>`); continue; }

    // 圖片（必須在連結之前）
    const imgMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<img src="${imgMatch[2]}" alt="${imgMatch[1]}" loading="lazy" style="max-width:100%;border-radius:8px;margin:16px 0;">`);
      continue;
    }

    // 清單
    if (line.startsWith('- ')) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }

    // 分隔線 / 空行
    if (line.trim() === '---') { if (inList) { result.push('</ul>'); inList = false; } result.push('<hr>'); continue; }
    if (line.trim() === '')    { if (inList) { result.push('</ul>'); inList = false; } continue; }

    // 一般段落
    if (inList) { result.push('</ul>'); inList = false; }
    result.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inList) result.push('</ul>');
  return result.join('\n');
}

// 行內格式（粗體、斜體、code、連結）
function inlineFormat(text) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" style="max-width:100%;border-radius:8px;margin:8px 0;">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

async function main() {
  const res = await notionRequest(`/v1/databases/${DB_ID}/query`, {
    filter: { property: 'Status', select: { equals: '已發布' } },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });

  if (res.object === 'error') { console.error(res.message); process.exit(1); }

  const articles = [];
  for (const page of res.results) {
    const p = page.properties;
    articles.push({
      title:    getText(p.Title),
      excerpt:  getText(p.Excerpt),
      category: getText(p.Category),
      tags:     getText(p.Tags),
      date:     getText(p.Date),
      readtime: getText(p.ReadTime),
      series:   getText(p.Series),
      featured: getText(p.Featured),
      html:     mdToHtml(getText(p.Content))
    });
    console.log('✓', getText(p.Title));
  }

  const template = fs.readFileSync('template.html', 'utf8');
  const output = template.replace(
    '/* __ARTICLES_DATA__ */',
    `const ARTICLES_DATA = ${JSON.stringify(articles, null, 2)};`
  );
  fs.writeFileSync('index.html', output);
  console.log(`Done. ${articles.length} articles.`);
}

main().catch(e => { console.error(e); process.exit(1); });
