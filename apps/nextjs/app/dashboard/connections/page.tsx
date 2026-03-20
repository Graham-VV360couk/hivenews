'use client';
// apps/nextjs/app/dashboard/connections/page.tsx

import { useEffect, useState } from 'react';

interface PlatformStatus {
  connected: boolean;
  detail: string | null;
  note?: string;
}

interface Connections {
  x: PlatformStatus;
  facebook: PlatformStatus;
  instagram: PlatformStatus;
  linkedin: PlatformStatus;
}

const SETUP_GUIDE: Record<string, {
  label: string;
  icon: string;
  vars: { name: string; description: string }[];
  steps: string[];
  url: string;
  urlLabel: string;
  note?: string;
}> = {
  x: {
    label: 'X (Twitter)',
    icon: '𝕏',
    vars: [
      { name: 'X_API_KEY', description: 'API Key (Consumer Key)' },
      { name: 'X_API_SECRET', description: 'API Key Secret (Consumer Secret)' },
      { name: 'X_ACCESS_TOKEN', description: 'Access Token (for posting account)' },
      { name: 'X_ACCESS_SECRET', description: 'Access Token Secret' },
    ],
    steps: [
      'Go to developer.twitter.com — sign in with the company X account',
      'Create a Project, then create an App inside it',
      'In App Settings → set App Permissions to "Read and Write"',
      'In "Keys and Tokens" tab → generate all four tokens listed below',
      'Add all four as environment variables in Coolify (Python service)',
    ],
    url: 'https://developer.twitter.com',
    urlLabel: 'developer.twitter.com',
    note: 'Free tier: 50 posts/month. Basic tier ($100/mo): 100 posts/day.',
  },
  facebook: {
    label: 'Facebook Page',
    icon: 'f',
    vars: [
      { name: 'FACEBOOK_PAGE_ACCESS_TOKEN', description: 'Permanent Page Access Token (never expires)' },
      { name: 'FACEBOOK_PAGE_ID', description: 'Your Facebook Page numeric ID' },
    ],
    steps: [
      'Go to developers.facebook.com → Create App → type: Business',
      'Add product "Pages API" to your app',
      'In Graph API Explorer: select your App, select your Page, request pages_manage_posts + pages_read_engagement',
      'Generate Access Token → exchange for long-lived token → then get permanent Page token via GET /me/accounts',
      'Your Page ID is in the page About section or URL',
      'Add both env vars to Coolify (Python service)',
    ],
    url: 'https://developers.facebook.com',
    urlLabel: 'developers.facebook.com',
  },
  instagram: {
    label: 'Instagram Business',
    icon: '◈',
    vars: [
      { name: 'INSTAGRAM_USER_ID', description: 'Instagram Business Account ID' },
      { name: 'FACEBOOK_PAGE_ACCESS_TOKEN', description: 'Same token as Facebook (shared app)' },
    ],
    steps: [
      'Your Instagram account must be a Professional/Business account',
      'Connect it to your Facebook Page in Instagram Settings → Account → Linked Accounts',
      'Use the same Meta developer app as Facebook',
      'In Graph API Explorer: GET /me/accounts → find your page → GET /{page_id}?fields=instagram_business_account',
      'The instagram_business_account.id is your INSTAGRAM_USER_ID',
    ],
    url: 'https://developers.facebook.com',
    urlLabel: 'developers.facebook.com',
    note: 'Instagram Graph API requires an image or video URL — text-only posts are not supported. Image posts will be enabled in a future phase.',
  },
  linkedin: {
    label: 'LinkedIn Company Page',
    icon: 'in',
    vars: [
      { name: 'LINKEDIN_ACCESS_TOKEN', description: 'OAuth 2.0 Access Token' },
      { name: 'LINKEDIN_ORG_ID', description: 'Company page numeric ID (from page URL)' },
    ],
    steps: [
      'Go to linkedin.com/developers → Create App',
      'Associate the app with your LinkedIn Company Page',
      'Under Products tab → request "Share on LinkedIn" and "Marketing Developer Platform"',
      'Use OAuth 2.0 to generate an access token with w_organization_shares scope',
      'Your Organisation ID is in the Company Page URL: linkedin.com/company/YOUR_ORG_ID/',
      'Add both env vars to Coolify (Python service)',
    ],
    url: 'https://www.linkedin.com/developers',
    urlLabel: 'linkedin.com/developers',
    note: 'LinkedIn access tokens expire after 60 days — you\'ll need to refresh them periodically.',
  },
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connections | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/dashboard/api/connections')
      .then(r => r.json())
      .then(data => { setConnections(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Social Connections</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          Configure credentials to enable publishing to social platforms. All credentials are stored as environment variables in Coolify — never in the database.
        </p>
      </div>

      {loading ? (
        <div style={{ color: '#555' }}>Checking connections…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {Object.entries(SETUP_GUIDE).map(([platform, guide]) => {
            const status = connections?.[platform as keyof Connections];
            const isConnected = status?.connected ?? false;
            const isOpen = expanded === platform;

            return (
              <div
                key={platform}
                style={{
                  background: '#1a1a1a',
                  border: `1px solid ${isConnected ? '#1a3a1a' : '#2a2a2a'}`,
                  borderRadius: '6px',
                  overflow: 'hidden',
                }}
              >
                {/* Header row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : platform)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 20px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: '36px', height: '36px',
                    background: '#111', border: '1px solid #2a2a2a',
                    borderRadius: '4px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '14px', fontWeight: 700,
                    color: '#888', flexShrink: 0,
                  }}>
                    {guide.icon}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '15px', color: '#e5e5e5' }}>
                      {guide.label}
                    </div>
                    {status?.detail && (
                      <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
                        {status.detail}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '4px 10px', borderRadius: '3px',
                      background: isConnected ? '#0f2a0f' : '#1a1a1a',
                      border: `1px solid ${isConnected ? '#1a4a1a' : '#333'}`,
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: isConnected ? '#22c55e' : '#444',
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: '11px', fontWeight: 600,
                        color: isConnected ? '#22c55e' : '#444',
                        letterSpacing: '0.05em',
                      }}>
                        {isConnected ? 'CONNECTED' : 'NOT SET'}
                      </span>
                    </div>
                    <span style={{ color: '#444', fontSize: '14px' }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded setup guide */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid #222', padding: '20px' }}>
                    {guide.note && (
                      <div style={{
                        marginBottom: '16px', padding: '10px 14px',
                        background: '#111', border: '1px solid #2a2a1a',
                        borderRadius: '4px', fontSize: '13px', color: '#888',
                      }}>
                        ⚠ {guide.note}
                      </div>
                    )}

                    {/* Steps */}
                    <h3 style={{ margin: '0 0 10px', fontSize: '12px', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Setup steps
                    </h3>
                    <ol style={{ margin: '0 0 20px', padding: '0 0 0 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {guide.steps.map((step, i) => (
                        <li key={i} style={{ fontSize: '13px', color: '#888', lineHeight: 1.5 }}>
                          {step}
                        </li>
                      ))}
                    </ol>

                    {/* Developer portal link */}
                    <div style={{ marginBottom: '20px' }}>
                      <span style={{ fontSize: '12px', color: '#555' }}>Developer portal: </span>
                      <span style={{ fontSize: '12px', color: '#F5A623' }}>{guide.urlLabel}</span>
                    </div>

                    {/* Env vars to add */}
                    <h3 style={{ margin: '0 0 10px', fontSize: '12px', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Add these to Coolify → Python service → Environment Variables
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {guide.vars.map(v => (
                        <div
                          key={v.name}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '10px 14px', background: '#111',
                            border: '1px solid #222', borderRadius: '4px',
                          }}
                        >
                          <code style={{
                            fontSize: '12px', fontFamily: 'monospace',
                            color: '#F5A623', flexShrink: 0,
                          }}>
                            {v.name}
                          </code>
                          <span style={{ fontSize: '12px', color: '#555' }}>
                            {v.description}
                          </span>
                          {v.name.includes('TOKEN') && (
                            <span style={{
                              marginLeft: 'auto', fontSize: '10px',
                              color: '#333', flexShrink: 0,
                            }}>
                              ✓ Enable "Is Literal?" in Coolify
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Reminder about Is Literal */}
                    <p style={{ marginTop: '12px', fontSize: '12px', color: '#444', fontStyle: 'italic' }}>
                      Important: for any token containing <code style={{ color: '#555' }}>$</code> characters, enable the "Is Literal?" toggle in Coolify to prevent variable substitution corrupting the value.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '24px', padding: '16px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '4px' }}>
        <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#555', fontWeight: 600 }}>After adding credentials</p>
        <p style={{ margin: 0, fontSize: '12px', color: '#444', lineHeight: 1.7 }}>
          Restart the Python service in Coolify to load the new env vars. Then go to a Content Pack,
          approve the drafts for each platform, and click Publish — the system will post to all connected platforms automatically.
        </p>
      </div>
    </div>
  );
}
