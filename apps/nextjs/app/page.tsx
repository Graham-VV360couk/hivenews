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
        description,
        domain_tags,
        confidence_score,
        confidence_direction,
        status,
        last_updated_at
      FROM trajectories
      WHERE status IN ('active', 'confirmed')
        AND confidence_score IS NOT NULL
      ORDER BY confidence_score DESC, last_updated_at DESC NULLS LAST
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
