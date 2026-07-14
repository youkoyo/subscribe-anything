/**
 * Deterministic RSS/Atom parser for preset sources. Relevance is intentionally
 * decided in the host collector so first discovery and scheduled collection
 * share the same AI classification path.
 */
export function buildStandardFeedScript(feedUrl: string): string {
  const source = JSON.stringify(feedUrl);
  return `
async function collect() {
  const FEED_URL = ${source};
  const response = await fetch(FEED_URL, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
  if (!response.ok) throw new Error('Feed HTTP ' + response.status);
  const xml = await response.text();
  const clean = (value) => String(value || '').replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\s+/g, ' ').trim();
  const tag = (block, name) => { const match = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i')); return clean(match ? match[1] : ''); };
  const blocks = /<entry[\\s>]/i.test(xml) ? xml.split(/<entry[\\s>]/i).slice(1) : xml.split(/<item[\\s>]/i).slice(1);
  return blocks.map((block) => {
    const title = tag(block, 'title');
    const summary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content');
    const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    const url = (href && href[1]) || tag(block, 'link') || tag(block, 'guid') || tag(block, 'id');
    const publishedAt = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    if (!title || !url || !/^https?:/i.test(url)) return null;
    return { title, url, summary: summary || undefined, publishedAt: publishedAt || undefined };
  }).filter(Boolean);
}
`;
}
