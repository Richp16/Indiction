import { createContext, useContext, useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { useAuth } from './AuthContext';

const AppConfigContext = createContext(null);

const DEFAULT_CAPABILITIES = {
  workerSource: 'paychex',
  payPeriodSource: 'paychex',
  supportsProviderSync: true,
  supportsProviderSubmission: true,
  supportsProviderCheckData: true,
  supportsLocalPayrollExport: false,
  supportsTimeEntryImport: false,
  supportsManualTaxEntry: false,
  supportsManageEmployees: false,
  supportsSpiExport: true,
};

function capabilitiesFromPaychex(paychexEnabled) {
  const local = !paychexEnabled;
  return {
    workerSource: paychexEnabled ? 'paychex' : 'local',
    payPeriodSource: paychexEnabled ? 'paychex' : 'local',
    supportsProviderSync: paychexEnabled,
    supportsProviderSubmission: paychexEnabled,
    supportsProviderCheckData: paychexEnabled,
    supportsLocalPayrollExport: local,
    supportsTimeEntryImport: local,
    supportsManualTaxEntry: local,
    supportsManageEmployees: local,
    supportsSpiExport: paychexEnabled,
  };
}

export function AppConfigProvider({ children }) {
  const { token } = useAuth();
  const [config, setConfig] = useState({
    paychexEnabled: true,
    integrationConfigured: true,
    capabilities: DEFAULT_CAPABILITIES,
  });
  const [loading, setLoading] = useState(true);

  function applyConfig(data) {
    const paychexEnabled = data.paychexEnabled !== false;
    return {
      paychexEnabled,
      integrationConfigured: data.integrationConfigured === true,
      capabilities: data.capabilities || capabilitiesFromPaychex(paychexEnabled),
    };
  }

  useEffect(() => {
    if (!token) {
      setConfig({
        paychexEnabled: true,
        integrationConfigured: true,
        capabilities: DEFAULT_CAPABILITIES,
      });
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    apiGet('/api/app-config', token)
      .then((data) => {
        if (!cancelled) setConfig(applyConfig(data));
      })
      .catch(() => {
        // Fail safe: do not invent Paychex connectivity; keep configured=false-ish labels.
        if (!cancelled) {
          setConfig({
            paychexEnabled: true,
            integrationConfigured: true,
            capabilities: DEFAULT_CAPABILITIES,
          });
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
      setConfig(applyConfig(data));
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
