// apps/nextjs/app/page.tsx
import { getDb } from '@/lib/db';
import { HomePageView, type Story, type Alert } from './HomePageView';

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

async function getAlerts(): Promise<Alert[]> {
  try {
    const sql = getDb();
    const rows = await sql<Alert[]>`
      SELECT
        ac.id,
        ac.alert_tier,
        ac.confidence_level,
        ac.composite_score::float,
        ac.corroboration_count,
        ac.fired_at,
        s.title   AS signal_title,
        s.url     AS signal_url,
        s.domain_tags
      FROM alert_candidates ac
      LEFT JOIN signals s ON s.id = ac.signal_ids[1]
      WHERE ac.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY ac.composite_score DESC NULLS LAST
      LIMIT 10
    `;
    return rows;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [stories, alerts] = await Promise.all([getStories(), getAlerts()]);
  return <HomePageView stories={stories} alerts={alerts} />;
}
