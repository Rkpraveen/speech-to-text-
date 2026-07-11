import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Mic, Radio, LogOut, Loader2 } from 'lucide-react';

export default function DashboardView() {
  const { username, token, logout } = useAuth();
  const navigate = useNavigate();
  const [joinSessionId, setJoinSessionId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreateSession = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/sessions/create', {
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
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-4xl mx-auto relative z-10">
        <header className="flex items-center justify-between py-6 mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Radio className="text-white w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">SpeechSync</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-400">Hello, <strong className="text-white">{username}</strong></span>
            <button
              onClick={logout}
              className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors flex items-center gap-2"
              title="Logout"
            >
              <LogOut size={18} />
              <span className="text-sm">Logout</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl mb-8">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Create Session Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm flex flex-col items-center text-center hover:bg-white/[0.07] transition-all">
            <div className="w-20 h-20 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mb-6">
              <Mic size={40} />
            </div>
            <h2 className="text-2xl font-bold mb-3">Host a Stream</h2>
            <p className="text-gray-400 mb-8 max-w-sm">
              Generate a new session ID and start transcribing your speech in real-time.
            </p>
            <button
              onClick={handleCreateSession}
              disabled={creating}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl transition-all flex justify-center items-center gap-2 disabled:opacity-50"
            >
              {creating ? <Loader2 className="animate-spin" /> : 'Start New Live Session'}
            </button>
          </div>

          {/* Join Session Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm flex flex-col items-center text-center hover:bg-white/[0.07] transition-all">
            <div className="w-20 h-20 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mb-6">
              <Radio size={40} />
            </div>
            <h2 className="text-2xl font-bold mb-3">Join a Stream</h2>
            <p className="text-gray-400 mb-8 max-w-sm">
              Enter a 6-character session ID provided by a host to listen in live.
            </p>
            <form onSubmit={handleJoinSession} className="w-full mt-auto">
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="e.g. M9ARWM"
                  value={joinSessionId}
                  onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white uppercase text-center text-lg focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all"
                  maxLength={6}
                />
                <button
                  type="submit"
                  disabled={joinSessionId.length < 2}
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl transition-all disabled:opacity-50"
                >
                  Join Live Stream
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
