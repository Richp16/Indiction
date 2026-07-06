import { Navigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function AppLayout({ children }) {
  const { logout, user, isAdmin } = useAuth();

  return (
    <div>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #ccc', marginBottom: '1rem' }}>
        <Link to="/daily-entry" style={{ marginRight: '1rem' }}>
          Daily Entry
        </Link>
        <Link to="/summary" style={{ marginRight: '1rem' }}>
          Summary
        </Link>
        {isAdmin && (
          <>
            <Link to="/payroll" style={{ marginRight: '1rem' }}>
              Payroll
            </Link>
            <Link to="/admin/users" style={{ marginRight: '1rem' }}>
              Manage Users
            </Link>
          </>
        )}
        {user?.email && <span style={{ marginRight: '1rem' }}>{user.email}</span>}
        <button type="button" onClick={logout}>
          Logout
        </button>
      </nav>
      <main style={{ padding: '0 1rem 2rem' }}>{children}</main>
    </div>
  );
}

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { token, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return <p>Loading…</p>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/summary" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}
