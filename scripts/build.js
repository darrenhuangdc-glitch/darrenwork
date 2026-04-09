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

// ── Rich text → HTML ──────────────────────────────────────────────
function richTextToHtml(richTexts) {
  if (!Array.isArray(richTexts)) return '';
  return richTexts.map(r => {
    let text = r.plain_text || '';
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ann = r.annotations || {};
    if (ann.bold)          text = `<strong>${text}</strong>`;
    if (ann.italic)        text = `<em>${text}</em>`;
    if (ann.strikethrough) text = `<del>${text}</del>`;
    if (ann.underline)     text = `<u>${text}</u>`;
    if (ann.code)          text = `<code>${text}</code>`;
    if (r.href)            text = `<a href="${r.href}" target="_blank" rel="noopener">${text}</a>`;
    return text;
  }).join('');
}

// ── Block → HTML ──────────────────────────────────────────────────
function blockToHtml(block) {
  const type = block.type;
  const data = block[type] || {};

  switch (type) {
    case 'paragraph':
      return `<p>${richTextToHtml(data.rich_text)}</p>`;
    case 'heading_1':
      return `<h1>${richTextToHtml(data.rich_text)}</h1>`;
    case 'heading_2':
      return `<h2>${richTextToHtml(data.rich_text)}</h2>`;
    case 'heading_3':
      return `<h3>${richTextToHtml(data.rich_text)}</h3>`;
    case 'heading_4':
      return `<h4>${richTextToHtml(data.rich_text)}</h4>`;
    case 'bulleted_list_item':
      return `<li>${richTextToHtml(data.rich_text)}</li>`;
    case 'numbered_list_item':
      return `<li>${richTextToHtml(data.rich_text)}</li>`;
    case 'to_do': {
      const checked = data.checked ? 'checked' : '';
      return `<li><input type="checkbox" ${checked} disabled> ${richTextToHtml(data.rich_text)}</li>`;
    }
    case 'quote':
      return `<blockquote>${richTextToHtml(data.rich_text)}</blockquote>`;
    case 'callout': {
      const icon = data.icon?.emoji
        ? `<span class="callout-icon">${data.icon.emoji}</span>`
        : data.icon?.external?.url
          ? `<span class="callout-icon"><img src="${data.icon.external.url}" style="width:20px"></span>`
          : '';
      return `<div class="callout">${icon}<div>${richTextToHtml(data.rich_text)}</div></div>`;
    }
    case 'code': {
      const lang = data.language || '';
      const code = (data.rich_text || []).map(r => r.plain_text).join('');
      return `<pre><code class="language-${lang}">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`;
    }
    case 'divider':
      return `<hr>`;
    case 'image': {
      const src = data.type === 'external' ? (data.external?.url || '') : (data.file?.url || '');
      const caption = richTextToHtml(data.caption || []);
      if (!src) return '';
      return `<figure><img src="${src}" alt="${caption || ''}" style="max-width:100%;border-radius:8px;">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
    }
    case 'table': {
      const rows = block.children || [];
      if (!rows.length) return '';
      const hasHeader = data.has_column_header;
      let html = '<table>\n';
      rows.forEach((row, i) => {
        const cells = row.table_row?.cells || [];
        const tag = (hasHeader && i === 0) ? 'th' : 'td';
        html += '<tr>' + cells.map(cell => `<${tag}>${richTextToHtml(cell)}</${tag}>`).join('') + '</tr>\n';
      });
      html += '</table>';
      return html;
    }
    case 'table_row':
      return '';
    case 'toggle': {
      const summary = richTextToHtml(data.rich_text);
      const inner = (block.children || []).map(blockToHtml).join('');
      return `<details><summary>${summary}</summary>${inner}</details>`;
    }
    case 'column_list': {
      const cols = (block.children || []).map(col => {
        const inner = (col.children || []).map(blockToHtml).join('');
        return `<div style="flex:1;min-width:0">${inner}</div>`;
      }).join('');
      return `<div style="display:flex;gap:24px;flex-wrap:wrap">${cols}</div>`;
    }
    case 'column':
      return (block.children || []).map(blockToHtml).join('');
    case 'embed':
    case 'link_preview': {
      const url = data.url || '';
      return url ? `<p><a href="${url}" target="_blank" rel="noopener">${url}</a></p>` : '';
    }
    case 'bookmark': {
      const url = data.url || '';
      const caption = richTextToHtml(data.caption || []);
      return `<p><a href="${url}" target="_blank" rel="noopener">${caption || url}</a></p>`;
    }
    case 'video': {
      const src = data.external?.url || data.file?.url || '';
      if (!src) return '';
      const ytMatch = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
      if (ytMatch) {
        return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:16px 0"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" style="position:absolute;top:0;left:0;width:100%;height:100%" frameborder="0" allowfullscreen></iframe></div>`;
      }
      return `<video controls style="max-width:100%"><source src="${src}"></video>`;
    }
    case 'child_page':
    case 'child_database':
    case 'unsupported':
      return '';
    default:
      console.warn('[blockToHtml] 未處理的 block type:', type);
      return '';
  }
}

// ── Blocks → HTML（處理 ul/ol 包裝）──────────────────────────────────
function blocksToHtml(blocks) {
  let html = '';
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'bulleted_list_item') {
      html += '<ul>';
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        html += blockToHtml(blocks[i++]);
      }
      html += '</ul>';
    } else if (block.type === 'numbered_list_item') {
      html += '<ol>';
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        html += blockToHtml(blocks[i++]);
      }
      html += '</ol>';
    } else {
      html += blockToHtml(block);
      i++;
    }
  }
  return html;
}

// ── Fetch Notion page blocks（遞迴抓子 blocks）──────────────────────
async function fetchBlocks(blockId) {
  const blocks = [];
  let cursor;
  const needsChildren = ['table','toggle','column_list','column','bulleted_list_item','numbered_list_item','quote','callout'];

  do {
    const path = `/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await notionRequest(path);
    if (res.object === 'error') { console.error('blocks error:', res.message); break; }
    for (const block of res.results) {
      if (needsChildren.includes(block.type) && block.has_children) {
        block.children = await fetchBlocks(block.id);
      }
      blocks.push(block);
    }
    cursor = res.next_cursor;
  } while (cursor);

  return blocks;
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
    const blocks = await fetchBlocks(page.id);
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
