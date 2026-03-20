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
        id,
        name,
        LEFT(narrative, 400)                           AS description,
        domain_tags,
        COALESCE(readiness_score, 0)::float            AS confidence_score,
        CASE WHEN readiness_score >= 75 THEN 'rising' ELSE 'stable' END AS confidence_direction,
        'active'                                        AS status,
        narrative_updated_at                            AS last_updated_at,
        NULL::text                                      AS url
      FROM clusters
      WHERE is_active = TRUE
        AND narrative IS NOT NULL
        AND name IS NOT NULL
      ORDER BY narrative_updated_at DESC NULLS LAST
      LIMIT 30
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
