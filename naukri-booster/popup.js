import { Storage, STORAGE_KEYS } from "./utils/storage.js";

const el = {
  loginStatus: document.getElementById("loginStatus"),
  trialStatus: document.getElementById("trialStatus"),
  profileViews: document.getElementById("profileViews"),
  lastRefresh: document.getElementById("lastRefresh"),
  nextRefresh: document.getElementById("nextRefresh"),
  refreshNowBtn: document.getElementById("refreshNowBtn"),
  selectResumeBtn: document.getElementById("selectResumeBtn"),
  resumeMeta: document.getElementById("resumeMeta"),
  upgradeBtn: document.getElementById("upgradeBtn")
};

let dashboardState = null;

init().catch((error) => {
  console.error("[NPB:popup] init failed", error);
});

async function init() {
  await loadDashboard();
  bindEvents();
  startRefreshCountdownTimer();
}

function bindEvents() {
  el.refreshNowBtn.addEventListener("click", handleManualRefresh);
  el.selectResumeBtn.addEventListener("click", handleResumeSelect);
  el.upgradeBtn.addEventListener("click", openPaywall);
}

async function loadDashboard() {
  const response = await chrome.runtime.sendMessage({ type: "GET_DASHBOARD_STATE" });
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to load dashboard state");
  }

  dashboardState = response;
  renderState();
}

function renderState() {
  const state = dashboardState;
  if (!state) {
    return;
  }

  const { trial, isPaid, profileViews, lastRefreshAt, loginStatus, nextRefreshAt, resumeMeta } = state;

  el.profileViews.textContent = profileViews || "N/A";
  el.lastRefresh.textContent = lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : "Never";
  el.nextRefresh.textContent = formatCountdown(nextRefreshAt);
  renderLogin(loginStatus);

  if (trial?.isActive) {
    el.trialStatus.textContent = `Trial: ${trial.remainingDays} day(s) left`;
  } else if (isPaid) {
    el.trialStatus.textContent = "Paid Plan Active";
  } else {
    el.trialStatus.textContent = "Trial expired";
  }

  el.resumeMeta.textContent = resumeMeta
    ? `Resume: ${resumeMeta.name} (${Math.ceil(resumeMeta.size / 1024)} KB)`
    : "No resume selected.";

  const canManualRefresh = trial?.isActive || isPaid;
  el.refreshNowBtn.textContent = canManualRefresh ? "Refresh Now" : "Refresh Now (Locked)";
  el.upgradeBtn.classList.toggle("hidden", canManualRefresh);
}

function renderLogin(status) {
  if (status === "logged_in") {
    el.loginStatus.textContent = "Logged in";
    el.loginStatus.className = "badge badge-ok";
    return;
  }

  if (status === "logged_out") {
    el.loginStatus.textContent = "Logged out";
    el.loginStatus.className = "badge badge-warn";
    return;
  }

  el.loginStatus.textContent = "Unknown";
  el.loginStatus.className = "badge badge-muted";
}

async function handleManualRefresh() {
  const response = await chrome.runtime.sendMessage({ type: "MANUAL_REFRESH" });
  if (response?.gated) {
    window.close();
    return;
  }

  await loadDashboard();
}

async function handleResumeSelect() {
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Resume files",
          accept: {
            "application/pdf": [".pdf"],
            "application/msword": [".doc"],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"]
          }
        }
      ]
    });

    const file = await handle.getFile();
    await Storage.set({
      [STORAGE_KEYS.RESUME_HANDLE]: handle,
      [STORAGE_KEYS.RESUME_META]: {
        name: file.name,
        size: file.size,
        type: file.type,
        selectedAt: Date.now()
      }
    });

    await loadDashboard();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    console.error("[NPB:popup] resume select failed", error);
    el.resumeMeta.textContent = "Resume selection failed. Please try again.";
  }
}

function startRefreshCountdownTimer() {
  setInterval(() => {
    if (!dashboardState) {
      return;
    }
    el.nextRefresh.textContent = formatCountdown(dashboardState.nextRefreshAt);
  }, 1000);
}

function formatCountdown(timestamp) {
  if (!timestamp) {
    return "Not scheduled";
  }

  const diff = timestamp - Date.now();
  if (diff <= 0) {
    return "Due now";
  }

  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function openPaywall() {
  chrome.tabs.create({ url: chrome.runtime.getURL("paywall.html") });
}
