import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ADMIN_CONFIG_SCOPE, useEditScope } from '../context/EditLockContext';
import { apiGet, apiPatch } from '../api/client';

const initialState = {
  company_name: '',
  company_address: '',
  certifying_official_name: '',
  certifying_official_title: '',
  phone: '',
  email: '',
};

export default function CompanySettingsPage() {
  const { token } = useAuth();
  useEditScope(ADMIN_CONFIG_SCOPE);
  const [form, setForm] = useState(initialState);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/api/company-settings', token)
      .then((data) => setForm({ ...initialState, ...data }))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div>
      <h1>Company Settings</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {message && <p style={{ color: 'green' }}>{message}</p>}
      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
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
              .then((data) => {
                setForm({ ...initialState, ...data });
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
