import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  apiGet,
  apiPost,
  registerUnauthorizedHandler,
  sendLogoutBeacon,
} from '../api/client';

const TOKEN_KEY = 'indiction_token';
const USER_KEY = 'indiction_user';
const SESSION_MSG_KEY = 'indiction_session_message';

/** Activity heartbeat for all logged-in users (separate from edit-lock heartbeat). */
const SESSION_HEARTBEAT_MS = 60_000;

const AuthContext = createContext(null);

/** Optional callback registered by EditLockProvider to release locks on logout. */
let releaseLocksOnLogout = null;

export function registerLogoutLockRelease(fn) {
  releaseLocksOnLogout = fn;
}

function clearLocalAuthStorage() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [paychexEnabled, setPaychexEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState(null);
  const tokenRef = useRef(null);
  const loggingOutRef = useRef(false);
  tokenRef.current = token;

  const clearAuthState = useCallback((message = null) => {
    setToken(null);
    setUser(null);
    setPaychexEnabled(true);
    clearLocalAuthStorage();
    if (message) {
      setSessionMessage(message);
      try {
        sessionStorage.setItem(SESSION_MSG_KEY, message);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    const storedToken = sessionStorage.getItem(TOKEN_KEY);
    const storedUser = sessionStorage.getItem(USER_KEY);
    const storedMsg = sessionStorage.getItem(SESSION_MSG_KEY);
    if (storedMsg) {
      setSessionMessage(storedMsg);
      sessionStorage.removeItem(SESSION_MSG_KEY);
    }
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
    registerUnauthorizedHandler((info) => {
      if (loggingOutRef.current) return;
      const message =
        info?.code === 'SESSION_EXPIRED' || /session expired/i.test(info?.message || '')
          ? 'Your session expired — please log in again'
          : 'Your session expired — please log in again';
      clearAuthState(message);
    });
    return () => registerUnauthorizedHandler(null);
  }, [clearAuthState]);

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

  // Session activity heartbeat (all users; pauses while tab is hidden).
  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    async function beat() {
      if (cancelled || loggingOutRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const authToken = tokenRef.current;
      if (!authToken) return;
      try {
        await apiPost('/api/auth/heartbeat', {}, authToken);
      } catch {
        // 401 handler clears auth; other errors are ignored until next beat.
      }
    }

    beat();
    const id = setInterval(beat, SESSION_HEARTBEAT_MS);

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        beat();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token]);

  // Best-effort logout on tab close / page hide.
  useEffect(() => {
    if (!token) return undefined;

    function unloadBeacon() {
      const authToken = tokenRef.current;
      if (!authToken || loggingOutRef.current) return;
      sendLogoutBeacon(authToken);
    }

    window.addEventListener('pagehide', unloadBeacon);
    window.addEventListener('beforeunload', unloadBeacon);
    return () => {
      window.removeEventListener('pagehide', unloadBeacon);
      window.removeEventListener('beforeunload', unloadBeacon);
    };
  }, [token]);

  async function login(email, password) {
    const data = await apiPost('/api/auth/login', { email, password });
    setSessionMessage(null);
    sessionStorage.removeItem(SESSION_MSG_KEY);
    setToken(data.token);
    setUser(data.user);
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data;
  }

  async function logout() {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    const authToken = tokenRef.current;
    try {
      if (typeof releaseLocksOnLogout === 'function') {
        try {
          await releaseLocksOnLogout();
        } catch {
          // ignore
        }
      }
      if (authToken) {
        try {
          await apiPost('/api/auth/logout', {}, authToken);
        } catch {
          // ignore — local clear still happens
        }
      }
    } finally {
      clearAuthState(null);
      loggingOutRef.current = false;
    }
  }

  function consumeSessionMessage() {
    const message = sessionMessage;
    setSessionMessage(null);
    sessionStorage.removeItem(SESSION_MSG_KEY);
    return message;
  }

  const isAdmin =
    user?.role === 'system_admin' || user?.role === 'payroll_admin';

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAdmin,
        paychexEnabled,
        login,
        logout,
        isLoading,
        sessionMessage,
        consumeSessionMessage,
      }}
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
