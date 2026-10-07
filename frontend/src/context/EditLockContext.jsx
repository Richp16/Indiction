import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth, registerLogoutLockRelease } from './AuthContext';
import { apiGet, apiPost } from '../api/client';

const HEARTBEAT_MS = 30_000;
const STATUS_POLL_MS = 15_000;

const EditLockContext = createContext(null);

export function EditLockProvider({ children }) {
  const { token, user } = useAuth();
  const [isEditor, setIsEditor] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(token);
  const isEditorRef = useRef(false);
  tokenRef.current = token;
  isEditorRef.current = isEditor;

  const applyResult = useCallback((data) => {
    const nextIsEditor = Boolean(data?.isEditor);
    setIsEditor(nextIsEditor);
    isEditorRef.current = nextIsEditor;
    setEditingUser(nextIsEditor ? null : data?.editingUser || null);
  }, []);

  const release = useCallback(async () => {
    const authToken = tokenRef.current;
    setIsEditor(false);
    isEditorRef.current = false;
    setEditingUser(null);
    if (!authToken) return;
    try {
      await apiPost('/api/edit-lock/release', {}, authToken);
    } catch {
      // Best-effort; timeout clears abandoned locks.
    }
  }, []);

  useEffect(() => {
    registerLogoutLockRelease(release);
    return () => registerLogoutLockRelease(null);
  }, [release]);

  const acquire = useCallback(async () => {
    if (!tokenRef.current || !user?.id) {
      setIsEditor(false);
      setEditingUser(null);
      return { isEditor: false };
    }
    try {
      const data = await apiPost('/api/edit-lock/acquire', {}, tokenRef.current);
      applyResult(data);
      return data;
    } catch (error) {
      if (error.status === 423) {
        const editing =
          error.editingUser ||
          error.lock?.editingUser || {
            name: error.lock?.holderName || 'another user',
            role: error.lock?.holderRole || null,
            userId: error.lock?.holderUserId || null,
          };
        applyResult({ isEditor: false, editingUser: editing });
        return { isEditor: false, editingUser: editing };
      }
      setIsEditor(false);
      setEditingUser(null);
      return { isEditor: false, error };
    }
  }, [applyResult, user?.id]);

  const heartbeat = useCallback(async () => {
    if (!tokenRef.current || !isEditorRef.current) return;
    try {
      const data = await apiPost('/api/edit-lock/heartbeat', {}, tokenRef.current);
      applyResult(data);
    } catch (error) {
      if (error.status === 403 || error.status === 423) {
        applyResult({
          isEditor: false,
          editingUser: error.lock?.editingUser || {
            name: error.lock?.holderName || 'another user',
            role: error.lock?.holderRole || null,
          },
        });
      }
    }
  }, [applyResult]);

  const pollStatus = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const data = await apiGet('/api/edit-lock/status', tokenRef.current);
      if (data.isEditor) {
        applyResult(data);
        return;
      }
      if (!data.editingUser && !data.lock) {
        // Free — try to claim.
        await acquire();
        return;
      }
      applyResult(data);
    } catch {
      // ignore poll errors
    }
  }, [acquire, applyResult]);

  useEffect(() => {
    if (!token || !user?.id) {
      setIsEditor(false);
      setEditingUser(null);
      setReady(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      await acquire();
      if (!cancelled) setReady(true);
    })();

    const heartbeatId = setInterval(() => {
      if (isEditorRef.current) heartbeat();
    }, HEARTBEAT_MS);

    const pollId = setInterval(() => {
      if (!isEditorRef.current) pollStatus();
    }, STATUS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeatId);
      clearInterval(pollId);
    };
  }, [token, user?.id, acquire, heartbeat, pollStatus]);

  const value = {
    ready,
    isEditor,
    isLockHolder: isEditor,
    readOnly: ready ? !isEditor : true,
    editingUser,
    acquire,
    acquireLock: acquire,
    release,
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
