import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import DailyEntry from './pages/DailyEntry';
import Summary from './pages/Summary';
import Submit from './pages/Submit';
import Settings from './pages/Settings';

function AppLayout({ children }) {
  const { logout, user } = useAuth();

  return (
    <div>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #ccc', marginBottom: '1rem' }}>
        <Link to="/daily" style={{ marginRight: '1rem' }}>Daily</Link>
        <Link to="/summary" style={{ marginRight: '1rem' }}>Summary</Link>
        <Link to="/submit" style={{ marginRight: '1rem' }}>Submit</Link>
        <Link to="/settings" style={{ marginRight: '1rem' }}>Settings</Link>
        {user?.email && <span style={{ marginRight: '1rem' }}>{user.email}</span>}
        <button type="button" onClick={logout}>Logout</button>
      </nav>
      <main style={{ padding: '0 1rem 2rem' }}>{children}</main>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return <p>Loading…</p>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function HomeRedirect() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return <Navigate to={token ? '/daily' : '/login'} replace />;
}

export default function App() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to="/daily" replace /> : <Login />}
      />
      <Route path="/" element={<HomeRedirect />} />
      <Route
        path="/daily"
        element={
          <ProtectedRoute>
            <DailyEntry />
          </ProtectedRoute>
        }
      />
      <Route
        path="/summary"
        element={
          <ProtectedRoute>
            <Summary />
          </ProtectedRoute>
        }
      />
      <Route
        path="/submit"
        element={
          <ProtectedRoute>
            <Submit />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
