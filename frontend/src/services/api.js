import axios from 'axios';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.PROD
  ? 'https://api-agenda.bpsmalut.com/api'
  : '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Token refresh dedup — prevents multiple concurrent refreshes
let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onTokenRefreshed = (token) => {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
};
const onRefreshFailed = (err) => {
  refreshSubscribers.forEach(cb => cb(null, err));
  refreshSubscribers = [];
};

// Decode JWT exp without a library
function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
}

async function doRefresh() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('No refresh token');
  const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
  const { accessToken, refreshToken: newRefreshToken } = response.data.data;
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', newRefreshToken);
  return accessToken;
}

// Request interceptor — proactively refresh if token is expired/about-to-expire
// This prevents 401 console noise: requests never go out with a stale token.
api.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('accessToken');
    if (token) {
      const expiry = getTokenExpiry(token);
      // Refresh if already expired or expires within 30 seconds
      if (expiry && Date.now() > expiry - 30000) {
        if (isRefreshing) {
          // Wait for the ongoing refresh to complete
          token = await new Promise((resolve, reject) => {
            subscribeTokenRefresh((newToken, err) => {
              if (err) reject(err);
              else resolve(newToken);
            });
          });
        } else {
          isRefreshing = true;
          try {
            token = await doRefresh();
            onTokenRefreshed(token);
          } catch (err) {
            onRefreshFailed(err);
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            window.location.href = '/login';
            return Promise.reject(err);
          } finally {
            isRefreshing = false;
          }
        }
      }
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Dedup so a burst of parallel 403s fires only one redirect + one toast.
let passwordChangeRedirected = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // /settings renders the change-password UI when user.must_change_password is true.
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED'
    ) {
      if (!passwordChangeRedirected) {
        passwordChangeRedirected = true;
        try {
          const stored = JSON.parse(localStorage.getItem('user') || 'null');
          if (stored) {
            stored.must_change_password = true;
            localStorage.setItem('user', JSON.stringify(stored));
          }
        } catch { /* ignore parse errors */ }
        toast.error('Anda harus mengganti password sebelum melanjutkan', {
          id: 'pwd-change-required',
        });
        if (window.location.pathname !== '/settings') {
          window.location.href = '/settings';
        }
      }
      return Promise.reject(error);
    }

    // Catch generic 401 OR the explicit TOKEN_EXPIRED contract from
    // auth.middleware.js. The code check guards against a future backend
    // change that returns TOKEN_EXPIRED with a non-401 status.
    const isAuthExpired =
      error.response?.status === 401 ||
      error.response?.data?.code === 'TOKEN_EXPIRED';
    if (isAuthExpired && !originalRequest._retry) {
      originalRequest._retry = true;

      // If already refreshing, queue this request to retry after refresh completes
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh((token, err) => {
            if (err) return reject(err);
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const accessToken = await doRefresh();
        onTokenRefreshed(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        onRefreshFailed(refreshError);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  getMe: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  updateProfile: (data) => api.put('/auth/update-profile', data),
};

// Tasks API
export const tasksAPI = {
  getAll: (params) => api.get('/tasks', { params }),
  getOne: (id) => api.get(`/tasks/${id}`),
  create: (data) => api.post('/tasks', data),
  update: (id, data) => api.put(`/tasks/${id}`, data),
  delete: (id) => api.delete(`/tasks/${id}`),
  getStats: () => api.get('/tasks/stats/summary'),
  getUserStats: () => api.get('/tasks/stats/by-user'),
  getHeatmapData: (months = 6) => api.get('/tasks/stats/heatmap', { params: { months } }),
};

// Notes API
export const notesAPI = {
  getAll: (params) => api.get('/notes', { params }),
  getCounts: () => api.get('/notes/counts'),
  getOne: (id) => api.get(`/notes/${id}`),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.put(`/notes/${id}`, data),
  delete: (id) => api.delete(`/notes/${id}`),
  archive: (id) => api.patch(`/notes/${id}/archive`),
  share: (id, userIds, roles) => api.patch(`/notes/${id}/share`, { user_ids: userIds, roles }),
  summarize: (id) => api.post(`/notes/${id}/summarize`),
  lock: (id, force = false) => api.patch(`/notes/${id}/lock`, { force }),
  unlock: (id) => api.patch(`/notes/${id}/unlock`),
  uploadAttachment: (id, formData) => api.post(`/notes/${id}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteAttachment: (attachId) => api.delete(`/notes/attachments/${attachId}`),
  getRecent: (limit = 3) => api.get('/notes/recent', { params: { limit } }),
  reorder: (orderedIds) => api.patch('/notes/reorder', { orderedIds }),
  updatePosition: (id, position_x, position_y, card_width, card_height) => api.patch(`/notes/${id}/position`, { position_x, position_y, card_width, card_height }),
  syncPositions: (positions, widths, heights) => api.put('/notes/positions/bulk', { positions, widths, heights }),
};

export const noteFoldersAPI = {
  getAll: () => api.get('/notes/folders'),
  create: (data) => api.post('/notes/folders', data),
  update: (id, data) => api.put(`/notes/folders/${id}`, data),
  delete: (id) => api.delete(`/notes/folders/${id}`),
  getSharedWithMe: () => api.get('/notes/folders/shared-with-me'),
  share: (id, user_ids, role = 'editor') => api.post(`/notes/folders/${id}/share`, { user_ids, role }),
  getShares: (id) => api.get(`/notes/folders/${id}/shares`),
  removeShare: (folderId, userId) => api.delete(`/notes/folders/${folderId}/share/${userId}`),
};

export const noteTagsAPI = {
  getAll: () => api.get('/notes/tags'),
  create: (data) => api.post('/notes/tags', data),
  update: (id, data) => api.put(`/notes/tags/${id}`, data),
  delete: (id) => api.delete(`/notes/tags/${id}`),
};

export const noteConnectionsAPI = {
  getAll: (params) => api.get('/notes/connections/list', { params }),
  create: (data) => api.post('/notes/connections', data),
  update: (id, data) => api.put(`/notes/connections/${id}`, data),
  delete: (id) => api.delete(`/notes/connections/${id}`),
};

export const notePublicShareAPI = {
  create: (data) => api.post('/notes/public-share', data),
  list: () => api.get('/notes/public-share/list'),
  toggle: (id) => api.put(`/notes/public-share/${id}/toggle`),
  delete: (id) => api.delete(`/notes/public-share/${id}`),
  // Public viewer (no auth needed) — uses plain axios to skip auth interceptor
  getPublic: (token) => axios.get(`${API_URL}/notes/public/${token}`),
};

export const noteTemplatesAPI = {
  getAll: () => api.get('/notes/templates'),
  create: (data) => api.post('/notes/templates', data),
  delete: (id) => api.delete(`/notes/templates/${id}`),
};

// Reminders API
export const remindersAPI = {
  getAll: (params) => api.get('/reminders', { params }),
  getUpcoming: () => api.get('/reminders/upcoming'),
  getOne: (id) => api.get(`/reminders/${id}`),
  create: (data) => api.post('/reminders', data),
  update: (id, data) => api.put(`/reminders/${id}`, data),
  complete: (id) => api.patch(`/reminders/${id}/complete`),
  delete: (id) => api.delete(`/reminders/${id}`),
};

// Todos API
export const todosAPI = {
  getAll: (params) => api.get('/todos', { params }),
  getOne: (id) => api.get(`/todos/${id}`),
  create: (data) => api.post('/todos', data),
  update: (id, data) => api.put(`/todos/${id}`, data),
  toggle: (id) => api.patch(`/todos/${id}/toggle`),
  delete: (id) => api.delete(`/todos/${id}`),
  deleteCompleted: () => api.delete('/todos/completed/all'),
};

// Events API (team-scoped timeline events, formerly kegiatan)
export const eventsAPI = {
  getAll: (params) => api.get('/events', { params }),
  getOne: (id) => api.get(`/events/${id}`),
  create: (data) => api.post('/events', data),
  update: (id, data) => api.put(`/events/${id}`, data),
  delete: (id) => api.delete(`/events/${id}`),
  getCategories: () => api.get('/events/categories'),
};

// Users API (admin only)
export const usersAPI = {
  getAll: () => api.get('/users'),
  getOne: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  resetPassword: (id, newPassword) => api.post(`/users/${id}/reset-password`, { newPassword }),
};

// Notification Settings API
export const notificationSettingsAPI = {
  get: () => api.get('/notification-settings'),
  update: (data) => api.put('/notification-settings', data),
  test: () => api.post('/notification-settings/test'),
};

// Automation API
export const automationAPI = {
  preview: (year, month) => api.get(`/automation/kipapp/preview?year=${year}&month=${month}`),
  run: (data) => api.post('/automation/kipapp/run', data),
  statusUrl: (runId) => `${API_URL}/automation/kipapp/status/${runId}`,
  getRunStatus: (runId) => api.get(`/automation/kipapp/run/${runId}`),
  history: () => api.get('/automation/kipapp/history'),
  activeRun: () => api.get('/automation/kipapp/active'),
  cancel: (runId) => api.post(`/automation/kipapp/cancel/${runId}`),
  submitOtp: (runId, otp) => api.post(`/automation/kipapp/otp/${runId}`, { otp }),
};

// Dashboard API
export const dashboardAPI = {
  getTodayFocus: (params) => api.get('/dashboard/today-focus', { params }),
  getActivityFeed: (limit = 10) => api.get('/dashboard/activity-feed', { params: { limit } }),
  getLayout: () => api.get('/dashboard/layout'),
  saveLayout: (layouts) => api.put('/dashboard/layout', { layouts }),
};

// Notifications API
export const notificationsAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  markAllRead: () => api.patch('/notifications/read-all'),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
};

// Notulen AI API
export const notulenAPI = {
  getSessions: (params) => api.get('/notulen', { params }),
  getSession: (id) => api.get(`/notulen/${id}`),
  updateSession: (id, data) => api.patch(`/notulen/${id}`, data),
  deleteSession: (id) => api.delete(`/notulen/${id}`),
  bulkDelete: (ids) => api.delete('/notulen/bulk', { data: { ids } }),
  bulkArchive: (ids) => api.patch('/notulen/bulk-archive', { ids }),
  cancelYoutubeJob: (jobId) => api.delete(`/notulen/youtube/jobs/${jobId}`),
  generateSummary: (id) => api.post(`/notulen/${id}/summary`, {}, { timeout: 660000 }),
  summaryProgressUrl: (id) => {
    const token = localStorage.getItem('accessToken');
    const base = import.meta.env.PROD ? 'https://api-agenda.bpsmalut.com/api' : '/api';
    return `${base}/notulen/${id}/summary/progress?token=${encodeURIComponent(token)}`;
  },
  exportSession: (id, format) => api.get(`/notulen/${id}/export/${format}`, { responseType: 'blob' }),
  deleteSegment: (sessionId, segId) => api.delete(`/notulen/${sessionId}/segments/${segId}`),
  updateSegment: (sessionId, segId, text) => api.patch(`/notulen/${sessionId}/segments/${segId}`, { text }),
  uploadAudio: (formData, onProgress, signal) => api.post('/notulen/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
    onUploadProgress: onProgress,
    ...(signal && { signal }),
  }),
  importText: (data) => api.post('/notulen/import-text', data),
  importSubtitle: (formData) => api.post('/notulen/import-subtitle', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  shareSession: (id) => api.post(`/notulen/${id}/share`),
  revokeShare: (id) => api.delete(`/notulen/${id}/share`),
  getPublicSession: (token) => axios.get(`${API_URL}/notulen/public/${token}`),
  askQuestion: (id, question) => api.post(`/notulen/${id}/ask`, { question }, { timeout: 120000 }),
  importYoutube: (data) => api.post('/notulen/import-youtube', data, { timeout: 30000 }),
  youtubeProgressUrl: (jobId) => {
    const token = localStorage.getItem('accessToken');
    const base = import.meta.env.PROD ? 'https://api-agenda.bpsmalut.com/api' : '/api';
    return `${base}/notulen/youtube/progress/${jobId}?token=${encodeURIComponent(token)}`;
  },
};

// Notulen Folders API
export const notulenFoldersAPI = {
  list: () => api.get('/notulen/folders'),
  create: (data) => api.post('/notulen/folders', data),
  update: (id, data) => api.put(`/notulen/folders/${id}`, data),
  delete: (id) => api.delete(`/notulen/folders/${id}`),
  ask: (id, question) => api.post(`/notulen/folders/${id}/ask`, { question }),
  askProgressUrl: (id, qaId) => {
    const token = localStorage.getItem('accessToken');
    const base = import.meta.env.PROD ? 'https://api-agenda.bpsmalut.com/api' : '/api';
    return `${base}/notulen/folders/${id}/ask/progress?qaId=${qaId}&token=${encodeURIComponent(token)}`;
  },
  listQA: (id) => api.get(`/notulen/folders/${id}/qa`),
  deleteQA: (id, qaId) => api.delete(`/notulen/folders/${id}/qa/${qaId}`),
};

export function getNotulenWsUrl() {
  const token = localStorage.getItem('accessToken');
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.PROD ? 'api-agenda.bpsmalut.com' : window.location.host;
  return `${proto}//${host}/ws/notulen?token=${token}`;
}

export default api;
