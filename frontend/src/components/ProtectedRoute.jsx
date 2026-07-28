import { Navigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function AppLayout({ children }) {
  const { logout, user, isAdmin } = useAuth();

  return (
    <div>
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          padding: '1rem',
          borderBottom: '1px solid #ccc',
          marginBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <Link to="/daily-entry">Daily Entry</Link>
          <Link to="/summary">Summary</Link>
          <Link to="/payroll">Payroll</Link>
          {isAdmin && (
            <>
              <Link to="/certified-payroll">Certified Payroll</Link>
              <Link to="/company-settings">Company Settings</Link>
              <Link to="/admin/job-sites">Job Sites</Link>
              <Link to="/admin/classifications">Classifications</Link>
              <Link to="/admin/pay-rates">Pay Rates</Link>
              <Link to="/admin/users">Manage Users</Link>
            </>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '0.25rem',
            flexShrink: 0,
          }}
        >
          {user?.email && (
            <span style={{ fontSize: '0.875rem', color: '#666' }}>{user.email}</span>
          )}
          <button
            type="button"
            onClick={logout}
            style={{
              fontSize: '0.75rem',
              padding: '0.25rem 0.625rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#f7f7f7',
              color: '#555',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
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
