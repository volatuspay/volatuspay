import { nanoid } from 'nanoid';

const BROWSER_ID_KEY = 'volatuspay_browser_id';

export function getBrowserId(): string {
  let browserId = localStorage.getItem(BROWSER_ID_KEY);
  
  if (!browserId) {
    browserId = nanoid(32);
    localStorage.setItem(BROWSER_ID_KEY, browserId);
  }
  
  return browserId;
}

export function clearBrowserId(): void {
  localStorage.removeItem(BROWSER_ID_KEY);
}

export function initBrowserSession(): string {
  return getBrowserId();
}
