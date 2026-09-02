import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppConfigProvider } from './context/AppConfigContext';
import { EditLockProvider } from './context/EditLockContext';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppConfigProvider>
          <EditLockProvider>
            <App />
          </EditLockProvider>
        </AppConfigProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
