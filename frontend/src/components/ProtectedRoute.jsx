import { useState, useEffect, useRef } from 'react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppConfig } from '../context/AppConfigContext';
import SyncFailureBanner from './SyncFailureBanner';
import EditLockBanner from './EditLockBanner';

const SETTINGS_PATHS = [
  '/admin/job-sites',
  '/admin/classifications',
  '/admin/pay-rates',
  '/company-settings',
];

const PAYROLL_PATHS = ['/payroll', '/local-payroll', '/job-costing', '/admin/employees'];

function NavDropdown({ label, items, paths }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const isActive = paths.some(
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
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    if (!open) return undefined;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!items.length) return null;

  return (
    <div ref={rootRef} className="nav-dropdown">
      <button
        type="button"
        className={`nav-link nav-link--button${isActive ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label} <span className="nav-link__caret" aria-hidden="true">▾</span>
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

function SettingsDropdown() {
  return (
    <NavDropdown
      label="Company Settings"
      paths={SETTINGS_PATHS}
      items={[
        { to: '/admin/job-sites', label: 'Job Sites' },
        { to: '/admin/classifications', label: 'Classifications' },
        { to: '/admin/pay-rates', label: 'Pay Rates' },
        { to: '/company-settings', label: 'Company Settings' },
      ]}
    />
  );
}

function PayrollDropdown() {
  const { paychexEnabled, capabilities } = useAppConfig();
  const items = [];
  if (capabilities?.supportsSpiExport || paychexEnabled) {
    items.push({ to: '/payroll', label: 'Paychex SPI' });
  }
  if (capabilities?.supportsLocalPayrollExport || !paychexEnabled) {
    items.push({ to: '/local-payroll', label: 'Local Payroll' });
    items.push({ to: '/admin/employees', label: 'Manage Employees' });
  }
  items.push({ to: '/job-costing', label: 'Job Costing' });

  return <NavDropdown label="Payroll" paths={PAYROLL_PATHS} items={items} />;
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
          {isAdmin && <PayrollDropdown />}
          {isAdmin && (
            <>
              <NavLink to="/certified-payroll">Certified Payroll</NavLink>
              <NavLink to="/manage-bills">AR/AP</NavLink>
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
      <EditLockBanner />
      <main className="app-main-content">{children}</main>
    </div>
  );
}

export default function ProtectedRoute({
  children,
  requireAdmin = false,
  skipSetupRedirect = false,
  minimalLayout = false,
}) {
  const { token, isAdmin, isLoading } = useAuth();
  const { integrationConfigured, loading: configLoading } = useAppConfig();
  const location = useLocation();

  if (isLoading || configLoading) {
    return <p>Loading…</p>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (
    !skipSetupRedirect &&
    !integrationConfigured &&
    location.pathname !== '/setup'
  ) {
    return <Navigate to="/setup" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/daily-entry" replace />;
  }

  if (minimalLayout) {
    return <main className="app-main-content">{children}</main>;
  }

  return <AppLayout>{children}</AppLayout>;
}
