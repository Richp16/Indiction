import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function HardhatLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M4 18h20v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3z"
        fill="var(--color-primary)"
      />
      <path
        d="M2 14c0-1.1.9-2 2-2h20c1.1 0 2 .9 2 2v2H2v-2z"
        fill="var(--color-primary-hover)"
      />
      <path
        d="M8 12V9a6 6 0 0 1 12 0v3"
        stroke="var(--color-primary)"
        strokeWidth="2"
        fill="none"
      />
      <rect x="12" y="6" width="4" height="3" rx="1" fill="var(--color-warning)" />
    </svg>
  );
}

function formatRole(role) {
  return role.replace(/_/g, ' ');
}

export default function NavBar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <NavLink to="/" className="navbar-brand">
        <HardhatLogo />
        FieldPay
      </NavLink>

      <div className="navbar-links">
        <NavLink
          to="/entry"
          className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
        >
          Daily Entry
        </NavLink>
        <NavLink
          to="/summary"
          className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
        >
          Summary
        </NavLink>
        {(user?.role === 'payroll_admin' || user?.role === 'system_admin') && (
          <NavLink
            to="/submit"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            Submit
          </NavLink>
        )}
        {user?.role === 'system_admin' && (
          <NavLink
            to="/settings"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            Settings
          </NavLink>
        )}
      </div>

      <div className="navbar-user">
        <span className="navbar-email">{user?.email}</span>
        <span className="badge badge-success">{formatRole(user?.role || '')}</span>
        <button type="button" className="btn btn-secondary" onClick={logout}>
          Logout
        </button>
      </div>
    </nav>
  );
}
