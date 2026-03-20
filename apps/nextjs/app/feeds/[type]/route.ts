export const dynamic = 'force-dynamic';
// apps/nextjs/app/feeds/[type]/route.ts
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

const FEED_CONFIGS: Record<string, { title: string; description: string }> = {
  all: {
    title: 'NewsHive — All Intelligence',
    description: 'Technology intelligence: AI, VR/AR, Vibe Coding, SEO.',
  },
  alerts: {
    title: 'NewsHive — Alerts',
    description: 'Confirmed and developing alerts from NewsHive.',
  },
  analysis: {
    title: 'NewsHive — Analysis',
    description: 'In-depth technology analysis from NewsHive.',
  },
};

function esc(s: string | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRss(config: { title: string; description: string }, items: Array<{
  id: string;
  title: string;
  meta_description: string;
  content: string;
  published_at: string;
  confidence_level: string;
  domain_tags: string[] | null;
}>): string {
  const baseUrl = 'https://newshive.geekybee.net';
  const itemsXml = items.map(item => {
    const link = `${baseUrl}/blog/${item.id}`;
    const pubDate = new Date(item.published_at).toUTCString();
    return `
    <item>
      <title>${esc(item.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(item.meta_description)}</description>
      <content:encoded><![CDATA[${item.content || ''}]]></content:encoded>
      <nh:confidence>${esc(item.confidence_level)}</nh:confidence>
      <nh:domains>${esc((item.domain_tags || []).join(','))}</nh:domains>
      <nh:attribution>Intelligence by NewsHive (newshive.geekybee.net). CC BY 4.0.</nh:attribution>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:nh="https://newshive.geekybee.net/ns/1.0">
  <channel>
    <title>${esc(config.title)}</title>
    <link>${baseUrl}</link>
    <description>${esc(config.description)}</description>
    <language>en-gb</language>
    <ttl>300</ttl>
    ${itemsXml}
  </channel>
</rss>`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { type: string } }
) {
  const feedConfig = FEED_CONFIGS[params.type];
  if (!feedConfig) {
    return new Response('Feed not found', { status: 404 });
  }

  const sql = getDb();

  let rows;
  if (params.type === 'all') {
    rows = await sql`
      SELECT
        cp.id,
        cp.published_at,
        cp.confidence_level,
        cl.domain_tags,
        cd.draft_data->>'title'            AS title,
        cd.draft_data->>'meta_description' AS meta_description,
        cd.final_text                      AS content
      FROM content_packs cp
      JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
      LEFT JOIN clusters cl ON cl.id = cp.cluster_id
      WHERE cp.status = 'published'
      ORDER BY cp.published_at DESC
      LIMIT 50
    `;
  } else if (params.type === 'alerts') {
    rows = await sql`
      SELECT
        cp.id,
        cp.published_at,
        cp.confidence_level,
        cl.domain_tags,
        cd.draft_data->>'title'            AS title,
        cd.draft_data->>'meta_description' AS meta_description,
        cd.final_text                      AS content
      FROM content_packs cp
      JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
      LEFT JOIN clusters cl ON cl.id = cp.cluster_id
      WHERE cp.status = 'published'
        AND cp.pack_type IN ('alert_breaking', 'alert_significant')
      ORDER BY cp.published_at DESC
      LIMIT 50
    `;
  } else {
    rows = await sql`
      SELECT
        cp.id,
        cp.published_at,
        cp.confidence_level,
        cl.domain_tags,
        cd.draft_data->>'title'            AS title,
        cd.draft_data->>'meta_description' AS meta_description,
        cd.final_text                      AS content
      FROM content_packs cp
      JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
      LEFT JOIN clusters cl ON cl.id = cp.cluster_id
      WHERE cp.status = 'published'
        AND cp.pack_type = 'standard'
      ORDER BY cp.published_at DESC
      LIMIT 50
    `;
  }

  const xml = buildRss(feedConfig, rows as any);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=60',
    },
  });
}
