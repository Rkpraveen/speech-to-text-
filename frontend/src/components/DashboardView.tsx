import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { API_BASE } from '@/lib/config';
import { Mic, Wifi, LogOut, Clock } from 'lucide-react';

export default function DashboardView() {
  const { username, token, logout } = useAuth();
  const navigate = useNavigate();
  const [joinSessionId, setJoinSessionId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  // Load session history
  useEffect(() => {
    fetch(`${API_BASE}/api/sessions`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setSessions(data.sessions || []);
      })
      .catch(err => console.error('Failed to load sessions:', err))
      .finally(() => setLoadingSessions(false));
  }, [token]);

  const handleCreateSession = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/sessions/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Failed to create session');
      const data = await res.json();
      navigate(`/source?session=${data.session_id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinSessionId.trim()) {
      navigate(`/live?session=${joinSessionId.trim().toUpperCase()}`);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#e0e0e0',
        padding: '24px',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '24px 0',
            marginBottom: '48px',
            borderBottom: '1px solid #1a1a1a',
          }}
        >
          <h1 style={{ fontSize: '1rem', fontWeight: 500 }}>
            SpeechSync
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '0.75rem', color: '#555' }}>
              {username}
            </span>
            <button
              onClick={logout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'none',
                border: '1px solid #1a1a1a',
                color: '#555',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#333';
                e.currentTarget.style.color = '#999';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#1a1a1a';
                e.currentTarget.style.color = '#555';
              }}
            >
              <LogOut style={{ width: '12px', height: '12px' }} />
              Logout
            </button>
          </div>
        </header>

        {error && (
          <div
            style={{
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
              padding: '10px 12px',
              fontSize: '0.75rem',
              marginBottom: '24px',
              background: 'var(--color-error-dim)',
            }}
          >
            {error}
          </div>
        )}

        {/* Two-column cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1px',
            border: '1px solid #1a1a1a',
          }}
        >
          {/* Host a Stream */}
          <div
            style={{
              background: '#050505',
              padding: '40px 32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              borderRight: '1px solid #1a1a1a',
            }}
          >
            <Mic
              style={{
                width: '20px',
                height: '20px',
                color: 'var(--color-accent)',
                marginBottom: '20px',
              }}
            />
            <h2
              style={{
                fontSize: '0.9rem',
                fontWeight: 500,
                marginBottom: '12px',
                color: '#e0e0e0',
              }}
            >
              Host a Stream
            </h2>
            <p
              style={{
                fontSize: '0.75rem',
                color: '#555',
                lineHeight: 1.6,
                marginBottom: '32px',
              }}
            >
              Create a new session and start transcribing speech in real-time.
            </p>
            <button
              onClick={handleCreateSession}
              disabled={creating}
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--color-accent)',
                color: 'var(--color-accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                fontWeight: 500,
                padding: '12px',
                cursor: creating ? 'default' : 'pointer',
                opacity: creating ? 0.4 : 1,
                transition: 'opacity 0.15s',
                marginTop: 'auto',
              }}
            >
              {creating ? 'Creating…' : 'New Session'}
            </button>
          </div>

          {/* Join a Stream */}
          <div
            style={{
              background: '#050505',
              padding: '40px 32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <Wifi
              style={{
                width: '20px',
                height: '20px',
                color: 'var(--color-accent)',
                marginBottom: '20px',
              }}
            />
            <h2
              style={{
                fontSize: '0.9rem',
                fontWeight: 500,
                marginBottom: '12px',
                color: '#e0e0e0',
              }}
            >
              Join a Stream
            </h2>
            <p
              style={{
                fontSize: '0.75rem',
                color: '#555',
                lineHeight: 1.6,
                marginBottom: '32px',
              }}
            >
              Enter a session code to receive live transcription.
            </p>
            <form
              onSubmit={handleJoinSession}
              style={{ width: '100%', marginTop: 'auto' }}
            >
              <input
                type="text"
                placeholder="Session code"
                value={joinSessionId}
                onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
                maxLength={6}
                style={{
                  width: '100%',
                  background: '#000',
                  border: '1px solid #1a1a1a',
                  padding: '10px 12px',
                  color: '#e0e0e0',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.95rem',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                  letterSpacing: '0.15em',
                  outline: 'none',
                  marginBottom: '8px',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#1a1a1a')}
              />
              <button
                type="submit"
                disabled={joinSessionId.length < 2}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px solid #1a1a1a',
                  color: '#777',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  padding: '12px',
                  cursor: joinSessionId.length < 2 ? 'default' : 'pointer',
                  opacity: joinSessionId.length < 2 ? 0.3 : 1,
                  transition: 'opacity 0.15s, border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (joinSessionId.length >= 2) {
                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                    e.currentTarget.style.color = 'var(--color-accent)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#1a1a1a';
                  e.currentTarget.style.color = '#777';
                }}
              >
                Join
              </button>
            </form>
          </div>
        </div>
        {/* Session History */}
        <div
          style={{
            marginTop: '48px',
            borderTop: '1px solid #1a1a1a',
            paddingTop: '32px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '20px',
            }}
          >
            <Clock
              style={{ width: '16px', height: '16px', color: '#555' }}
            />
            <h2
              style={{
                fontSize: '0.85rem',
                fontWeight: 500,
                color: '#e0e0e0',
              }}
            >
              Session History
            </h2>
          </div>

          {loadingSessions ? (
            <p style={{ fontSize: '0.75rem', color: '#444' }}>Loading…</p>
          ) : sessions.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: '#444' }}>
              No sessions yet. Create your first session above.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {sessions.map((s) => (
                <div
                  key={s.session_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: '#050505',
                    border: '1px solid #1a1a1a',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = '#2a2a2a')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = '#1a1a1a')
                  }
                  onClick={() =>
                    navigate(`/live?session=${s.session_id}`)
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: '#e0e0e0',
                        letterSpacing: '0.1em',
                        fontWeight: 500,
                      }}
                    >
                      {s.session_id}
                    </span>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '2px 6px',
                        background:
                          s.status === 'active'
                            ? 'var(--color-accent-dim)'
                            : 'transparent',
                        border: `1px solid ${
                          s.status === 'active'
                            ? 'var(--color-accent)'
                            : '#1a1a1a'
                        }`,
                        color:
                          s.status === 'active'
                            ? 'var(--color-accent)'
                            : '#555',
                      }}
                    >
                      {s.status}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: '#444' }}>
                    {s.started_at
                      ? new Date(s.started_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
