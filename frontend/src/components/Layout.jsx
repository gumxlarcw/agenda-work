import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AutomationWidget from './AutomationWidget';
import NotificationBell from './NotificationBell';
import {
  HiOutlineHome,
  HiOutlineClipboardList,
  HiOutlineDocumentText,
  HiOutlineBell,
  HiOutlineUsers,
  HiOutlineLogout,
  HiOutlineMenu,
  HiOutlineX,
  HiOutlineChat,
  HiOutlineCalendar,
  HiOutlineCog,
  HiOutlineLightningBolt,
  HiOutlineChevronLeft,
  HiOutlineMicrophone,
} from 'react-icons/hi';

/* ── Branding SVG Icon ─────────────────────────── */
function BrandIcon({ collapsed }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`transition-all duration-300 ${collapsed ? 'w-8 h-8' : 'w-9 h-9'}`}
    >
      {/* Rounded rectangle base */}
      <rect x="2" y="4" width="32" height="28" rx="6" fill="url(#brandGrad)" />
      {/* Calendar top bar */}
      <rect x="2" y="4" width="32" height="9" rx="6" fill="url(#brandGradTop)" />
      <rect x="2" y="10" width="32" height="3" fill="url(#brandGradTop)" />
      {/* Calendar pins */}
      <rect x="10" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
      <rect x="23" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
      {/* Check mark */}
      <path d="M12 21L16 25L25 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      {/* Gradients */}
      <defs>
        <linearGradient id="brandGrad" x1="2" y1="4" x2="34" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="brandGradTop" x1="2" y1="4" x2="34" y2="13" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Nav config (reordered) ───────────────────── */
const navItems = [
  { path: '/dashboard', name: 'Dashboard', icon: HiOutlineHome },
  { path: '/timeline', name: 'Timeline', icon: HiOutlineCalendar },
  { path: '/tasks', name: 'Tasks', icon: HiOutlineClipboardList },
  { path: '/notes', name: 'Notes', icon: HiOutlineDocumentText },
  { path: '/reminders', name: 'Reminders', icon: HiOutlineBell },
  { path: '/automation', name: 'Automation', icon: HiOutlineLightningBolt },
  { path: '/notulen', name: 'Notulen AI', icon: HiOutlineMicrophone },
];

const adminNavItems = [
  { path: '/users', name: 'Users', icon: HiOutlineUsers, adminOnly: true },
  { path: '/whatsapp', name: 'WhatsApp', icon: HiOutlineChat, adminOnly: true },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const allNavItems = isAdmin ? [...navItems, ...adminNavItems] : navItems;
  const sidebarWidth = collapsed ? 'w-[72px]' : 'w-64';
  const mainMargin = collapsed ? 'lg:ml-[72px]' : 'lg:ml-64';

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-20 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ══════ Sidebar ══════ */}
      <aside className={`
        sidebar-gradient
        fixed top-0 left-0 z-30 h-full ${sidebarWidth}
        transform transition-all duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
        flex flex-col
      `}>
        {/* Frosted overlay */}
        <div className="absolute inset-0 sidebar-frost pointer-events-none" />

        {/* ── Logo header ── */}
        <div className="relative flex-shrink-0">
          <div className={`flex items-center ${collapsed ? 'flex-col gap-1.5 py-3 px-2' : 'h-16 px-4'}`}>
            {collapsed ? (
              <>
                <NavLink to="/dashboard" className="flex items-center justify-center" onClick={() => setSidebarOpen(false)}>
                  <BrandIcon collapsed={collapsed} />
                </NavLink>
                <NotificationBell collapsed={true} />
              </>
            ) : (
              <div className="flex items-center justify-between w-full">
                <NavLink to="/dashboard" className="flex items-center gap-3 min-w-0 flex-1" onClick={() => setSidebarOpen(false)}>
                  <BrandIcon collapsed={collapsed} />
                  <div className="min-w-0">
                    <h1 className="text-[15px] font-bold text-white tracking-tight leading-none">
                      Agenda Work
                    </h1>
                    <span className="text-[10px] font-medium text-indigo-300/50 tracking-wide">
                      Team Workspace
                    </span>
                  </div>
                </NavLink>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <NotificationBell collapsed={false} />
                  <button
                    className="lg:hidden p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <HiOutlineX className="w-5 h-5 text-white/70" />
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Bottom glow line */}
          <div className="h-px bg-gradient-to-r from-transparent via-indigo-400/30 to-transparent" />
        </div>

        {/* ── Section label ── */}
        {!collapsed && (
          <div className="px-5 pt-4 pb-1">
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em]">Main</p>
          </div>
        )}

        {/* ── Navigation ── */}
        <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${collapsed ? 'px-2 pt-3' : 'px-3'} space-y-0.5 sidebar-nav-scroll`}>
          {allNavItems.map((item, idx) => {
            // Insert admin section separator
            const isFirstAdmin = isAdmin && item.adminOnly && (idx === 0 || !allNavItems[idx - 1]?.adminOnly);
            return (
              <div key={item.path}>
                {isFirstAdmin && (
                  <div className={`${collapsed ? 'my-3 mx-1' : 'my-3 mx-2'}`}>
                    <div className="h-px bg-white/10" />
                    {!collapsed && (
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] mt-3">Admin</p>
                    )}
                  </div>
                )}
                <NavLink
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => `
                    sidebar-nav-item group relative flex items-center ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
                    rounded-xl transition-all duration-200
                    ${isActive
                      ? 'sidebar-nav-active bg-white/15 text-white shadow-lg shadow-black/10'
                      : 'text-indigo-100/70 hover:bg-white/8 hover:text-white'}
                  `}
                >
                  {({ isActive }) => (
                    <>
                      {/* Active indicator bar */}
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-white rounded-r-full sidebar-active-indicator" />
                      )}
                      <item.icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`} />
                      {!collapsed && (
                        <>
                          <span className={`text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.name}</span>
                          {item.adminOnly && (
                            <span className="ml-auto text-[9px] font-bold bg-amber-400/20 text-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                              Admin
                            </span>
                          )}
                        </>
                      )}
                      {/* Tooltip for collapsed mode */}
                      {collapsed && (
                        <span className="sidebar-tooltip absolute left-full ml-3 px-2.5 py-1 text-xs font-medium text-white bg-gray-900 rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                          {item.name}
                          {item.adminOnly && <span className="text-amber-300 ml-1">(Admin)</span>}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </div>
            );
          })}
        </nav>

        {/* ── User section ── */}
        <div className={`relative flex-shrink-0 ${collapsed ? 'px-2 pb-3' : 'px-3 pb-4'}`}>
          <div className="h-px bg-white/10 mb-3" />

          {collapsed ? (
            /* Collapsed: avatar only with tooltip */
            <div className="flex flex-col items-center gap-1.5">
              <NavLink
                to="/settings"
                onClick={() => setSidebarOpen(false)}
                className="group relative w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <span className="text-sm font-bold text-white/90">
                  {(user?.name || user?.username || '?').charAt(0).toUpperCase()}
                </span>
                <span className="sidebar-tooltip absolute left-full ml-3 px-2.5 py-1.5 text-xs text-white bg-gray-900 rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                  {user?.name || user?.username}
                  {user?.tim && <span className="block text-indigo-300 text-[10px]">{user.tim}</span>}
                </span>
              </NavLink>
              <button
                onClick={handleLogout}
                className="group relative p-2 rounded-xl text-red-300/60 hover:text-red-300 hover:bg-red-400/10 transition-colors"
              >
                <HiOutlineLogout className="w-4 h-4" />
                <span className="sidebar-tooltip absolute left-full ml-3 px-2.5 py-1 text-xs text-white bg-gray-900 rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                  Logout
                </span>
              </button>
            </div>
          ) : (
            /* Expanded: full user card */
            <>
              <div className="flex items-center gap-3 mb-3 px-1">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 ring-1 ring-white/10">
                  <span className="text-sm font-bold text-white/90">
                    {(user?.name || user?.username || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90 truncate">{user?.name || user?.username}</p>
                  {user?.tim && (
                    <p className="text-[10px] font-medium text-indigo-200/50 truncate">{user.tim}</p>
                  )}
                </div>
              </div>

              <div className="space-y-0.5">
                <NavLink
                  to="/settings"
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => `flex items-center gap-2.5 w-full px-3 py-2 text-sm rounded-xl transition-all duration-200 ${
                    isActive ? 'bg-white/12 text-white font-medium' : 'text-indigo-100/50 hover:bg-white/8 hover:text-white/80'
                  }`}
                >
                  <HiOutlineCog className="w-4 h-4" />
                  <span>Settings</span>
                </NavLink>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-300/60 hover:text-red-300 hover:bg-red-400/10 rounded-xl transition-all duration-200"
                >
                  <HiOutlineLogout className="w-4 h-4" />
                  <span>Logout</span>
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Collapse toggle: floating pill on sidebar edge (desktop only) ── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`
          sidebar-collapse-btn
          hidden lg:flex items-center justify-center
          fixed top-1/2 -translate-y-1/2 z-30
          w-5 h-10 rounded-r-lg
          bg-indigo-900/80 hover:bg-indigo-800
          border border-l-0 border-white/10
          text-white/50 hover:text-white
          shadow-md hover:shadow-lg
          transition-all duration-300
        `}
        style={{ left: collapsed ? '72px' : '256px' }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <HiOutlineChevronLeft className={`w-3 h-3 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
      </button>

      {/* ══════ Main content ══════ */}
      <div className={`${mainMargin} transition-all duration-300 min-h-screen flex flex-col`}>
        {/* Mobile menu button */}
        <button
          className="lg:hidden fixed top-3 left-3 z-20 p-2.5 bg-white/90 backdrop-blur-sm shadow-lg shadow-black/5 rounded-xl hover:bg-white transition-colors"
          onClick={() => setSidebarOpen(true)}
        >
          <HiOutlineMenu className="w-5 h-5 text-gray-700" />
        </button>

        {/* Page content */}
        <main className="px-4 pt-4 lg:px-6 lg:pt-6 flex-1">
          <Outlet />
        </main>

        {/* Copyright footer — always at bottom, symmetric gap */}
        <footer className="py-2 text-center flex-shrink-0">
          <p className="text-[11px] text-gray-400">
            &copy; {new Date().getFullYear()} BPS Provinsi Maluku Utara
          </p>
        </footer>
      </div>

      {/* Floating automation widget */}
      <AutomationWidget />
    </div>
  );
}
