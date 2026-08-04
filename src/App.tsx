import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { RequireAdmin, RequireAuth } from './components/RouteGuards';
import { ForgotPasswordPage, LoginPage, RegisterPage } from './pages/AuthPages';
import {
  BalancePage,
  ColorRequestsPage,
  ColorsPage,
  CustomerDashboard,
  NewOrderPage,
  NotificationsPage,
  OrderDetailPage,
  OrdersPage,
  ProfilePage,
  SharedImagesPage,
} from './pages/CustomerPages';
import {
  AdminColorRequestsPage,
  AdminCustomersPage,
  AdminInventoryPage,
  AdminImagesPage,
  AdminOrdersPage,
  AdminPrintQueuePage,
  AdminPrintersPage,
  AdminReportsPage,
} from './pages/AdminPages';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<CustomerDashboard />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/new" element={<NewOrderPage />} />
              <Route path="orders/:id" element={<OrderDetailPage />} />
              <Route path="colors" element={<ColorsPage />} />
              <Route path="color-requests" element={<ColorRequestsPage />} />
              <Route path="balance" element={<BalancePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="images" element={<SharedImagesPage />} />
              <Route path="profile" element={<ProfilePage />} />

              <Route element={<RequireAdmin />}>
                <Route path="admin" element={<Navigate to="/admin/orders" replace />} />
                <Route path="admin/orders" element={<AdminOrdersPage />} />
                <Route path="admin/inventory" element={<AdminInventoryPage />} />
                <Route path="admin/customers" element={<AdminCustomersPage />} />
                <Route path="admin/color-requests" element={<AdminColorRequestsPage />} />
                <Route path="admin/print-queue" element={<AdminPrintQueuePage />} />
                <Route path="admin/printers" element={<AdminPrintersPage />} />
                <Route path="admin/images" element={<AdminImagesPage />} />
                <Route path="admin/reports" element={<AdminReportsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
