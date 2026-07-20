import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { API_BASE } from '@/lib/config';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterView() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Register
      const regRes = await fetch(`${API_BASE}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!regRes.ok) {
        const errData = await regRes.json();
        throw new Error(errData.detail || 'Failed to register');
      }

      // 2. Login immediately after
      const loginRes = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      });

      if (!loginRes.ok) throw new Error('Registered, but failed to log in');

      const data = await loginRes.json();
      login(data.access_token, data.username);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        padding: '24px',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          background: '#050505',
          border: '1px solid #1a1a1a',
          padding: '40px',
        }}
      >
        <h1
          style={{
            fontSize: '1rem',
            fontWeight: 500,
            color: '#e0e0e0',
            marginBottom: '32px',
          }}
        >
          Create Account
        </h1>

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

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.7rem',
                color: '#555',
                marginBottom: '6px',
              }}
            >
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                background: '#000',
                border: '1px solid #1a1a1a',
                padding: '10px 12px',
                color: '#e0e0e0',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#1a1a1a')}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.7rem',
                color: '#555',
                marginBottom: '6px',
              }}
            >
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                background: '#000',
                border: '1px solid #1a1a1a',
                padding: '10px 12px',
                color: '#e0e0e0',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#1a1a1a')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: 'transparent',
              border: '1px solid var(--color-accent)',
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              fontWeight: 500,
              padding: '12px',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.4 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Creating…' : 'Create Account'}
          </button>
        </form>

        <p
          style={{
            textAlign: 'center',
            marginTop: '24px',
            fontSize: '0.75rem',
            color: '#555',
          }}
        >
          Already have an account?{' '}
          <Link
            to="/login"
            style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
