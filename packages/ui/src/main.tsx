// packages/ui/src/main.tsx
import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/globals.css';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 3000, retry: 1 },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center p-8">
          <div className="max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-6 text-center space-y-3">
            <h1 className="text-lg font-semibold text-rose-700">Something went wrong</h1>
            <pre className="whitespace-pre-wrap text-xs text-rose-600 text-left bg-rose-100 rounded p-3 max-h-48 overflow-auto">
              {(this.state.error as Error).message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>
);
