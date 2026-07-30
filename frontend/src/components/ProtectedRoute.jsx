import { useState, useEffect, useRef } from 'react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SyncFailureBanner from './SyncFailureBanner';

const SETTINGS_PATHS = [
  '/admin/job-sites',
  '/admin/classifications',
  '/admin/pay-rates',
  '/company-settings',
];

function SettingsDropdown() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const isActive = SETTINGS_PATHS.some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const items = [
    { to: '/admin/job-sites', label: 'Job Sites' },
    { to: '/admin/classifications', label: 'Classifications' },
    { to: '/admin/pay-rates', label: 'Pay Rates' },
    { to: '/company-settings', label: 'Company Settings' },
  ];

  return (
    <div ref={rootRef} className="nav-dropdown">
      <button
        type="button"
        className={`nav-link nav-link--button${isActive ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Company Settings <span className="nav-link__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="menu" className="nav-dropdown__menu">
          {items.map((item) => {
            const active =
              location.pathname === item.to ||
              location.pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                className={`nav-dropdown__item${active ? ' active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavLink({ to, children }) {
  const location = useLocation();
  const active =
    location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Link to={to} className={`nav-link${active ? ' active' : ''}`}>
      {children}
    </Link>
  );
}

function AppLayout({ children }) {
  const { logout, user, isAdmin } = useAuth();

  return (
    <div>
      <nav className="app-nav" aria-label="Main">
        <div className="app-nav__links">
          <NavLink to="/daily-entry">Daily Entry</NavLink>
          <NavLink to="/my-entries">My Entries</NavLink>
          {isAdmin && <NavLink to="/summary">Summary</NavLink>}
          {isAdmin && <NavLink to="/payroll">Payroll</NavLink>}
          {isAdmin && (
            <>
              <NavLink to="/certified-payroll">Certified Payroll</NavLink>
              <SettingsDropdown />
              <NavLink to="/admin/users">Manage Users</NavLink>
            </>
          )}
        </div>
        <div className="app-nav__user">
          {user?.email && <span className="app-nav__email">{user.email}</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
            Logout
          </button>
        </div>
      </nav>
      <SyncFailureBanner />
      <main className="app-main-content">{children}</main>
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
    return <Navigate to="/daily-entry" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}
