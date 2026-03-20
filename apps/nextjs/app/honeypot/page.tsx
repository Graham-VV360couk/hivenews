// apps/nextjs/app/honeypot/page.tsx
// NO analytics. NO external resources. NO cookies.
// Self-contained — all assets served from same origin.
'use client';

import { useState } from 'react';

const QUESTIONS = [
  {
    id: 'proximity',
    text: 'How close are you to this information?',
    options: [
      'I work directly in this area',
      'I work adjacent to this area',
      'I heard this from someone who does',
      'I observed this indirectly',
    ],
  },
  {
    id: 'source',
    text: 'How have you come to know this?',
    options: [
      'Direct professional involvement',
      'Internal communications I have seen',
      'Industry contacts I trust',
      'A pattern I have observed over time',
      'A document or data I have access to',
    ],
  },
  {
    id: 'confidence',
    text: 'How confident are you?',
    options: [
      'Certain — I was directly involved',
      'High — I witnessed it firsthand',
      'Medium — from a trusted colleague',
      'Low — a pattern I am reading',
    ],
  },
  {
    id: 'sector',
    text: 'What broad sector are you in?',
    options: [
      'Engineering or technical',
      'Business or commercial',
      'Research or academic',
      'Investment or financial',
      'Government or regulatory',
      'Media or analyst',
      'Other',
    ],
  },
];

const DOMAIN_OPTIONS = [
  { value: 'ai', label: 'Artificial Intelligence' },
  { value: 'vr', label: 'VR / AR / Spatial Computing' },
  { value: 'vibe_coding', label: 'Vibe Coding / Developer Tools' },
  { value: 'seo', label: 'SEO / Search' },
  { value: 'cross', label: 'Cross-domain / Other' },
];

type Step = 'welcome' | 'questions' | 'submission' | 'confirm';

const BASE = {
  background: '#0f0f0f',
  color: '#e5e5e5',
  fontFamily: 'Georgia, serif',
  minHeight: '100vh',
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 20px',
} as const;

const CONTAINER = {
  maxWidth: '620px',
  width: '100%',
} as const;

const LABEL_STYLE = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '13px',
  color: '#888',
  fontFamily: 'monospace',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

export default function HoneypotPage() {
  const [step, setStep] = useState<Step>('welcome');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [existingToken, setExistingToken] = useState('');
  const [content, setContent] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  function toggleDomain(value: string) {
    setDomains(d => d.includes(value) ? d.filter(x => x !== value) : [...d, value]);
  }

  function allAnswered() {
    return QUESTIONS.every(q => answers[q.id]);
  }

  async function handleSubmit() {
    if (!content.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/honeypot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          questionnaire_answers: answers,
          domain_tags: domains,
          existing_token: existingToken.trim() || null,
          contact_method: contactMethod.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError('Submission failed. Please try again.');
        return;
      }
      setToken(data.token);
      setStep('confirm');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const h1Style = { margin: '0 0 8px', fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' };
  const h2Style = { margin: '0 0 24px', fontSize: '13px', color: '#F5A623', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const };
  const bodyStyle = { margin: '0 0 20px', fontSize: '15px', lineHeight: 1.7, color: '#aaa' };
  const btnStyle = (primary = true) => ({
    display: 'inline-block',
    padding: '12px 24px',
    background: primary ? '#F5A623' : 'none',
    color: primary ? '#0f0f0f' : '#666',
    border: primary ? 'none' : '1px solid #333',
    borderRadius: '2px',
    fontSize: '14px',
    fontWeight: primary ? 700 : 400,
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: '0.05em',
  });

  if (step === 'welcome') {
    return (
      <div style={BASE}>
        <div style={CONTAINER}>
          <div style={{ marginBottom: '48px' }}>
            <div style={{ color: '#F5A623', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', marginBottom: '16px' }}>NEWSHIVE</div>
            <h1 style={h1Style}>The Honeypot</h1>
            <p style={h2Style}>Secure anonymous submission</p>
          </div>

          <p style={bodyStyle}>
            If you have information about developments in AI, VR/AR, spatial computing,
            vibe coding, or SEO that you believe the world should know about — we want to hear it.
          </p>

          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '2px', padding: '24px', marginBottom: '32px' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#F5A623', letterSpacing: '0.1em', marginBottom: '12px' }}>HOW WE PROTECT YOU</div>
            {[
              'We do not log IP addresses.',
              'We do not store identifying information.',
              'We cannot identify you even if legally compelled.',
              'We assign you an anonymous token — not a name, not a profile.',
              'Your questionnaire answers are assessed once, then deleted.',
            ].map(line => (
              <div key={line} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                <span style={{ color: '#F5A623', fontFamily: 'monospace', flexShrink: 0 }}>—</span>
                <span style={{ fontSize: '14px', color: '#888', lineHeight: 1.5 }}>{line}</span>
              </div>
            ))}
          </div>

          <p style={{ ...bodyStyle, fontSize: '13px', color: '#555' }}>
            This page is accessible via Tor for maximum anonymity.
            If you are using a standard browser, consider switching to Tor Browser for additional protection.
          </p>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnStyle()} onClick={() => setStep('questions')}>
              BEGIN SUBMISSION →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'questions') {
    return (
      <div style={BASE}>
        <div style={CONTAINER}>
          <button onClick={() => setStep('welcome')} style={{ ...btnStyle(false), marginBottom: '32px', padding: '0', border: 'none', fontSize: '13px' }}>
            ← Back
          </button>

          <h1 style={h1Style}>Context</h1>
          <p style={{ ...h2Style }}>1 of 2 — Your answers help us assess this information. They are not stored.</p>

          {QUESTIONS.map(q => (
            <div key={q.id} style={{ marginBottom: '28px' }}>
              <label style={{ ...LABEL_STYLE }}>{q.text}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {q.options.map(opt => (
                  <label key={opt} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={q.id}
                      value={opt}
                      checked={answers[q.id] === opt}
                      onChange={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                      style={{ marginTop: '2px', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '14px', color: answers[q.id] === opt ? '#e5e5e5' : '#888', lineHeight: 1.4 }}>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: '28px' }}>
            <label style={LABEL_STYLE}>Have you submitted to NewsHive before? (optional)</label>
            <input
              type="text"
              value={existingToken}
              onChange={e => setExistingToken(e.target.value)}
              placeholder="Your token (e.g. SCOUT-7734)"
              style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5', borderRadius: '2px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'monospace' }}
            />
          </div>

          <button
            style={{ ...btnStyle(), opacity: allAnswered() ? 1 : 0.4, cursor: allAnswered() ? 'pointer' : 'not-allowed' }}
            onClick={() => allAnswered() && setStep('submission')}
            disabled={!allAnswered()}
          >
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  if (step === 'submission') {
    return (
      <div style={BASE}>
        <div style={CONTAINER}>
          <button onClick={() => setStep('questions')} style={{ ...btnStyle(false), marginBottom: '32px', padding: '0', border: 'none', fontSize: '13px' }}>
            ← Back
          </button>

          <h1 style={h1Style}>Your submission</h1>
          <p style={{ ...h2Style }}>2 of 2 — Tell us what you know</p>

          <div style={{ marginBottom: '20px' }}>
            <label style={LABEL_STYLE}>What are you reporting? Include context and why you believe it to be true.</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={10}
              placeholder="What is happening or about to happen. Why you believe this. What you think it means."
              style={{ width: '100%', padding: '12px', background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5', borderRadius: '2px', fontSize: '14px', lineHeight: 1.6, boxSizing: 'border-box' as const, resize: 'vertical', fontFamily: 'Georgia, serif' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={LABEL_STYLE}>Domain (select all that apply)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {DOMAIN_OPTIONS.map(d => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDomain(d.value)}
                  style={{
                    padding: '6px 12px',
                    background: domains.includes(d.value) ? '#F5A623' : '#1a1a1a',
                    color: domains.includes(d.value) ? '#0f0f0f' : '#888',
                    border: `1px solid ${domains.includes(d.value) ? '#F5A623' : '#333'}`,
                    borderRadius: '2px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label style={LABEL_STYLE}>Secure contact method (optional)</label>
            <input
              type="text"
              value={contactMethod}
              onChange={e => setContactMethod(e.target.value)}
              placeholder="Signal number or ProtonMail address — for clarifying questions only"
              style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5', borderRadius: '2px', fontSize: '14px', boxSizing: 'border-box' as const }}
            />
          </div>

          {error && <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '16px' }}>{error}</p>}

          <button
            style={{ ...btnStyle(), opacity: content.trim() && !submitting ? 1 : 0.4, cursor: content.trim() && !submitting ? 'pointer' : 'not-allowed' }}
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
          >
            {submitting ? 'SUBMITTING…' : 'SUBMIT SECURELY →'}
          </button>
        </div>
      </div>
    );
  }

  // Confirm step — token shown once
  return (
    <div style={BASE}>
      <div style={CONTAINER}>
        <div style={{ marginBottom: '32px' }}>
          <div style={{ color: '#22c55e', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', marginBottom: '8px' }}>SUBMISSION RECEIVED</div>
          <h1 style={h1Style}>Your anonymous token</h1>
        </div>

        <div style={{ background: '#0a1f0a', border: '1px solid #22c55e', borderRadius: '2px', padding: '32px', textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '32px', fontWeight: 700, color: '#22c55e', letterSpacing: '0.1em' }}>
            {token}
          </div>
        </div>

        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '2px', padding: '20px', marginBottom: '32px' }}>
          {[
            'Save this token. It is the only link between this and future submissions.',
            'We do not store this token anywhere you can retrieve it.',
            'This page will not be accessible again. We cannot recover your token.',
            'You will not be contacted unless you provided a secure contact method.',
          ].map(line => (
            <div key={line} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <span style={{ color: '#F5A623', fontFamily: 'monospace', flexShrink: 0 }}>—</span>
              <span style={{ fontSize: '14px', color: '#888', lineHeight: 1.5 }}>{line}</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.7 }}>
          We will assess your submission against current intelligence.
          If it enters our system, it may appear as a Pinch of Salt signal — unverified, but flagged as worth watching.
          If corroborated by independent sources, it may be elevated.
          Thank you for trusting us with this.
        </p>
      </div>
    </div>
  );
}
