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

async function getBlocks(pageId) {
  const res = await notionRequest(`/v1/blocks/${pageId}/children?page_size=100`);
  return res.results || [];
}

function blocksToHtml(blocks) {
  return blocks.map(b => {
    const t = b.type;
    const text = rt((b[t]||{}).rich_text||[]);
    switch(t) {
      case 'heading_1': return `<h2>${text}</h2>`;
      case 'heading_2': return `<h2>${text}</h2>`;
      case 'heading_3': return `<h3>${text}</h3>`;
      case 'paragraph': return text ? `<p>${text}</p>` : '';
      case 'bulleted_list_item': return `<li>${text}</li>`;
      case 'numbered_list_item': return `<li>${text}</li>`;
      case 'quote': return `<blockquote>${text}</blockquote>`;
      case 'divider': return `<hr>`;
      case 'callout': return `<blockquote><strong>${text}</strong></blockquote>`;
      default: return '';
    }
  }).join('\n');
}

async function main() {
  console.log('Token prefix:', TOKEN ? TOKEN.slice(0,8) : 'MISSING');
  console.log('DB_ID:', DB_ID ? DB_ID.slice(0,8) : 'MISSING');

  const res = await notionRequest(`/v1/databases/${DB_ID}/query`, {
    filter: { property: 'Status', select: { equals: '已發布' } },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });

  if (res.object === 'error') {
    console.error('Notion API error:', res.message);
    process.exit(1);
  }

  const articles = [];
  for (const page of res.results) {
    const p = page.properties;
    const blocks = await getBlocks(page.id);
    articles.push({
      title:    getText(p.Title),
      excerpt:  getText(p.Excerpt),
      category: getText(p.Category),
      tags:     getText(p.Tags),
      date:     getText(p.Date),
      readtime: getText(p.ReadTime),
      series:   getText(p.Series),
      featured: getText(p.Featured),
      html:     blocksToHtml(blocks)
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
