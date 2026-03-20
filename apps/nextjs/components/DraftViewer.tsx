// apps/nextjs/components/DraftViewer.tsx
'use client';

import { useState } from 'react';

interface Draft {
  id: string;
  platform: string;
  draft_text: string;
  draft_data: string;
  approved: boolean;
  final_text: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  blog: 'Blog Post',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X / Twitter',
  hivecast: 'HiveCast Script',
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function DraftViewer({ draft, packId, onApproved }: {
  draft: Draft;
  packId: string;
  onApproved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.final_text || draft.draft_text);
  const [approved, setApproved] = useState(draft.approved);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const displayText = draft.final_text || draft.draft_text;
  const label = PLATFORM_LABELS[draft.platform] || draft.platform;

  async function handleApprove(finalText?: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/dashboard/api/packs/${packId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: draft.platform,
          final_text: finalText ?? draft.draft_text,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setApproved(true);
      setEditing(false);
      onApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      background: '#1a1a1a',
      border: `1px solid ${approved ? '#22c55e' : '#2a2a2a'}`,
      borderRadius: '6px',
      marginBottom: '16px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #2a2a2a',
        background: approved ? '#0a1f0a' : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>{label}</span>
          <span style={{ fontSize: '12px', color: '#555' }}>{wordCount(displayText)} words</span>
          {approved && (
            <span style={{ fontSize: '11px', color: '#22c55e', background: '#22c55e20', padding: '2px 8px', borderRadius: '999px' }}>
              Approved
            </span>
          )}
        </div>
        {!approved && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setEditing(!editing)}
              disabled={loading}
              style={{
                padding: '5px 12px',
                background: 'none',
                border: '1px solid #2a2a2a',
                color: '#ccc',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button
              onClick={() => editing ? handleApprove(editText) : handleApprove()}
              disabled={loading}
              style={{
                padding: '5px 12px',
                background: '#F5A623',
                border: 'none',
                color: '#0f0f0f',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '…' : (editing ? 'Save & Approve' : 'Approve')}
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '16px' }}>
        {editing ? (
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            style={{
              width: '100%',
              minHeight: '200px',
              background: '#0f0f0f',
              border: '1px solid #2a2a2a',
              borderRadius: '4px',
              color: '#e5e5e5',
              fontSize: '13px',
              padding: '10px',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              resize: 'vertical',
            }}
          />
        ) : (
          <pre style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#ccc',
            maxHeight: '300px',
            overflowY: 'auto',
          }}>
            {displayText}
          </pre>
        )}
        {error && (
          <p style={{ margin: '8px 0 0', color: '#ef4444', fontSize: '12px' }}>{error}</p>
        )}
      </div>
    </div>
  );
}
