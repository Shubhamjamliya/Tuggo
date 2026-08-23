import React, { Component } from 'react';

class DeliveryErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[DeliveryPanel] Unhandled UI error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="delivery-v2-theme flex min-h-screen items-center justify-center bg-[#f8f9fa] px-6 text-center">
        <div className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl">
          <h1 className="text-xl font-black text-gray-950">Delivery panel could not load</h1>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Your delivery data is safe. Please retry the screen.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-6 w-full rounded-2xl bg-gray-950 px-4 py-3 text-sm font-bold text-white"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 w-full rounded-2xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-700"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}

export default DeliveryErrorBoundary;
