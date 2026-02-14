import { Storage, STORAGE_KEYS } from "./utils/storage.js";
import { ensureInstallTimestamp, getTrialState, hasManualRefreshAccess } from "./utils/trial.js";

const DAILY_ALARM_NAME = "dailyProfileRefresh";
const PROFILE_URL = "https://www.naukri.com/mnjuser/profile";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInstallTimestamp();
  await scheduleDailyRefresh();
  console.info("[NPB] Extension installed and daily alarm configured.");
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureInstallTimestamp();
  await ensureAlarm();
  console.info("[NPB] Startup checks complete.");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== DAILY_ALARM_NAME) {
    return;
  }

  await runRefreshFlow({ mode: "auto" });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("[NPB] Message handler error:", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "MANUAL_REFRESH":
      if (!(await hasManualRefreshAccess())) {
        await chrome.tabs.create({ url: chrome.runtime.getURL("paywall.html") });
        return { gated: true };
      }
      await runRefreshFlow({ mode: "manual" });
      return { gated: false };

    case "CONTENT_LOGIN_STATUS":
      await Storage.set({ [STORAGE_KEYS.LOGIN_STATUS]: message.payload?.isLoggedIn ? "logged_in" : "logged_out" });
      return {};

    case "CONTENT_INSIGHTS":
      await Storage.set({ [STORAGE_KEYS.PROFILE_VIEWS]: message.payload?.profileViews || "N/A" });
      return {};

    case "GET_DASHBOARD_STATE":
      return getDashboardState();

    default:
      return {};
  }
}

async function scheduleDailyRefresh() {
  const now = Date.now();
  const firstRunAt = now + 24 * 60 * 60 * 1000;
  await chrome.alarms.create(DAILY_ALARM_NAME, {
    when: firstRunAt,
    periodInMinutes: 24 * 60
  });
  await Storage.set({ [STORAGE_KEYS.NEXT_REFRESH_AT]: firstRunAt });
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(DAILY_ALARM_NAME);
  if (alarm) {
    await Storage.set({ [STORAGE_KEYS.NEXT_REFRESH_AT]: alarm.scheduledTime || Date.now() + 24 * 60 * 60 * 1000 });
    return;
  }
  await scheduleDailyRefresh();
}

async function runRefreshFlow({ mode }) {
  let tabId;
  try {
    tabId = await openProfileTab();
    await waitForTabReady(tabId);

    const response = await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_REFRESH",
      payload: { mode }
    });

    const success = Boolean(response?.success);
    await Storage.set({
      [STORAGE_KEYS.LAST_REFRESH_AT]: Date.now(),
      [STORAGE_KEYS.LAST_REFRESH_STATUS]: success ? "success" : "failed",
      [STORAGE_KEYS.LOGIN_STATUS]: response?.isLoggedIn ? "logged_in" : "logged_out",
      [STORAGE_KEYS.PROFILE_VIEWS]: response?.profileViews || "N/A"
    });

    const nextAlarm = await chrome.alarms.get(DAILY_ALARM_NAME);
    if (nextAlarm?.scheduledTime) {
      await Storage.set({ [STORAGE_KEYS.NEXT_REFRESH_AT]: nextAlarm.scheduledTime });
    }

    console.info(`[NPB] ${mode} refresh ${success ? "succeeded" : "failed"}.`);
  } catch (error) {
    console.error("[NPB] Refresh flow failed:", error);
    await Storage.set({
      [STORAGE_KEYS.LAST_REFRESH_AT]: Date.now(),
      [STORAGE_KEYS.LAST_REFRESH_STATUS]: "failed"
    });
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Ignore tab close errors.
      }
    }
  }
}

async function openProfileTab() {
  const tab = await chrome.tabs.create({ url: PROFILE_URL, active: false });
  return tab.id;
}

async function waitForTabReady(tabId, timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error("Timed out while waiting for profile tab to load.");
}

async function getDashboardState() {
  const [trial, data, alarm] = await Promise.all([
    getTrialState(),
    Storage.get([
      STORAGE_KEYS.LAST_REFRESH_AT,
      STORAGE_KEYS.LAST_REFRESH_STATUS,
      STORAGE_KEYS.LOGIN_STATUS,
      STORAGE_KEYS.PROFILE_VIEWS,
      STORAGE_KEYS.IS_PAID,
      STORAGE_KEYS.RESUME_META,
      STORAGE_KEYS.NEXT_REFRESH_AT
    ]),
    chrome.alarms.get(DAILY_ALARM_NAME)
  ]);

  return {
    trial,
    isPaid: Boolean(data[STORAGE_KEYS.IS_PAID]),
    lastRefreshAt: data[STORAGE_KEYS.LAST_REFRESH_AT] || null,
    lastRefreshStatus: data[STORAGE_KEYS.LAST_REFRESH_STATUS] || "idle",
    loginStatus: data[STORAGE_KEYS.LOGIN_STATUS] || "unknown",
    profileViews: data[STORAGE_KEYS.PROFILE_VIEWS] || "N/A",
    resumeMeta: data[STORAGE_KEYS.RESUME_META] || null,
    nextRefreshAt: alarm?.scheduledTime || data[STORAGE_KEYS.NEXT_REFRESH_AT] || null
  };
}
