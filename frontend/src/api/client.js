const API_BASE_URL = import.meta.env.DEV
  ? import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
  : '';

export { API_BASE_URL };

async function parseResponse(res) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message =
      data.message ||
      data.error ||
      (Array.isArray(data.errors)
        ? data.errors.map((e) => `Row ${e.row + 1}: ${e.reason}`).join('; ')
        : null) ||
      'Request failed';
    const error = new Error(message);
    error.status = res.status;
    error.code = data.code;
    error.lock = data.lock || null;
    error.editingUser = data.editingUser || data.lock?.editingUser || null;
    error.debug = data.debug || null;
    throw error;
  }
  return data;
}

export async function apiGet(path, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return parseResponse(res);
}

export async function apiPatch(path, body, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiPut(path, body, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiDelete(path, token, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return parseResponse(res);
}

export async function apiPost(path, body, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiPostDownload(path, body, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text || 'Download failed' };
    }
    const message =
      data.message ||
      (Array.isArray(data.errors)
        ? data.errors.map((e) => `Row ${e.row + 1}: ${e.reason}`).join('; ')
        : null) ||
      'Download failed';
    throw new Error(message);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch ? filenameMatch[1] : 'payroll_ta.csv';

  return { blob: await res.blob(), filename };
}
