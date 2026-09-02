import { createContext, useContext, useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { useAuth } from './AuthContext';

const AppConfigContext = createContext(null);

export function AppConfigProvider({ children }) {
  const { token } = useAuth();
  const [config, setConfig] = useState({
    paychexEnabled: true,
    integrationConfigured: true,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setConfig({ paychexEnabled: true, integrationConfigured: true });
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    apiGet('/api/app-config', token)
      .then((data) => {
        if (!cancelled) {
          setConfig({
            paychexEnabled: data.paychexEnabled !== false,
            integrationConfigured: data.integrationConfigured === true,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({ paychexEnabled: true, integrationConfigured: true });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  function refreshConfig() {
    if (!token) return Promise.resolve();
    return apiGet('/api/app-config', token).then((data) => {
      setConfig({
        paychexEnabled: data.paychexEnabled !== false,
        integrationConfigured: data.integrationConfigured === true,
      });
    });
  }

  return (
    <AppConfigContext.Provider
      value={{
        ...config,
        loading,
        refreshConfig,
      }}
    >
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error('useAppConfig must be used within AppConfigProvider');
  }
  return context;
}
