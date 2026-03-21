'use client';
// apps/nextjs/app/HomePageView.tsx

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface Story {
  id: string;
  name: string;
  description: string;
  domain_tags: string[];
  confidence_score: number;
  confidence_direction: string;
  status: string;
  last_updated_at: string | null;
  url?: string | null;
}

type Tier = 'alert' | 'confirmed' | 'possible' | 'salt';

function getTier(story: Story): Tier {
  if (story.confidence_direction === 'rising' && story.confidence_score >= 8.0) return 'alert';
  if (story.confidence_score >= 7.0) return 'confirmed';
  if (story.confidence_score >= 4.5) return 'possible';
  return 'salt';
}

const TIER_CONFIG = {
  alert: {
    label: 'ALERT',
    borderColor: '#c0392b',
    badgeBg: '#c0392b',
    badgeText: '#fff',
    headerColor: '#e74c3c',
    glowColor: 'rgba(192, 57, 43, 0.12)',
    sectionTitle: '⚡ Breaking Alert',
  },
  confirmed: {
    label: 'CONFIRMED',
    borderColor: '#1a7a45',
    badgeBg: '#1a7a45',
    badgeText: '#d4f5e2',
    headerColor: '#22c55e',
    glowColor: 'rgba(26, 122, 69, 0.08)',
    sectionTitle: 'Confirmed',
  },
  possible: {
    label: 'POSSIBLE',
    borderColor: '#b07300',
    badgeBg: 'transparent',
    badgeText: '#e8950a',
    headerColor: '#e8950a',
    glowColor: 'rgba(232, 149, 10, 0.06)',
    sectionTitle: 'Possible',
  },
  salt: {
    label: 'PINCH OF SALT',
    borderColor: '#2a2d3a',
    badgeBg: 'transparent',
    badgeText: '#4a4d5e',
    headerColor: '#4a4d5e',
    glowColor: 'transparent',
    sectionTitle: 'Pinch of Salt',
  },
} as const;

const DOMAIN_LABELS: Record<string, string> = {
  ai: 'AI',
  vr: 'VR / AR',
  seo: 'SEO',
  vibe_coding: 'Vibe Coding',
  cross: 'Cross-Domain',
};

const DIR_SYMBOL: Record<string, string> = {
  rising: '↑',
  falling: '↓',
  stable: '—',
};

// Hex SVG pattern as data URI
const HEX_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpolygon points='28,2 54,16 54,44 28,58 2,44 2,16' fill='none' stroke='%231a1d28' stroke-width='1'/%3E%3Cpolygon points='28,52 54,66 54,94 28,108 2,94 2,66' fill='none' stroke='%231a1d28' stroke-width='1'/%3E%3C/svg%3E")`;

function FadeCard({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(18px)',
        transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function StoryCard({ story, delay }: { story: Story; delay: number }) {
  const tier = getTier(story);
  const cfg = TIER_CONFIG[tier];
  const [hovered, setHovered] = useState(false);

  return (
    <FadeCard delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          gap: '20px',
          background: hovered
            ? `linear-gradient(135deg, #10111a 0%, #0e0f17 100%)`
            : `linear-gradient(135deg, #0c0d14 0%, #0a0b12 100%)`,
          border: `1px solid ${hovered ? '#252836' : '#191b27'}`,
          borderLeft: `3px solid ${cfg.borderColor}`,
          borderRadius: '4px',
          padding: '20px 24px',
          boxShadow: hovered
            ? `0 4px 32px ${cfg.glowColor}, 0 2px 8px rgba(0,0,0,0.4)`
            : `0 2px 12px rgba(0,0,0,0.2)`,
          transition: 'all 0.2s ease',
          cursor: 'default',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Badge row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.18em',
              padding: '3px 8px',
              background: cfg.badgeBg,
              color: cfg.badgeText,
              border: `1px solid ${cfg.borderColor}`,
              borderRadius: '2px',
            }}>
              {cfg.label}
            </span>
            {(story.domain_tags || []).map(tag => (
              <span key={tag} style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '9px',
                letterSpacing: '0.1em',
                color: '#363848',
                padding: '2px 6px',
                border: '1px solid #1e2030',
                borderRadius: '2px',
              }}>
                {DOMAIN_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>

          {/* Title */}
          <h3 style={{ margin: '0 0 8px', fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '20px', fontWeight: 600, lineHeight: 1.3 }}>
            {story.url ? (
              <a href={story.url} target="_blank" rel="noopener noreferrer" style={{ color: hovered ? '#f0f1f8' : '#d8dae8', textDecoration: 'none', transition: 'color 0.2s ease' }}>
                {story.name}
              </a>
            ) : (
              <Link href={`/stories/${story.id}`} style={{ color: hovered ? '#f0f1f8' : '#d8dae8', textDecoration: 'none', transition: 'color 0.2s ease' }}>
                {story.name}
              </Link>
            )}
          </h3>

          {/* Description */}
          <p style={{
            margin: 0,
            fontFamily: "'Lora', Georgia, serif",
            fontSize: '13px',
            color: '#525669',
            lineHeight: 1.65,
          }}>
            {story.description}
          </p>
        </div>

        {/* Score */}
        <div style={{ flexShrink: 0, textAlign: 'right', paddingTop: '2px' }}>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '28px',
            fontWeight: 700,
            color: '#e8950a',
            lineHeight: 1,
            letterSpacing: '-1px',
          }}>
            {story.confidence_score?.toFixed(1) ?? '—'}
          </div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '10px',
            color: '#363848',
            marginTop: '4px',
            letterSpacing: '0.05em',
          }}>
            {DIR_SYMBOL[story.confidence_direction] ?? ''} /10
          </div>
        </div>
      </div>
    </FadeCard>
  );
}

function Section({ tier, stories }: { tier: Tier; stories: Story[] }) {
  if (stories.length === 0) return null;
  const cfg = TIER_CONFIG[tier];

  return (
    <div style={{ marginBottom: '52px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '20px',
      }}>
        {tier === 'alert' && (
          <span style={{
            display: 'inline-block',
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: '#e74c3c',
            boxShadow: '0 0 8px rgba(231, 76, 60, 0.8)',
            animation: 'pulse-dot 1.4s ease-in-out infinite',
          }} />
        )}
        <span style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: cfg.headerColor,
        }}>
          {cfg.sectionTitle}
        </span>
        <span style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          color: '#2a2d3a',
          letterSpacing: '0.05em',
        }}>
          {stories.length} {stories.length === 1 ? 'story' : 'stories'}
        </span>
        <div style={{ flex: 1, height: '1px', background: `linear-gradient(to right, ${cfg.borderColor}40, transparent)` }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {stories.map((story, i) => (
          <StoryCard key={story.id} story={story} delay={i * 80} />
        ))}
      </div>
    </div>
  );
}

export function HomePageView({ stories }: { stories: Story[] }) {
  const alert = stories.filter(s => getTier(s) === 'alert');
  const confirmed = stories.filter(s => getTier(s) === 'confirmed');
  const possible = stories.filter(s => getTier(s) === 'possible');
  const salt = stories.filter(s => getTier(s) === 'salt');

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;1,400&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(231, 76, 60, 0.8); }
          50% { opacity: 0.4; box-shadow: 0 0 4px rgba(231, 76, 60, 0.3); }
        }

        @keyframes fade-hero {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        .home-root {
          min-height: 100vh;
          background-color: #07080c;
          background-image: ${HEX_BG};
          background-size: 56px 100px;
          color: #d8dae8;
          font-family: 'Lora', Georgia, serif;
        }

        .story-card-hover:hover {
          transform: translateX(2px);
        }

        .nav-link {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          color: #3a3d52;
          text-decoration: none;
          transition: color 0.2s ease;
        }
        .nav-link:hover { color: #8a8da8; }

        .admin-btn {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.1em;
          padding: 8px 16px;
          background: transparent;
          border: 1px solid #252836;
          color: #5a5e73;
          border-radius: 2px;
          text-decoration: none;
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .admin-btn:hover {
          border-color: #e8950a;
          color: #e8950a;
          background: rgba(232, 149, 10, 0.04);
        }

        .hero-animate {
          animation: fade-hero 0.9s ease both;
        }
        .hero-animate-delay {
          animation: fade-hero 0.9s ease 0.2s both;
        }
        .hero-animate-delay-2 {
          animation: fade-hero 0.9s ease 0.4s both;
        }

        .ticker-inner {
          display: inline-flex;
          gap: 0;
          animation: ticker-scroll 30s linear infinite;
          white-space: nowrap;
        }
        .ticker-inner:hover { animation-play-state: paused; }
      `}</style>

      <div className="home-root">
        {/* Ticker bar */}
        <div style={{
          background: '#0a0b10',
          borderBottom: '1px solid #12141f',
          overflow: 'hidden',
          height: '28px',
          display: 'flex',
          alignItems: 'center',
        }}>
          <div style={{
            background: '#e8950a',
            padding: '0 12px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            marginRight: '16px',
          }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '9px', fontWeight: 700, letterSpacing: '0.2em', color: '#07080c' }}>
              LIVE
            </span>
          </div>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="ticker-inner">
              {[
                'Signals tracked across 5 intelligence domains',
                '·',
                'AI · VR / AR · SEO · Vibe Coding · Cross-Domain',
                '·',
                'Confidence-labelled intelligence — not opinions',
                '·',
                'Updated as stories develop',
                '·',
                'Signals tracked across 5 intelligence domains',
                '·',
                'AI · VR / AR · SEO · Vibe Coding · Cross-Domain',
                '·',
                'Confidence-labelled intelligence — not opinions',
                '·',
                'Updated as stories develop',
                '·',
              ].map((item, i) => (
                <span key={i} style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '10px',
                  color: item === '·' ? '#2a2d3a' : '#3a3d52',
                  letterSpacing: '0.05em',
                  padding: '0 16px',
                }}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Header */}
        <header style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(7, 8, 12, 0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #12141f',
          padding: '0 40px',
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <a href="https://newshive.geekybee.net/" style={{ display: 'flex' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/NewsHive_Logo.png" alt="NewsHive" style={{ height: '40px', width: 'auto' }} />
            </a>
            <span style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '9px',
              letterSpacing: '0.25em',
              color: '#252836',
              textTransform: 'uppercase',
            }}>
              Intelligence Feed
            </span>
          </div>

          <nav style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
            <a href="#intelligence" className="nav-link">Intelligence</a>
            <a href="#deep-analysis" className="nav-link">Deep Analysis</a>
            <Link href="/dashboard" className="admin-btn">
              Analyst Portal →
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <div id="intelligence" style={{
          borderBottom: '1px solid #10111a',
          padding: '72px 40px 64px',
          maxWidth: '1100px',
          margin: '0 auto',
        }}>
          <div className="hero-animate" style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '10px',
            letterSpacing: '0.3em',
            color: '#e8950a',
            textTransform: 'uppercase',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#e8950a',
              animation: 'pulse-dot 2s ease-in-out infinite',
            }} />
            Live Intelligence Feed
          </div>

          <h1 className="hero-animate-delay" style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 'clamp(48px, 7vw, 88px)',
            fontWeight: 700,
            fontStyle: 'italic',
            color: '#e6e8f0',
            margin: '0 0 20px',
            lineHeight: 1.05,
            letterSpacing: '-1px',
            maxWidth: '800px',
          }}>
            Evolving<br />
            <span style={{ color: 'transparent', WebkitTextStroke: '1px #2a2d3a' }}>
              Stories
            </span>
          </h1>

          <p className="hero-animate-delay-2" style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: '16px',
            color: '#4a4d62',
            maxWidth: '520px',
            lineHeight: 1.7,
            margin: '0 0 36px',
            fontStyle: 'italic',
          }}>
            Signals tracked across emerging technology — with honest confidence labels
            so you know what demands action and what deserves scepticism.
          </p>

          {/* Legend */}
          <div className="hero-animate-delay-2" style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            {([
              { tier: 'alert', label: '⚡ Alert', desc: 'Breaking, high confidence' },
              { tier: 'confirmed', label: '✓ Confirmed', desc: 'Independently verified' },
              { tier: 'possible', label: '~ Possible', desc: 'Growing evidence' },
              { tier: 'salt', label: '⚠ Pinch of Salt', desc: 'Early signal, unverified' },
            ] as const).map(({ tier, label, desc }) => {
              const cfg = TIER_CONFIG[tier];
              return (
                <div
                  key={tier}
                  title={desc}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 10px',
                    border: `1px solid ${cfg.borderColor}`,
                    borderRadius: '2px',
                    cursor: 'default',
                  }}
                >
                  <span style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    color: cfg.badgeBg !== 'transparent' ? cfg.badgeText : cfg.badgeText,
                  }}>
                    {label}
                  </span>
                </div>
              );
            })}
            <span style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '9px',
              color: '#252836',
              letterSpacing: '0.05em',
              marginLeft: '4px',
            }}>
              Hover badge for meaning
            </span>
          </div>
        </div>

        {/* Main content */}
        <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '56px 40px 80px' }}>
          {stories.length === 0 ? (
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                letterSpacing: '0.25em',
                color: '#1e2030',
                marginBottom: '16px',
              }}>
                NO ACTIVE SIGNALS
              </div>
              <p style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: '22px',
                fontStyle: 'italic',
                color: '#252836',
                margin: 0,
              }}>
                The hive is watching. Check back soon.
              </p>
            </div>
          ) : (
            <>
              <Section tier="alert" stories={alert} />
              <Section tier="confirmed" stories={confirmed} />
              <Section tier="possible" stories={possible} />
              <Section tier="salt" stories={salt} />
            </>
          )}

          {/* Deep Analysis */}
          <div id="deep-analysis">
            <FadeCard>
              <div style={{
                marginTop: '32px',
                position: 'relative',
                overflow: 'hidden',
                background: 'linear-gradient(135deg, #0c0d14 0%, #0a0b10 100%)',
                border: '1px solid #1a1c28',
                borderRadius: '4px',
                padding: '48px',
              }}>
                {/* Diagonal restricted watermark */}
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  right: '-30px',
                  transform: 'rotate(35deg)',
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.4em',
                  color: '#141620',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}>
                  RESTRICTED · RESTRICTED · RESTRICTED · RESTRICTED
                </div>

                <div style={{ display: 'flex', gap: '48px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: '280px' }}>
                    <div style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '9px',
                      fontWeight: 700,
                      letterSpacing: '0.3em',
                      color: '#e8950a',
                      textTransform: 'uppercase',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}>
                      <span style={{ display: 'inline-block', width: '20px', height: '1px', background: '#e8950a' }} />
                      Coming Soon
                    </div>

                    <h2 style={{
                      fontFamily: "'Cormorant Garamond', Georgia, serif",
                      fontSize: '36px',
                      fontWeight: 700,
                      fontStyle: 'italic',
                      color: '#d8dae8',
                      margin: '0 0 16px',
                      lineHeight: 1.1,
                    }}>
                      Deep Analysis
                    </h2>

                    <p style={{
                      fontFamily: "'Lora', Georgia, serif",
                      fontSize: '14px',
                      color: '#3a3d52',
                      lineHeight: 1.75,
                      margin: '0 0 24px',
                      fontStyle: 'italic',
                      maxWidth: '440px',
                    }}>
                      The uncut picture — full signal audit trails, source corroboration chains,
                      trajectory modelling, and early-access briefings for operators who
                      can&apos;t afford to be wrong.
                    </p>

                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {[
                        'Full source & confidence audit trail',
                        'HiveScore breakdowns per story',
                        'Monthly HiveReport — PDF + audio briefing',
                        'Priority alert notifications',
                        'HiveAPI access',
                        'Trajectory modelling & scenario planning',
                      ].map(item => (
                        <li key={item} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                        }}>
                          <span style={{
                            fontFamily: "'Space Mono', monospace",
                            fontSize: '10px',
                            color: '#e8950a',
                            marginTop: '2px',
                            flexShrink: 0,
                          }}>›</span>
                          <span style={{
                            fontFamily: "'Lora', Georgia, serif",
                            fontSize: '13px',
                            color: '#3a3d52',
                          }}>
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ flexShrink: 0, paddingTop: '8px' }}>
                    <div style={{
                      border: '1px solid #1e2030',
                      borderRadius: '3px',
                      padding: '32px',
                      textAlign: 'center',
                      minWidth: '220px',
                    }}>
                      <div style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '9px',
                        letterSpacing: '0.2em',
                        color: '#252836',
                        marginBottom: '12px',
                      }}>
                        ACCESS TIER
                      </div>
                      <div style={{
                        fontFamily: "'Cormorant Garamond', Georgia, serif",
                        fontSize: '42px',
                        fontWeight: 700,
                        color: '#e8950a',
                        lineHeight: 1,
                        marginBottom: '4px',
                      }}>
                        Pro
                      </div>
                      <div style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '10px',
                        color: '#252836',
                        marginBottom: '24px',
                        letterSpacing: '0.05em',
                      }}>
                        Pricing TBD
                      </div>

                      <button
                        disabled
                        style={{
                          width: '100%',
                          padding: '12px 20px',
                          background: 'transparent',
                          border: '1px solid #252836',
                          color: '#2a2d3a',
                          borderRadius: '2px',
                          fontFamily: "'Space Mono', monospace",
                          fontSize: '10px',
                          letterSpacing: '0.15em',
                          cursor: 'not-allowed',
                        }}
                      >
                        REGISTER INTEREST
                      </button>
                      <div style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '9px',
                        color: '#1e2030',
                        marginTop: '8px',
                        letterSpacing: '0.1em',
                      }}>
                        NOT YET OPEN
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </FadeCard>
          </div>
        </main>

        {/* Footer */}
        <footer style={{
          borderTop: '1px solid #10111a',
          padding: '24px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <span style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '9px',
            color: '#1e2030',
            letterSpacing: '0.15em',
          }}>
            NEWSHIVE · INTELLIGENCE TRACKING · CC BY 4.0
          </span>
          <span style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '9px',
            color: '#1e2030',
            letterSpacing: '0.1em',
          }}>
            AI · VR/AR · SEO · VIBE CODING · CROSS-DOMAIN
          </span>
        </footer>
      </div>
    </>
  );
}
