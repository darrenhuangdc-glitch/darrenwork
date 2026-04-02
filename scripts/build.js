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

function rt(arr) { return (arr||[]).map(t=>t.plain_text).join(''); }

function getText(p) {
  if (!p) return '';
  if (p.type === 'title') return rt(p.title);
  if (p.type === 'rich_text') return rt(p.rich_text);
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'multi_select') return p.multi_select.map(s=>s.name);
  if (p.type === 'date') return p.date?.start || '';
  if (p.type === 'checkbox') return p.checkbox;
  return '';
}

function mdToHtml(raw) {
  return (raw||'').split('\n').map(line => {
    if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith('# ')) return `<h2>${line.slice(2)}</h2>`;
    if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
    if (line.trim() === '' || line.trim() === '---') return '';
    return `<p>${line}</p>`;
  }).join('\n');
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
