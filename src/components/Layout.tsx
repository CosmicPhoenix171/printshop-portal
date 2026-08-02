import {
  Bell,
  Boxes,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Factory,
  FilePlus2,
  Gauge,
  House,
  LogOut,
  MessageSquarePlus,
  PackageSearch,
  Palette,
  Printer,
  Settings2,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const customerLinks: Array<[string, string, LucideIcon]> = [
  ['/', 'Overview', House],
  ['/orders/new', 'New print request', FilePlus2],
  ['/orders', 'Orders', ClipboardList],
  ['/colors', 'Materials and colors', Palette],
  ['/color-requests', 'Color requests', MessageSquarePlus],
  ['/balance', 'Balance', CircleDollarSign],
  ['/notifications', 'Notifications', Bell],
  ['/profile', 'Profile', UserRound],
] as const;

const adminLinks: Array<[string, string, LucideIcon]> = [
  ['/admin', 'Admin overview', Gauge],
  ['/admin/orders', 'Manage orders', Settings2],
  ['/admin/inventory', 'Inventory', Boxes],
  ['/admin/customers', 'Customers and balances', UsersRound],
  ['/admin/color-requests', 'Requested colors', PackageSearch],
  ['/admin/print-queue', 'Print queue', Factory],
  ['/admin/printers', 'Printers', Printer],
  ['/admin/reports', 'Reports', ChartNoAxesCombined],
] as const;

export function Layout() {
  const { profile, user, isAdmin, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-brand">
          <div className="brand-symbol"><Printer size={21} strokeWidth={2.2} /></div>
          <div><strong>PrintShop</strong><span>Production portal</span></div>
        </div>
        <nav>
          <div className="nav-heading">Workspace</div>
          {customerLinks.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={18} /><span>{label}</span><ChevronRight className="nav-chevron" size={15} />
            </NavLink>
          ))}
          {isAdmin && <div className="nav-heading">Administration</div>}
          {isAdmin && adminLinks.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/admin'}>
              <Icon size={18} /><span>{label}</span><ChevronRight className="nav-chevron" size={15} />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot"><span>PLA</span><span>PETG</span><small>Materials online</small></div>
      </aside>

      <header className="topbar">
        <div className="topbar-context">
          <span className="system-dot" />
          <span>Production workspace</span>
        </div>
        <div className="topbar-user">
          <div className="user-avatar">{(profile?.displayName ?? user?.email ?? 'U').charAt(0).toUpperCase()}</div>
          <div className="user-copy"><strong>{profile?.displayName ?? 'Customer'}</strong><span>{isAdmin ? 'Administrator' : user?.email}</span></div>
          <button className="icon-button topbar-logout" onClick={() => void logout()} title="Log out" aria-label="Log out"><LogOut size={18} /></button>
        </div>
      </header>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
