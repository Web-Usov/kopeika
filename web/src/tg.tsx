// Thin typed wrapper around the official telegram-web-app.js (loaded in index.html).
// Outside Telegram (plain browser during development) everything degrades to HTML fallbacks.
import { useEffect, useRef } from 'react';

interface BottomButton {
  setParams(p: { text?: string; is_active?: boolean; is_visible?: boolean }): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  hide(): void;
}

interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; allows_write_to_pm?: boolean }; start_param?: string };
  version: string;
  colorScheme: 'light' | 'dark';
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  MainButton: BottomButton;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  showAlert(message: string, cb?: () => void): void;
  openTelegramLink(url: string): void;
  requestWriteAccess(cb: (allowed: boolean) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;
/** True only when actually running inside a Telegram client. */
export const inTelegram = Boolean(tg?.initData);
const atLeast = (v: string) => inTelegram && tg!.isVersionAtLeast(v);

export function initTelegram() {
  if (!inTelegram) return;
  tg!.ready();
  tg!.expand();
  if (atLeast('7.7')) tg!.disableVerticalSwipes?.();
}

const devParams = new URLSearchParams(location.search);
/** In a plain browser: ?dev=2 pretends to be user #2, ?startapp=CODE simulates an invite link. */
export const devUserId = devParams.get('dev') ?? '1';

export function startParam(): string | undefined {
  return inTelegram ? tg!.initDataUnsafe.start_param : (devParams.get('startapp') ?? undefined);
}

export function authHeader(): string {
  return inTelegram ? `tma ${tg!.initData}` : `dev ${devUserId}`;
}

export const haptic = {
  tap: () => atLeast('6.1') && tg!.HapticFeedback.selectionChanged(),
  success: () => atLeast('6.1') && tg!.HapticFeedback.notificationOccurred('success'),
  error: () => atLeast('6.1') && tg!.HapticFeedback.notificationOccurred('error'),
};

export function confirmDialog(message: string): Promise<boolean> {
  if (atLeast('6.2')) return new Promise((resolve) => tg!.showConfirm(message, resolve));
  return Promise.resolve(window.confirm(message));
}

export function alertDialog(message: string): Promise<void> {
  if (atLeast('6.2')) return new Promise((resolve) => tg!.showAlert(message, resolve));
  window.alert(message);
  return Promise.resolve();
}

export function requestWriteAccess(): Promise<boolean> {
  if (!atLeast('6.9')) return Promise.resolve(false);
  return new Promise((resolve) => tg!.requestWriteAccess(resolve));
}

export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (inTelegram) tg!.openTelegramLink(share);
  else window.open(share, '_blank');
}

/** Telegram's native bottom button; renders a regular button outside Telegram. */
export function MainButton(props: { text: string; onClick: () => void; disabled?: boolean; loading?: boolean }) {
  const { text, disabled = false, loading = false } = props;
  const handler = useRef(props.onClick);
  handler.current = props.onClick;

  useEffect(() => {
    if (!inTelegram) return;
    const mb = tg!.MainButton;
    const cb = () => {
      if (!disabled && !loading) handler.current();
    };
    mb.setParams({ text, is_active: !disabled, is_visible: true });
    if (loading) mb.showProgress(false);
    else mb.hideProgress();
    mb.onClick(cb);
    return () => mb.offClick(cb);
  }, [text, disabled, loading]);

  useEffect(() => () => (inTelegram ? tg!.MainButton.hide() : undefined), []);

  if (inTelegram) return null;
  return (
    <div className="main-button-bar">
      <button className="main-button" disabled={disabled || loading} onClick={() => handler.current()}>
        {loading ? '…' : text}
      </button>
    </div>
  );
}

/** Telegram's native back arrow in the header; renders a text link outside Telegram. */
export function BackButton({ onClick }: { onClick: () => void }) {
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    if (!inTelegram) return;
    const bb = tg!.BackButton;
    const cb = () => handler.current();
    bb.onClick(cb);
    bb.show();
    return () => {
      bb.offClick(cb);
      bb.hide();
    };
  }, []);

  if (inTelegram) return null;
  return (
    <button className="dev-back" onClick={() => handler.current()}>
      ‹ Назад
    </button>
  );
}
