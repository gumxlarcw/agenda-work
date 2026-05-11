import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { dashboardAPI } from '../services/api';
import { DEFAULT_LAYOUTS } from '../components/dashboard/defaultLayout';

export default function useDashboardLayout() {
  const [layouts, setLayouts] = useState(DEFAULT_LAYOUTS);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const saveTimerRef = useRef(null);
  const isInitialMount = useRef(true);

  // Load saved layout on mount. If the saved state is missing any widget
  // that exists in DEFAULT_LAYOUTS (e.g. a widget was added back after a
  // previous save scrubbed it), splice it in from defaults so the dashboard
  // still renders every expected widget.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await dashboardAPI.getLayout();
        if (!cancelled && res.data?.data) {
          const saved = res.data.data;
          const merged = {};
          for (const bp of Object.keys(DEFAULT_LAYOUTS)) {
            const savedItems = Array.isArray(saved[bp]) ? saved[bp] : [];
            const savedIds = new Set(savedItems.map(i => i.i));
            const missing = DEFAULT_LAYOUTS[bp].filter(i => !savedIds.has(i.i));
            merged[bp] = [...savedItems, ...missing];
          }
          // Preserve any extra breakpoints the saved layout had (e.g. md).
          for (const bp of Object.keys(saved)) {
            if (!merged[bp]) merged[bp] = saved[bp];
          }
          setLayouts(merged);
        }
      } catch {
        // 404 = no saved layout, use defaults — ignore
      } finally {
        if (!cancelled) setLayoutLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save to backend. Toast on failure so the user knows their
  // latest drag didn't persist — otherwise they'd refresh and silently
  // lose the new arrangement.
  const saveLayout = useCallback((newLayouts) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await dashboardAPI.saveLayout(newLayouts);
      } catch (err) {
        console.error('Failed to save layout:', err);
        toast.error('Gagal menyimpan tata letak dashboard');
      }
    }, 1000);
  }, []);

  // Called by react-grid-layout on every drag/resize
  const onLayoutChange = useCallback((_currentLayout, allLayouts) => {
    // Skip the initial mount callback — RGL fires this on first render
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setLayouts(allLayouts);
    saveLayout(allLayouts);
  }, [saveLayout]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { layouts, layoutLoading, onLayoutChange };
}
