import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppConfig } from '../context/AppConfigContext';
import { apiGet, apiPatch } from '../api/client';

const initialState = {
  company_name: '',
  company_address: '',
  certifying_official_name: '',
  certifying_official_title: '',
  phone: '',
  email: '',
  paychex_enabled: true,
};

export default function CompanySettingsPage() {
  const { token } = useAuth();
  const { paychexEnabled, refreshConfig, capabilities } = useAppConfig();
  const [form, setForm] = useState(initialState);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/api/company-settings', token)
      .then((data) =>
        setForm({
          ...initialState,
          ...data,
          paychex_enabled: data.paychex_enabled !== false,
        })
      )
      .catch((err) => setError(err.message));
  }, [token]);

  async function save() {
    setError('');
    setMessage('');
    const modeChanging = Boolean(form.paychex_enabled) !== Boolean(paychexEnabled);
    if (modeChanging) {
      const next = form.paychex_enabled ? 'Paychex Flex' : 'Non-Paychex (local payroll)';
      const ok = window.confirm(
        `Switch account mode to ${next}?\n\n` +
          '• Existing workers, entries, periods, and reports are NOT deleted.\n' +
          '• Paychex sync and SPI submission stop immediately in Non-Paychex mode.\n' +
          '• Re-enabling Paychex does not overwrite local data automatically.\n' +
          '• You may need to reconcile duplicate workers/periods manually.\n\n' +
          'Continue?'
      );
      if (!ok) return;
    }

    try {
      const data = await apiPatch('/api/company-settings', form, token);
      setForm({
        ...initialState,
        ...data,
        paychex_enabled: data.paychex_enabled !== false,
      });
      await refreshConfig();
      setMessage(modeChanging ? 'Saved — mode updated. Reload if menus look stale.' : 'Saved');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Company Settings</h1>
      <p>
        Mode:{' '}
        <strong>{paychexEnabled ? 'Paychex Flex' : 'Non-Paychex (local payroll)'}</strong>
        {capabilities?.workerSource ? ` · workers: ${capabilities.workerSource}` : ''}
      </p>

      <div style={{ marginBottom: '1rem', fontSize: 14 }}>
        <strong>Quick links</strong>
        <ul>
          <li>
            <Link to="/admin/job-sites">Job sites</Link>
          </li>
          <li>
            <Link to="/admin/classifications">Classifications</Link>
          </li>
          <li>
            <Link to="/admin/pay-rates">Pay rates</Link>
          </li>
          <li>
            <Link to="/admin/users">Users</Link>
          </li>
          {!paychexEnabled && (
            <>
              <li>
                <Link to="/admin/employees">Manage employees &amp; pay periods</Link>
              </li>
              <li>
                <Link to="/local-payroll">Local Payroll review / export</Link>
              </li>
            </>
          )}
          {paychexEnabled && (
            <li>
              <Link to="/settings">Paychex sync &amp; health</Link>
            </li>
          )}
        </ul>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {message && <p style={{ color: 'green' }}>{message}</p>}
      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <label>
          <input
            type="checkbox"
            checked={form.paychex_enabled}
            onChange={(e) => setForm((s) => ({ ...s, paychex_enabled: e.target.checked }))}
          />
          {' '}
          Enable Paychex integration
        </label>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
          Changing mode requires confirmation and never deletes historical payroll data.
          If <code>PAYCHEX_ENABLED</code> is set in the server environment, it overrides this checkbox.
        </p>
        <input placeholder="Company Name" value={form.company_name} onChange={(e) => setForm((s) => ({ ...s, company_name: e.target.value }))} />
        <textarea placeholder="Company Address" value={form.company_address} onChange={(e) => setForm((s) => ({ ...s, company_address: e.target.value }))} />
        <input placeholder="Certifying Official Name" value={form.certifying_official_name} onChange={(e) => setForm((s) => ({ ...s, certifying_official_name: e.target.value }))} />
        <input placeholder="Certifying Official Title" value={form.certifying_official_title} onChange={(e) => setForm((s) => ({ ...s, certifying_official_title: e.target.value }))} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
        <button type="button" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
