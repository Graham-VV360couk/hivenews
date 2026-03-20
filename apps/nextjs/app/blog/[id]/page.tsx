// apps/nextjs/app/blog/[id]/page.tsx
import { getDb } from '@/lib/db';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

interface BlogPost {
  id: string;
  pack_type: string;
  published_at: string;
  confidence_level: string;
  domain_tags: string[] | null;
  title: string;
  content: string;
  meta_description: string;
}

async function getPost(id: string): Promise<BlogPost | null> {
  const sql = getDb();
  const rows = await sql<BlogPost[]>`
    SELECT
      cp.id,
      cp.pack_type,
      cp.published_at,
      cp.confidence_level,
      cl.domain_tags,
      cd.draft_data->>'title'            AS title,
      cd.draft_data->>'content'          AS content,
      cd.draft_data->>'meta_description' AS meta_description
    FROM content_packs cp
    JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
    LEFT JOIN clusters cl ON cl.id = cp.cluster_id
    WHERE cp.id = ${id}
      AND cp.status = 'published'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const post = await getPost(params.id);
  if (!post) return { title: 'Not Found' };
  return {
    title: `${post.title} — NewsHive`,
    description: post.meta_description,
  };
}

const CONFIDENCE_BADGE: Record<string, string> = {
  confirmed: '🔴 CONFIRMED',
  developing: '🟡 DEVELOPING',
  pinch_of_salt: '🧂 PINCH OF SALT',
};

export default async function BlogPostPage({ params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) notFound();

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 20px' }}>
      <Link href="/blog" style={{ fontSize: '13px', color: '#666', display: 'inline-block', marginBottom: '24px' }}>
        ← All posts
      </Link>

      <header style={{ marginBottom: '32px' }}>
        <div style={{ marginBottom: '10px', fontSize: '12px', color: '#888' }}>
          {CONFIDENCE_BADGE[post.confidence_level] || post.confidence_level}
          {' · '}
          {new Date(post.published_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
          })}
          {post.domain_tags && post.domain_tags.length > 0 && (
            <> · {post.domain_tags.join(', ')}</>
          )}
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: '28px', fontWeight: 700, lineHeight: 1.2 }}>
          {post.title}
        </h1>
        {post.meta_description && (
          <p style={{ margin: 0, fontSize: '16px', color: '#999', lineHeight: 1.6 }}>
            {post.meta_description}
          </p>
        )}
      </header>

      <div style={{ lineHeight: 1.8, fontSize: '16px', color: '#ccc' }}>
        {(post.content || '').split('\n').map((para, i) => (
          para.trim() ? (
            <p key={i} style={{ margin: '0 0 20px' }}>{para}</p>
          ) : null
        ))}
      </div>

      <footer style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid #2a2a2a', fontSize: '13px', color: '#555' }}>
        Intelligence by <a href="/" style={{ color: '#F5A623' }}>NewsHive</a> (newshive.geekybee.net).
        Please credit when republishing. CC BY 4.0.
      </footer>
    </div>
  );
}
