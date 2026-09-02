import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useAppConfig } from './context/AppConfigContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import SetupModePage from './pages/SetupModePage';
import DailyEntry from './pages/DailyEntry';
import SummaryPage from './pages/SummaryPage';
import MyEntriesPage from './pages/MyEntriesPage';
import PayrollPage from './pages/PayrollPage';
import JobCostingPage from './pages/JobCostingPage';
import ManageEmployeesPage from './pages/ManageEmployeesPage';
import ManageUsers from './pages/ManageUsers';
import Settings from './pages/Settings';
import CompanySettingsPage from './pages/CompanySettingsPage';
import JobSitesPage from './pages/JobSitesPage';
import ClassificationsPage from './pages/ClassificationsPage';
import PayRatesPage from './pages/PayRatesPage';
import CertifiedPayrollPage from './pages/CertifiedPayrollPage';
import ManageBillsPage from './pages/ManageBillsPage';

function HomeRedirect() {
  const { token, isLoading } = useAuth();
  const { integrationConfigured, loading: configLoading } = useAppConfig();

  if (isLoading || configLoading) {
    return <p>Loading…</p>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!integrationConfigured) {
    return <Navigate to="/setup" replace />;
  }

  return <Navigate to="/daily-entry" replace />;
}

function PayrollGate({ children }) {
  const { paychexEnabled } = useAppConfig();
  if (!paychexEnabled) {
    return <Navigate to="/admin/employees" replace />;
  }
  return children;
}

function NonPaychexGate({ children }) {
  const { paychexEnabled } = useAppConfig();
  if (paychexEnabled) {
    return <Navigate to="/daily-entry" replace />;
  }
  return children;
}

function SettingsGate({ children }) {
  const { paychexEnabled } = useAppConfig();
  if (!paychexEnabled) {
    return <Navigate to="/company-settings" replace />;
  }
  return children;
}

export default function App() {
  const { token, isLoading } = useAuth();
  const { loading: configLoading } = useAppConfig();

  if (isLoading || (token && configLoading)) {
    return <p>Loading…</p>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <Login />}
      />
      <Route path="/" element={<HomeRedirect />} />
      <Route
        path="/setup"
        element={
          <ProtectedRoute skipSetupRedirect minimalLayout>
            <SetupModePage />
          </ProtectedRoute>
        }
      />
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
        path="/my-entries"
        element={
          <ProtectedRoute>
            <MyEntriesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/summary"
        element={
          <ProtectedRoute requireAdmin>
            <SummaryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll"
        element={
          <ProtectedRoute requireAdmin>
            <PayrollGate>
              <PayrollPage />
            </PayrollGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/employees"
        element={
          <ProtectedRoute requireAdmin>
            <NonPaychexGate>
              <ManageEmployeesPage />
            </NonPaychexGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/job-costing"
        element={
          <ProtectedRoute requireAdmin>
            <JobCostingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/manage-bills"
        element={
          <ProtectedRoute requireAdmin>
            <ManageBillsPage />
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
            <SettingsGate>
              <Settings />
            </SettingsGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/company-settings"
        element={
          <ProtectedRoute requireAdmin>
            <CompanySettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/job-sites"
        element={
          <ProtectedRoute requireAdmin>
            <JobSitesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/classifications"
        element={
          <ProtectedRoute requireAdmin>
            <ClassificationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/pay-rates"
        element={
          <ProtectedRoute requireAdmin>
            <PayRatesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/certified-payroll"
        element={
          <ProtectedRoute requireAdmin>
            <CertifiedPayrollPage />
          </ProtectedRoute>
        }
      />
      <Route path="/submit" element={<Navigate to="/payroll" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
