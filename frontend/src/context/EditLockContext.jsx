import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth, registerLogoutLockRelease } from './AuthContext';
import { apiGet, apiPost } from '../api/client';

export const ADMIN_CONFIG_SCOPE = 'admin_config';
export const PAYROLL_SCOPE = 'payroll';

export function dailyEntriesScope(jobSiteId) {
  const id =
    jobSiteId != null && String(jobSiteId).trim() !== ''
      ? String(jobSiteId)
      : '_none';
  return `daily_entries:${id}`;
}

export function certifiedPayrollScope(jobSiteId) {
  if (jobSiteId == null || String(jobSiteId).trim() === '') return null;
  return `certified_payroll:${jobSiteId}`;
}

const HEARTBEAT_MS = 30_000;
const STATUS_POLL_MS = 15_000;

const EditLockContext = createContext(null);

export function EditLockProvider({ children }) {
  const { token, user } = useAuth();
  const [locksByScope, setLocksByScope] = useState({});
  const heldRef = useRef(new Set());
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const setScopeState = useCallback((scopeKey, next) => {
    setLocksByScope((prev) => {
      if (next == null) {
        if (!(scopeKey in prev)) return prev;
        const copy = { ...prev };
        delete copy[scopeKey];
        return copy;
      }
      return { ...prev, [scopeKey]: { ...prev[scopeKey], ...next } };
    });
  }, []);

  const releaseAll = useCallback(async () => {
    const authToken = tokenRef.current;
    heldRef.current.clear();
    setLocksByScope({});
    if (!authToken) return;
    try {
      await apiPost('/api/edit-locks/release-all', {}, authToken);
    } catch {
      // Best-effort; timeout will clear abandoned locks.
    }
  }, []);

  useEffect(() => {
    registerLogoutLockRelease(releaseAll);
    return () => registerLogoutLockRelease(null);
  }, [releaseAll]);

  const acquire = useCallback(
    async (scopeKey) => {
      if (!scopeKey || !tokenRef.current || !user?.id) {
        return { ok: false, reason: 'unavailable' };
      }
      try {
        const data = await apiPost(
          '/api/edit-locks/acquire',
          { scopeKey },
          tokenRef.current
        );
        heldRef.current.add(scopeKey);
        setScopeState(scopeKey, {
          status: 'holding',
          lock: data.lock,
          readOnly: false,
          holderName: null,
        });
        return { ok: true, lock: data.lock };
      } catch (error) {
        if (error.status === 423) {
          heldRef.current.delete(scopeKey);
          setScopeState(scopeKey, {
            status: 'blocked',
            lock: error.lock || null,
            readOnly: true,
            holderName: error.lock?.holderName || 'another user',
          });
          return { ok: false, reason: 'held', lock: error.lock };
        }
        setScopeState(scopeKey, {
          status: 'error',
          readOnly: true,
          holderName: null,
          message: error.message,
        });
        return { ok: false, reason: 'error', message: error.message };
      }
    },
    [setScopeState, user?.id]
  );

  const release = useCallback(
    async (scopeKey) => {
      if (!scopeKey) return;
      heldRef.current.delete(scopeKey);
      setScopeState(scopeKey, null);
      if (!tokenRef.current) return;
      try {
        await apiPost('/api/edit-locks/release', { scopeKey }, tokenRef.current);
      } catch {
        // ignore
      }
    },
    [setScopeState]
  );

  const heartbeatHeld = useCallback(async () => {
    const scopes = [...heldRef.current];
    if (!tokenRef.current || scopes.length === 0) return;
    await Promise.all(
      scopes.map(async (scopeKey) => {
        try {
          const data = await apiPost(
            '/api/edit-locks/heartbeat',
            { scopeKey },
            tokenRef.current
          );
          setScopeState(scopeKey, {
            status: 'holding',
            lock: data.lock,
            readOnly: false,
            holderName: null,
          });
        } catch (error) {
          heldRef.current.delete(scopeKey);
          if (error.status === 423) {
            setScopeState(scopeKey, {
              status: 'blocked',
              lock: error.lock || null,
              readOnly: true,
              holderName: error.lock?.holderName || 'another user',
            });
          } else {
            setScopeState(scopeKey, {
              status: 'error',
              readOnly: true,
              message: error.message,
            });
          }
        }
      })
    );
  }, [setScopeState]);

  const pollBlocked = useCallback(async () => {
    if (!tokenRef.current) return;
    const blocked = Object.entries(locksByScope)
      .filter(([, state]) => state?.status === 'blocked')
      .map(([scopeKey]) => scopeKey);
    if (blocked.length === 0) return;

    try {
      const data = await apiGet(
        `/api/edit-locks/status?scopes=${encodeURIComponent(blocked.join(','))}`,
        tokenRef.current
      );
      for (const scopeKey of blocked) {
        const lock = data.locks?.[scopeKey];
        if (!lock) {
          // Free — try to claim.
          await acquire(scopeKey);
        } else if (String(lock.holderUserId) === String(user?.id)) {
          heldRef.current.add(scopeKey);
          setScopeState(scopeKey, {
            status: 'holding',
            lock,
            readOnly: false,
            holderName: null,
          });
        } else {
          setScopeState(scopeKey, {
            status: 'blocked',
            lock,
            readOnly: true,
            holderName: lock.holderName,
          });
        }
      }
    } catch {
      // ignore poll errors
    }
  }, [acquire, locksByScope, setScopeState, user?.id]);

  useEffect(() => {
    if (!token) {
      heldRef.current.clear();
      setLocksByScope({});
      return undefined;
    }
    const heartbeatId = setInterval(heartbeatHeld, HEARTBEAT_MS);
    const pollId = setInterval(pollBlocked, STATUS_POLL_MS);
    return () => {
      clearInterval(heartbeatId);
      clearInterval(pollId);
    };
  }, [token, heartbeatHeld, pollBlocked]);

  const value = {
    locksByScope,
    acquire,
    release,
    releaseAll,
    getScopeState: (scopeKey) => locksByScope[scopeKey] || null,
  };

  return (
    <EditLockContext.Provider value={value}>{children}</EditLockContext.Provider>
  );
}

export function useEditLock() {
  const context = useContext(EditLockContext);
  if (!context) {
    throw new Error('useEditLock must be used within EditLockProvider');
  }
  return context;
}

/**
 * Acquire `scopeKey` while mounted / while the key is set. Releases on change or unmount.
 */
export function useEditScope(scopeKey) {
  const { acquire, release, getScopeState } = useEditLock();
  const activeKey = scopeKey || null;

  useEffect(() => {
    if (!activeKey) return undefined;
    let cancelled = false;

    (async () => {
      if (!cancelled) await acquire(activeKey);
    })();

    return () => {
      cancelled = true;
      release(activeKey);
    };
  }, [activeKey, acquire, release]);

  const state = activeKey ? getScopeState(activeKey) : null;
  return {
    scopeKey: activeKey,
    readOnly: Boolean(state?.readOnly),
    holding: state?.status === 'holding',
    blocked: state?.status === 'blocked',
    holderName: state?.holderName || state?.lock?.holderName || null,
    lock: state?.lock || null,
    message: state?.message || null,
  };
}
