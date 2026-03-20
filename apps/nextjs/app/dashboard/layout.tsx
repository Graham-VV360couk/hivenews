// apps/nextjs/app/dashboard/layout.tsx
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/packs', label: 'Content Packs' },
  { href: '/dashboard/trajectories', label: 'Trajectories' },
  { href: '/dashboard/signals', label: 'Signals' },
  { href: '/dashboard/sources', label: 'Sources' },
  { href: '/dashboard/ingest', label: 'Ingest' },
  { href: '/dashboard/monthly', label: 'Monthly Report' },
  { href: '/dashboard/connections', label: 'Connections' },
  { href: '/dashboard/submissions', label: 'Submissions' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f0f0f' }}>
      {/* Sidebar */}
      <nav style={{
        width: '200px',
        background: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        padding: '24px 0',
        flexShrink: 0,
      }}>
        <div style={{ padding: '16px 20px 20px', borderBottom: '1px solid #2a2a2a' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/NewsHive_Logo.png" alt="NewsHive" style={{ height: '36px', width: 'auto', display: 'block' }} />
        </div>
        <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
          {NAV_ITEMS.map(item => (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: 'block',
                  padding: '8px 20px',
                  color: '#ccc',
                  fontSize: '14px',
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ position: 'absolute', bottom: '20px', padding: '0 20px' }}>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                fontSize: '13px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
