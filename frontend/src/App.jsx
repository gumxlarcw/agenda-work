import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './context/AuthContext';
import { AutomationRunProvider } from './context/AutomationRunContext';

// Eager: auth pages + layout (needed immediately)
import Login from './pages/Login';
import Register from './pages/Register';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy with auto-reload on chunk load failure (stale cache after rebuild)
function lazyWithRetry(importFn) {
  return lazy(() =>
    importFn().catch((err) => {
      // If chunk failed to load and we haven't reloaded yet, do a full reload
      const reloadedKey = 'chunk_reload_' + window.location.pathname;
      if (!sessionStorage.getItem(reloadedKey)) {
        sessionStorage.setItem(reloadedKey, '1');
        window.location.reload();
        return new Promise(() => {}); // never resolves — page is reloading
      }
      // Already reloaded once, let ErrorBoundary handle it
      sessionStorage.removeItem(reloadedKey);
      throw err;
    })
  );
}

// Lazy: all protected pages
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Tasks = lazyWithRetry(() => import('./pages/Tasks'));
const Notes = lazyWithRetry(() => import('./pages/Notes'));
const Reminders = lazyWithRetry(() => import('./pages/Reminders'));
const Users = lazyWithRetry(() => import('./pages/Users'));
const Settings = lazyWithRetry(() => import('./pages/Settings'));
const WhatsApp = lazyWithRetry(() => import('./pages/WhatsApp'));
const Timeline = lazyWithRetry(() => import('./pages/Timeline'));
const Automation = lazyWithRetry(() => import('./pages/Automation'));
const NotulenAI = lazyWithRetry(() => import('./pages/NotulenAI'));
const PublicNoteViewer = lazyWithRetry(() => import('./pages/PublicNoteViewer'));
const PublicNotulenViewer = lazyWithRetry(() => import('./pages/PublicNotulenViewer'));

// Protected Route component
const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { isAuthenticated, loading, isAdmin } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

// Public Route component (redirect to dashboard if already logged in)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  return (
    <>
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#333',
            color: '#fff',
          },
          success: {
            style: {
              background: '#10b981',
            },
          },
          error: {
            style: {
              background: '#ef4444',
            },
          },
        }}
      />
      
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        } />
        <Route path="/register" element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        } />

        {/* Public Note/Folder Viewer (no auth) */}
        <Route path="/public/n/:token" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><PublicNoteViewer /></Suspense></ErrorBoundary>} />
        <Route path="/public/f/:token" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><PublicNoteViewer /></Suspense></ErrorBoundary>} />
        <Route path="/notulen/shared/:token" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><PublicNotulenViewer /></Suspense></ErrorBoundary>} />

        {/* Protected Routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <AutomationRunProvider>
              <Layout />
            </AutomationRunProvider>
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Dashboard /></Suspense></ErrorBoundary>} />
          <Route path="tasks" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Tasks /></Suspense></ErrorBoundary>} />
          <Route path="notes" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Notes /></Suspense></ErrorBoundary>} />
          <Route path="reminders" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Reminders /></Suspense></ErrorBoundary>} />
          <Route path="change-password" element={<Navigate to="/settings" replace />} />
          <Route path="settings" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Settings /></Suspense></ErrorBoundary>} />
          <Route path="timeline" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Timeline /></Suspense></ErrorBoundary>} />
          <Route path="automation" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Automation /></Suspense></ErrorBoundary>} />
          <Route path="notulen" element={<ErrorBoundary><Suspense fallback={<LoadingSpinner />}><NotulenAI /></Suspense></ErrorBoundary>} />

          {/* Admin Only Routes */}
          <Route path="users" element={
            <ProtectedRoute adminOnly>
              <ErrorBoundary><Suspense fallback={<LoadingSpinner />}><Users /></Suspense></ErrorBoundary>
            </ProtectedRoute>
          } />
          <Route path="whatsapp" element={
            <ProtectedRoute adminOnly>
              <ErrorBoundary><Suspense fallback={<LoadingSpinner />}><WhatsApp /></Suspense></ErrorBoundary>
            </ProtectedRoute>
          } />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

export default App;
