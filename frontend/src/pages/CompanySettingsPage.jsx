import { useEffect, useState } from 'react';
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
  const { paychexEnabled, refreshConfig } = useAppConfig();
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

  return (
    <div>
      <h1>Company Settings</h1>
      <p>
        Mode: <strong>{paychexEnabled ? 'Paychex Flex' : 'Non-Paychex (local payroll)'}</strong>
      </p>
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
        <input placeholder="Company Name" value={form.company_name} onChange={(e) => setForm((s) => ({ ...s, company_name: e.target.value }))} />
        <textarea placeholder="Company Address" value={form.company_address} onChange={(e) => setForm((s) => ({ ...s, company_address: e.target.value }))} />
        <input placeholder="Certifying Official Name" value={form.certifying_official_name} onChange={(e) => setForm((s) => ({ ...s, certifying_official_name: e.target.value }))} />
        <input placeholder="Certifying Official Title" value={form.certifying_official_title} onChange={(e) => setForm((s) => ({ ...s, certifying_official_title: e.target.value }))} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
        <button
          type="button"
          onClick={() =>
            apiPatch('/api/company-settings', form, token)
              .then(async (data) => {
                setForm({ ...initialState, ...data, paychex_enabled: data.paychex_enabled !== false });
                await refreshConfig();
                setMessage('Saved');
              })
              .catch((err) => setError(err.message))
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
