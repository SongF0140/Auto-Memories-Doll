"use client";

/* eslint-disable no-console -- ErrorBoundary 必须记录未处理的 UI 异常。 */

import { Component, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: "" };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.setState({ errorInfo: errorInfo.componentStack || "" });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[400px] items-center justify-center px-6 py-16">
          <div className="card max-w-lg p-8 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.15),rgba(29,78,216,0.08)_60%,transparent_80%)] text-2xl text-brand-blue">
                !
              </div>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-text-primary">页面出错了</h3>
            <p className="mb-4 max-w-md text-sm leading-relaxed text-text-secondary">
              {this.state.error?.message || "发生了未知错误"}
            </p>
            {this.state.errorInfo && (
              <details className="mb-4">
                <summary className="cursor-pointer text-xs text-text-tertiary">详细堆栈</summary>
                <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-muted p-3 text-left text-[11px] leading-relaxed text-text-secondary">
                  {this.state.errorInfo}
                </pre>
              </details>
            )}
            <button onClick={this.handleRetry} className="btn mx-auto h-10 px-6">
              重试
            </button>
            <p className="mt-3 text-xs text-text-tertiary">
              如果问题持续出现，请检查 AI 配置或刷新页面
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
