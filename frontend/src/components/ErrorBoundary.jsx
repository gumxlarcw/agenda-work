import { Component } from 'react';

function isChunkLoadError(error) {
  if (!error) return false;
  const msg = error.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    msg.includes('ChunkLoadError')
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8">
          <div className={`${chunkError ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border rounded-xl p-8 max-w-md w-full text-center`}>
            <div className={`w-16 h-16 ${chunkError ? 'bg-amber-100' : 'bg-red-100'} rounded-full flex items-center justify-center mx-auto mb-4`}>
              {chunkError ? (
                <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              )}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {chunkError ? 'Aplikasi telah diperbarui' : 'Terjadi kesalahan'}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {chunkError
                ? 'Versi baru tersedia. Muat ulang halaman untuk melanjutkan.'
                : 'Terjadi kesalahan yang tidak terduga. Silakan coba lagi.'}
            </p>
            <button
              onClick={chunkError ? this.handleReload : this.handleRetry}
              className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium transition-colors"
            >
              {chunkError ? 'Muat Ulang' : 'Coba Lagi'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
