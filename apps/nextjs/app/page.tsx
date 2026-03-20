// apps/nextjs/app/page.tsx
import { getDb } from '@/lib/db';
import { HomePageView, type Story } from './HomePageView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'NewsHive — Intelligence Feed',
  description: 'Confidence-labelled intelligence across AI, VR, SEO, and Vibe Coding. Evolving stories tracked and rated in real time.',
};

async function getStories(): Promise<Story[]> {
  try {
    const sql = getDb();
    const rows = await sql<Story[]>`
      SELECT
        s.id,
        s.title                                       AS name,
        LEFT(s.content, 300)                          AS description,
        s.domain_tags,
        COALESCE(s.importance_composite, 0)::float    AS confidence_score,
        CASE WHEN s.is_alert_candidate THEN 'rising' ELSE 'stable' END AS confidence_direction,
        COALESCE(s.confidence_level, 'unassessed')    AS status,
        COALESCE(s.published_at, s.ingested_at)       AS last_updated_at,
        s.url
      FROM signals s
      WHERE s.importance_composite IS NOT NULL
        AND s.is_public = TRUE
        AND COALESCE(s.published_at, s.ingested_at) > NOW() - INTERVAL '90 days'
      ORDER BY
        s.is_alert_candidate DESC,
        s.importance_composite DESC,
        COALESCE(s.published_at, s.ingested_at) DESC NULLS LAST
      LIMIT 60
    `;
    return rows;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const stories = await getStories();
  return <HomePageView stories={stories} />;
}
