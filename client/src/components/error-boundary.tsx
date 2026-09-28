import { Component, type ReactNode } from "react";
import { ErrorFallback } from "./error-fallback";

// Browsers word a failed dynamic import differently; these cover Chromium, Firefox and Safari.
const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

function isChunkLoadError(error: Error | undefined): boolean {
  if (!error) {
    return false;
  }
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  /** When this key changes the boundary resets automatically (e.g. pass the current route). */
  resetKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState & { prevResetKey?: string }) {
    if (props.resetKey !== undefined && props.resetKey !== state.prevResetKey) {
      return { hasError: false, error: undefined, prevResetKey: props.resetKey };
    }
    return { prevResetKey: props.resetKey };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  static displayName = "ErrorBoundary";

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      // React.lazy caches a rejected import, so retrying in place cannot recover;
      // only a reload fetches the current build's chunk names.
      if (isChunkLoadError(this.state.error)) {
        return (
          <ErrorFallback
            onReset={() => window.location.reload()}
            resetLabel="Reload"
            message="A new version of the app is available. Reload to continue."
          />
        );
      }
      return <ErrorFallback onReset={this.handleReset} message={this.state.error?.message} />;
    }

    return this.props.children;
  }
}
