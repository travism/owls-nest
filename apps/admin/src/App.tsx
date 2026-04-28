import { Routes, Route } from 'react-router-dom';
import { AuthBoundary } from './auth/AuthBoundary';
import { LoginPage } from './pages/Login';
import { TotpPage } from './pages/Totp';
import { RecoveryPage } from './pages/Recovery';
import { SetupPage } from './pages/Setup';
import { DashboardPage } from './pages/Dashboard';
import { PropertySettingsPage } from './pages/PropertySettings';
import { BlockedDatesPage } from './pages/BlockedDates';
import { InquiriesPage } from './pages/Inquiries';
import { BookingsPage } from './pages/Bookings';
import { BookingDetailPage } from './pages/BookingDetail';
import { OutboxHealthPage } from './pages/OutboxHealth';

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
      <Route
        path="/property"
        element={
          <AuthBoundary>
            <PropertySettingsPage />
          </AuthBoundary>
        }
      />
      <Route
        path="/blocked-dates"
        element={
          <AuthBoundary>
            <BlockedDatesPage />
          </AuthBoundary>
        }
      />
      <Route
        path="/inquiries"
        element={
          <AuthBoundary>
            <InquiriesPage />
          </AuthBoundary>
        }
      />
      <Route
        path="/bookings"
        element={
          <AuthBoundary>
            <BookingsPage />
          </AuthBoundary>
        }
      />
      <Route
        path="/bookings/:id"
        element={
          <AuthBoundary>
            <BookingDetailPage />
          </AuthBoundary>
        }
      />
      <Route
        path="/outbox"
        element={
          <AuthBoundary>
            <OutboxHealthPage />
          </AuthBoundary>
        }
      />
    </Routes>
  );
}
