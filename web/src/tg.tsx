// Thin typed wrapper around the official telegram-web-app.js (loaded in index.html).
// Outside Telegram (plain browser during development) everything degrades to HTML fallbacks.
import { type ReactNode, useEffect, useRef } from 'react';
import { correctedScreenBg, type ThemeColors } from '../../shared/themeContrast.ts';
import { t } from './i18n.ts';

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
  initDataUnsafe: {
    user?: { id: number; first_name: string; language_code?: string; allows_write_to_pm?: boolean };
    start_param?: string;
  };
  version: string;
  colorScheme: 'light' | 'dark';
  themeParams?: ThemeColors;
  setBackgroundColor?(color: string): void;
  isVersionAtLeast(v: string): boolean;
  onEvent?(event: string, cb: () => void): void;
  ready(): void;
  expand(): void;
  close(): void;
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
  openLink(url: string): void;
  requestWriteAccess(cb: (allowed: boolean) => void): void;
  shareMessage?(id: string, cb?: (sent: boolean) => void): void;
  requestChat?(id: string, cb?: (ok: boolean) => void): void;
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

/** Тема интерфейса: в Telegram — по colorScheme клиента, вне Telegram — по prefers-color-scheme. */
function currentScheme(): 'light' | 'dark' {
  if (inTelegram && tg!.colorScheme) return tg!.colorScheme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Ставит data-scheme на <html>: от него включается тёмная пара токенов (tokens.css). */
export function applyScheme(scheme: 'light' | 'dark' = currentScheme()) {
  document.documentElement.dataset.scheme = scheme;
  applyScreenBg(inTelegram ? tg!.themeParams : undefined, scheme);
}

let bgOverridden = false;

/**
 * Telegram Desktop/Web нередко присылают фон экрана почти как у карточек — границы блоков не видны.
 * Тогда `--bg` затемняется (themeContrast.ts), иначе override снимается. Вне Telegram — запасные значения tokens.css.
 */
export function applyScreenBg(theme: ThemeColors | undefined, scheme: 'light' | 'dark') {
  const root = document.documentElement.style;
  const bg = correctedScreenBg(theme, scheme);
  if (bg) root.setProperty('--bg', bg);
  else root.removeProperty('--bg');
  if (inTelegram && atLeast('6.1') && (bg || bgOverridden)) tg!.setBackgroundColor?.(bg ?? 'secondary_bg_color');
  bgOverridden = Boolean(bg);
}

// Тема нужна до первой отрисовки, поэтому выставляем её при загрузке модуля и следим за сменой.
applyScheme();
if (inTelegram) tg!.onEvent?.('themeChanged', () => applyScheme());
else window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyScheme());

export function initTelegram() {
  if (!inTelegram) return;
  tg!.ready();
  tg!.expand();
  if (atLeast('7.7')) tg!.disableVerticalSwipes?.();
}

const devParams = new URLSearchParams(location.search);
/** In a plain browser: ?dev=2 pretends to be user #2, ?startapp=CODE simulates an invite link. */
export const devUserId = devParams.get('dev') ?? '1';
/**
 * Служебные экраны (каталог компонентов #/kit): только вне Telegram и только с явным ?dev=… в адресе.
 * Настоящие пользователи всегда открывают приложение внутри Telegram (initData есть), поэтому им каталог недоступен.
 */
export const devTools = !inTelegram && devParams.has('dev');

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

/** Closes the Mini App; outside Telegram there is nothing to close, so the page is left as is. */
export function closeApp() {
  if (inTelegram) tg!.close();
}

export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (inTelegram) tg!.openTelegramLink(share);
  else window.open(share, '_blank');
}

/** Native «send this prepared card to a chat» (WebApp 8.0+). False outside Telegram and on older clients. */
export const canShareMessage = () => atLeast('8.0') && typeof tg!.shareMessage === 'function';

/** Opens Telegram's chat picker for a message prepared with savePreparedInlineMessage; resolves true if it was sent. */
export function shareMessage(id: string): Promise<boolean> {
  return new Promise((resolve) => tg!.shareMessage!(id, (sent) => resolve(sent)));
}

/** Telegram's chat picker (WebApp.requestChat, Bot API 9.6). False outside Telegram and on older clients. */
export const canRequestChat = () => atLeast('9.6') && typeof tg!.requestChat === 'function';

/** Opens the picker for a button saved with savePreparedKeyboardButton; the pick goes to the bot, not to the app. */
export function requestChat(id: string): Promise<boolean> {
  return new Promise((resolve) => tg!.requestChat!(id, (ok) => resolve(ok !== false)));
}

/** Copies text to the clipboard; if that is blocked, shows the text in a dialog so it can be copied by hand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    haptic.success();
    return true;
  } catch {
    await alertDialog(text);
    return false;
  }
}

/** Opens an external https link: in Telegram's in-app browser, or a new tab outside Telegram. */
export function openLink(url: string) {
  if (inTelegram) tg!.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * Telegram's native bottom button; outside Telegram renders the stand-in (`.mbar` / `.mbtn`).
 * `above` — одна текстовая кнопка (`Button variant="ghost"`) над нижней: рисуется и в Telegram, над его кнопкой.
 */
export function MainButton(props: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  above?: ReactNode;
}) {
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

  if (inTelegram) return props.above ? <div className="mbar mbar-above">{props.above}</div> : null;
  return (
    <div className="mbar">
      {props.above}
      <button
        type="button"
        className="mbtn"
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={() => handler.current()}
      >
        {loading ? <span className="spin" aria-hidden="true" /> : null}
        {text}
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
    <button type="button" className="dev-back" onClick={() => handler.current()}>
      {t('common.back')}
    </button>
  );
}
