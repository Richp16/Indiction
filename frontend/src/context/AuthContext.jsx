import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../api/client';

const TOKEN_KEY = 'fieldpay_token';
const USER_KEY = 'fieldpay_user';

const AuthContext = createContext(null);

/** Optional callback registered by EditLockProvider to release locks on logout. */
let releaseLocksOnLogout = null;

export function registerLogoutLockRelease(fn) {
  releaseLocksOnLogout = fn;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [paychexEnabled, setPaychexEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const tokenRef = useRef(null);
  tokenRef.current = token;

  useEffect(() => {
    const storedToken = sessionStorage.getItem(TOKEN_KEY);
    const storedUser = sessionStorage.getItem(USER_KEY);
    if (storedToken) {
      setToken(storedToken);
    }
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        sessionStorage.removeItem(USER_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!token) {
      setPaychexEnabled(true);
      return undefined;
    }

    let cancelled = false;
    async function loadFeatures() {
      try {
        const features = await apiGet('/api/account/features', token);
        if (!cancelled) {
          setPaychexEnabled(features.paychexEnabled !== false);
        }
      } catch {
        if (!cancelled) setPaychexEnabled(true);
      }
    }
    loadFeatures();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function login(email, password) {
    const data = await apiPost('/api/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data;
  }

  async function logout() {
    const authToken = tokenRef.current;
    if (typeof releaseLocksOnLogout === 'function') {
      try {
        await releaseLocksOnLogout();
      } catch {
        // ignore
      }
    } else if (authToken) {
      try {
        await apiPost('/api/edit-locks/release-all', {}, authToken);
      } catch {
        // ignore
      }
    }
    setToken(null);
    setUser(null);
    setPaychexEnabled(true);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  const isAdmin =
    user?.role === 'system_admin' || user?.role === 'payroll_admin';

  return (
    <AuthContext.Provider
      value={{ token, user, isAdmin, paychexEnabled, login, logout, isLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
