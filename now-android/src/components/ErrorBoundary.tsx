import React, { Component, ErrorInfo, ReactNode } from 'react';
import Icon from './Icon';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    name?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`Uncaught error in ${this.props.name || 'Component'}:`, error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="flex flex-col items-center justify-center p-12 bg-white/[0.02] border border-white/5 rounded-[24px] text-center">
                    <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6">
                        <Icon name="error_outline" className="text-red-400" size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">组件渲染出错了</h2>
                    <p className="text-white/40 text-[14px] max-w-[300px] mb-6 leading-relaxed">
                        编辑器的渲染引擎遇到了预期之外的问题（可能是由于复杂的 Markdown 语法冲突导致的）。
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-6 py-2.5 bg-white/10 hover:bg-white/15 text-white/90 rounded-full text-[13px] font-bold transition-all"
                    >
                        尝试重载
                    </button>
                    {this.state.error && (
                        <div className="mt-8 text-[10px] font-mono text-white/20 break-all max-w-full overflow-hidden opacity-50">
                            {this.state.error.message}
                        </div>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
