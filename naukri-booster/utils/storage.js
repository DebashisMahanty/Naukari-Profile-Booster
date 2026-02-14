/**
 * Promise wrappers around chrome.storage.local operations.
 */
export const Storage = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },

  async set(values) {
    return chrome.storage.local.set(values);
  },

  async remove(keys) {
    return chrome.storage.local.remove(keys);
  }
};

export const STORAGE_KEYS = {
  INSTALL_TS: "installTimestamp",
  IS_PAID: "isPaid",
  RESUME_HANDLE: "resumeFileHandle",
  RESUME_META: "resumeMeta",
  LAST_REFRESH_AT: "lastRefreshAt",
  LAST_REFRESH_STATUS: "lastRefreshStatus",
  LOGIN_STATUS: "loginStatus",
  PROFILE_VIEWS: "profileViews",
  NEXT_REFRESH_AT: "nextRefreshAt"
};
