import { Component, type ReactNode } from 'react';
import { reportError } from './errorReport.ts';
import { t } from './i18n.ts';

/** Catches render errors: a friendly screen instead of a blank page, and a report to the owner. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error, 'render');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center">
        <div className="empty-emoji">😕</div>
        <h2>{t('common.crashTitle')}</h2>
        <p>{t('common.crashText')}</p>
        <button type="button" className="small-btn primary" onClick={() => location.reload()}>
          {t('common.crashReload')}
        </button>
      </div>
    );
  }
}
