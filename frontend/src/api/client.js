const API_BASE_URL = import.meta.env.DEV
  ? import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
  : '';

export { API_BASE_URL };

/** Optional handler for 401 SESSION_EXPIRED / unauthorized responses. */
let onUnauthorized = null;

export function registerUnauthorizedHandler(fn) {
  onUnauthorized = typeof fn === 'function' ? fn : null;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
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

    if (res.status === 401 && typeof onUnauthorized === 'function') {
      try {
        onUnauthorized({ code: data.code, message });
      } catch {
        // ignore handler errors
      }
    }

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

export async function apiPostForm(path, formData, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  return parseResponse(res);
}

export async function apiGetDownload(path, token) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text || 'Download failed' };
    }
    throw new Error(data.message || 'Download failed');
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch ? filenameMatch[1] : 'download';
  return { blob: await res.blob(), filename };
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

/**
 * Best-effort unload logout. Prefer sendBeacon; fall back to keepalive fetch.
 */
export function sendLogoutBeacon(token) {
  if (!token) return false;
  const url = `${API_BASE_URL}/api/auth/logout-beacon`;
  const body = JSON.stringify({ token });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      return navigator.sendBeacon(url, blob);
    }
  } catch {
    // fall through
  }
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
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
    const error = new Error(message);
    error.status = res.status;
    error.code = data.code;
    if (res.status === 401 && typeof onUnauthorized === 'function') {
      try {
        onUnauthorized({ code: data.code, message });
      } catch {
        // ignore
      }
    }
    throw error;
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch ? filenameMatch[1] : 'payroll_ta.csv';

  return { blob: await res.blob(), filename };
}
