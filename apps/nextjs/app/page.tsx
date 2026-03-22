// apps/nextjs/app/page.tsx
import { getDb } from '@/lib/db';
import { HomePageView, type Story, type Alert, type SecuritySignal } from './HomePageView';

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
        c.id,
        c.name,
        LEFT(c.narrative, 400)  AS description,
        c.domain_tags,
        GREATEST(
          COALESCE(c.readiness_score, 0)::float,
          CASE
            WHEN tf.min_tier = 1 THEN 70
            WHEN tf.min_tier = 2 THEN 45
            ELSE 0
          END
        )                       AS confidence_score,
        CASE WHEN GREATEST(
          COALESCE(c.readiness_score, 0)::float,
          CASE WHEN tf.min_tier = 1 THEN 70 WHEN tf.min_tier = 2 THEN 45 ELSE 0 END
        ) >= 75 THEN 'rising' ELSE 'stable' END AS confidence_direction,
        'active'                AS status,
        c.narrative_updated_at  AS last_updated_at,
        NULL::text              AS url
      FROM clusters c
      LEFT JOIN LATERAL (
        SELECT MIN(src.tier) AS min_tier
        FROM signals sig
        JOIN sources src ON src.id = sig.source_id
        WHERE sig.cluster_id = c.id
      ) tf ON true
      WHERE c.is_active = TRUE
        AND c.narrative IS NOT NULL
        AND c.name IS NOT NULL
      ORDER BY c.narrative_updated_at DESC NULLS LAST
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

async function getSecuritySignals(): Promise<SecuritySignal[]> {
  try {
    const sql = getDb();
    const rows = await sql<SecuritySignal[]>`
      SELECT
        s.title,
        s.url,
        s.ingested_at,
        src.name AS source_name
      FROM signals s
      JOIN sources src ON src.id = s.source_id
      WHERE 'security' = ANY(s.domain_tags)
        AND s.ingested_at > NOW() - INTERVAL '48 hours'
        AND s.title IS NOT NULL
      ORDER BY s.ingested_at DESC
      LIMIT 20
    `;
    return rows;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [stories, alerts, securitySignals] = await Promise.all([
    getStories(),
    getAlerts(),
    getSecuritySignals(),
  ]);
  return <HomePageView stories={stories} alerts={alerts} securitySignals={securitySignals} />;
}
