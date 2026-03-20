// apps/nextjs/app/blog/page.tsx
import { getDb } from '@/lib/db';
import Link from 'next/link';

interface BlogItem {
  id: string;
  pack_type: string;
  published_at: string;
  confidence_level: string;
  title: string;
  meta_description: string;
}

async function getPublishedPosts(): Promise<BlogItem[]> {
  const sql = getDb();
  const rows = await sql<BlogItem[]>`
    SELECT
      cp.id,
      cp.pack_type,
      cp.published_at,
      cp.confidence_level,
      cd.draft_data->>'title'            AS title,
      cd.draft_data->>'meta_description' AS meta_description
    FROM content_packs cp
    JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
    WHERE cp.status = 'published'
      AND cp.published_at IS NOT NULL
    ORDER BY cp.published_at DESC
    LIMIT 20
  `;
  return rows;
}

const CONFIDENCE_BADGE: Record<string, string> = {
  confirmed: '🔴 CONFIRMED',
  developing: '🟡 DEVELOPING',
  pinch_of_salt: '🧂 PINCH OF SALT',
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 700 }}>NewsHive Intelligence</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '15px' }}>
          Technology intelligence covering AI, VR/AR, Vibe Coding, and SEO.
        </p>
      </div>

      {posts.length === 0 ? (
        <p style={{ color: '#666' }}>No posts published yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {posts.map(post => (
            <article key={post.id}>
              <div style={{ marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {CONFIDENCE_BADGE[post.confidence_level] || post.confidence_level}
                  {' · '}
                  {new Date(post.published_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'long', year: 'numeric'
                  })}
                </span>
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>
                <Link href={`/blog/${post.id}`} style={{ color: '#e5e5e5', textDecoration: 'none' }}>
                  {post.title || 'Untitled'}
                </Link>
              </h2>
              {post.meta_description && (
                <p style={{ margin: 0, color: '#888', fontSize: '14px', lineHeight: 1.6 }}>
                  {post.meta_description}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
