import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Section name shown in the minimal error card */
  name?: string;
  /** Full-screen global fallback — use when wrapping the entire app */
  variant?: 'section' | 'global';
}
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleHardRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;

      // Global variant: full-screen fallback for the entire app
      if (this.props.variant === 'global') {
        return (
          <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
              <h1 className="text-xl font-bold text-foreground mb-2">Something went wrong</h1>
              <p className="text-sm text-muted-foreground mb-6">
                An unexpected error occurred and the application cannot continue.
                Please try refreshing the page.
              </p>
              {this.state.error?.message && (
                <div className="p-3 mb-6 rounded-lg bg-muted/30 border border-border text-left">
                  <p className="text-xs font-mono text-muted-foreground break-all">
                    {this.state.error.message}
                  </p>
                </div>
              )}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={this.handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
                <button
                  onClick={this.handleHardRefresh}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Refresh Page
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Section variant: unobtrusive inline error card
      return (
        <div className="w-full py-6 flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card/50 px-6 py-4 text-center max-w-sm">
            <p className="text-sm font-medium text-foreground">
              {this.props.name ? `${this.props.name} failed to load` : 'Section unavailable'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <button
              className="mt-3 text-xs underline text-primary"
              onClick={this.handleRetry}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
