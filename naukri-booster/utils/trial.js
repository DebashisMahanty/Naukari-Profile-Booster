import { Storage, STORAGE_KEYS } from "./storage.js";

export const TRIAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function ensureInstallTimestamp() {
  const data = await Storage.get(STORAGE_KEYS.INSTALL_TS);
  if (data[STORAGE_KEYS.INSTALL_TS]) {
    return data[STORAGE_KEYS.INSTALL_TS];
  }

  const now = Date.now();
  await Storage.set({ [STORAGE_KEYS.INSTALL_TS]: now });
  return now;
}

export async function getTrialState() {
  const installTimestamp = await ensureInstallTimestamp();
  const expiresAt = installTimestamp + TRIAL_DAYS * DAY_MS;
  const remainingMs = Math.max(0, expiresAt - Date.now());
  const remainingDays = Math.ceil(remainingMs / DAY_MS);
  const isActive = remainingMs > 0;

  return {
    installTimestamp,
    expiresAt,
    remainingMs,
    remainingDays,
    isActive
  };
}

export async function hasManualRefreshAccess() {
  const [{ isActive }, { [STORAGE_KEYS.IS_PAID]: isPaid = false }] = await Promise.all([
    getTrialState(),
    Storage.get(STORAGE_KEYS.IS_PAID)
  ]);

  return Boolean(isActive || isPaid);
}
