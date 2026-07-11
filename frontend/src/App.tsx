import { BrowserRouter, Routes, Route, useSearchParams, Navigate } from "react-router-dom";
import SourceView from "@/components/SourceView";
import TargetView from "@/components/TargetView";
import LoginView from "@/components/LoginView";
import RegisterView from "@/components/RegisterView";
import DashboardView from "@/components/DashboardView";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function SourcePage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  if (!sessionId) {
    return <Navigate to="/" replace />;
  }

  return <SourceView sessionId={sessionId} />;
}

function TargetPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "var(--color-bg-primary)" }}>
        <div className="text-center glass-card p-8">
          <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
            Session ID Required
          </h2>
          <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
            Open this URL with a session parameter:
          </p>
          <code
            className="text-sm font-mono px-3 py-2 rounded-md block"
            style={{ background: "var(--color-bg-card)", color: "var(--color-accent)" }}
          >
            /live?session=YOUR_ID
          </code>
        </div>
      </div>
    );
  }

  return <TargetView sessionId={sessionId} />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route path="/register" element={<RegisterView />} />
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <DashboardView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/source" 
            element={
              <ProtectedRoute>
                <SourcePage />
              </ProtectedRoute>
            } 
          />
          <Route path="/live" element={<TargetPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
