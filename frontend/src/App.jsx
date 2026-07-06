import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import DailyEntry from './pages/DailyEntry';
import SummaryPage from './pages/SummaryPage';
import PayrollPage from './pages/PayrollPage';
import ManageUsers from './pages/ManageUsers';
import Settings from './pages/Settings';

function HomeRedirect() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return <Navigate to={token ? '/daily-entry' : '/login'} replace />;
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
        element={token ? <Navigate to="/daily-entry" replace /> : <Login />}
      />
      <Route path="/" element={<HomeRedirect />} />
      <Route
        path="/daily-entry"
        element={
          <ProtectedRoute>
            <DailyEntry />
          </ProtectedRoute>
        }
      />
      <Route path="/daily" element={<Navigate to="/daily-entry" replace />} />
      <Route
        path="/summary"
        element={
          <ProtectedRoute>
            <SummaryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll"
        element={
          <ProtectedRoute requireAdmin>
            <PayrollPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute requireAdmin>
            <ManageUsers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute requireAdmin>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route path="/submit" element={<Navigate to="/payroll" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
