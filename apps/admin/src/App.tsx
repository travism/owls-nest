import { Routes, Route } from 'react-router-dom';
import { AuthBoundary } from './auth/AuthBoundary';
import { LoginPage } from './pages/Login';
import { TotpPage } from './pages/Totp';
import { RecoveryPage } from './pages/Recovery';
import { SetupPage } from './pages/Setup';
import { DashboardPage } from './pages/Dashboard';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/totp" element={<TotpPage />} />
      <Route path="/login/recovery" element={<RecoveryPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/"
        element={
          <AuthBoundary>
            <DashboardPage />
          </AuthBoundary>
        }
      />
    </Routes>
  );
}
