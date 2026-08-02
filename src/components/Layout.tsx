import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const customerLinks = [
  ['/', 'Overview'],
  ['/orders/new', 'New print request'],
  ['/orders', 'Orders'],
  ['/colors', 'Materials and colors'],
  ['/color-requests', 'Color requests'],
  ['/balance', 'Balance'],
  ['/notifications', 'Notifications'],
  ['/profile', 'Profile'],
] as const;

const adminLinks = [
  ['/admin', 'Admin overview'],
  ['/admin/orders', 'Manage orders'],
  ['/admin/inventory', 'Inventory'],
  ['/admin/customers', 'Customers and balances'],
  ['/admin/color-requests', 'Requested colors'],
  ['/admin/print-queue', 'Print queue'],
  ['/admin/printers', 'Printers'],
  ['/admin/reports', 'Reports'],
] as const;

export function Layout() {
  const { profile, user, isAdmin, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>PrintShop Portal</strong>
          <span className="topbar-subtitle">PLA and PETG printing</span>
        </div>
        <div className="topbar-user">
          <span>{profile?.displayName ?? user?.email}</span>
          <button className="button button-secondary" onClick={() => void logout()}>Log out</button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Primary navigation">
        <nav>
          {customerLinks.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>
          ))}
          {isAdmin && <div className="nav-heading">Administration</div>}
          {isAdmin && adminLinks.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/admin'}>{label}</NavLink>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
