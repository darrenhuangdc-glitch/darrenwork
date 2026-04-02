const { Client } = require('@notionhq/client');
const { marked } = require('marked');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DB_ID;

// ── helpers ──────────────────────────────────────────────
const prop = (page, key) => page.properties[key];

function getText(p) {
  if (!p) return '';
  if (p.type === 'title') return p.title.map(t => t.plain_text).join('');
  if (p.type === 'rich_text') return p.rich_text.map(t => t.plain_text).join('');
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'multi_select') return p.multi_select.map(s => s.name);
  if (p.type === 'date') return p.date?.start || '';
  if (p.type === 'checkbox') return p.checkbox;
  return '';
}

async function getPageContent(pageId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return blocksToMarkdown(blocks);
}

function blocksToMarkdown(blocks) {
  return blocks.map(b => {
    const rt = (arr) => (arr || []).map(t => t.plain_text).join('');
    switch (b.type) {
      case 'heading_1': return `# ${rt(b.heading_1.rich_text)}\n`;
      case 'heading_2': return `## ${rt(b.heading_2.rich_text)}\n`;
      case 'heading_3': return `### ${rt(b.heading_3.rich_text)}\n`;
      case 'paragraph': return `${rt(b.paragraph.rich_text)}\n`;
      case 'bulleted_list_item': return `- ${rt(b.bulleted_list_item.rich_text)}\n`;
      case 'numbered_list_item': return `1. ${rt(b.numbered_list_item.rich_text)}\n`;
      case 'quote': return `> ${rt(b.quote.rich_text)}\n`;
      case 'code': return `\`\`\`\n${rt(b.code.rich_text)}\n\`\`\`\n`;
      case 'divider': return `---\n`;
      case 'callout': return `> **${rt(b.callout.rich_text)}**\n`;
      default: return '';
    }
  }).join('\n');
}

// ── main ─────────────────────────────────────────────────
async function main() {
  console.log('Fetching articles from Notion...');

  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: 'Status', select: { equals: '已發布' } },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });

  const articles = [];
  for (const page of res.results) {
    const title    = getText(prop(page, 'Title'));
    const excerpt  = getText(prop(page, 'Excerpt'));
    const category = getText(prop(page, 'Category'));
    const tags     = getText(prop(page, 'Tags'));
    const date     = getText(prop(page, 'Date'));
    const readtime = getText(prop(page, 'ReadTime'));
    const series   = getText(prop(page, 'Series'));
    const featured = getText(prop(page, 'Featured'));
    const slug     = getText(prop(page, 'Slug'));

    // 從 page blocks 讀取內文
    const md = await getPageContent(page.id);
    const html = marked.parse(md);

    articles.push({ title, excerpt, category, tags, date, readtime, series, featured, slug, html });
    console.log(`  ✓ ${title}`);
  }

  // 把文章資料注入 HTML 模板
  const template = fs.readFileSync('template.html', 'utf8');
  const output = template.replace(
    '/* __ARTICLES_DATA__ */',
    `const ARTICLES_DATA = ${JSON.stringify(articles, null, 2)};`
  );

  fs.writeFileSync('index.html', output);
  console.log(`Done. ${articles.length} articles written to index.html`);
}

main().catch(e => { console.error(e); process.exit(1); });
