(() => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomDelay = () => Math.floor(Math.random() * 4000) + 2000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EXECUTE_REFRESH") {
      return;
    }

    performRefresh(message.payload?.mode)
      .then(sendResponse)
      .catch((error) => {
        console.error("[NPB:content] Refresh error", error);
        sendResponse({ success: false, error: error.message, isLoggedIn: false, profileViews: "N/A" });
      });

    return true;
  });

  detectAndBroadcastLoginStatus();
  broadcastInsights();

  async function performRefresh(mode) {
    const isLoggedIn = detectLoggedIn();
    if (!isLoggedIn) {
      await sendRuntimeMessage({ type: "CONTENT_LOGIN_STATUS", payload: { isLoggedIn: false } });
      return { success: false, isLoggedIn: false, profileViews: "N/A" };
    }

    await delay(randomDelay());

    const refreshButton = findRefreshButton();
    if (!refreshButton) {
      throw new Error("Could not find refresh/update button on profile page.");
    }

    safeClick(refreshButton);

    const uploadResult = await tryResumeUpload();
    if (!uploadResult.success) {
      console.warn("[NPB:content] Resume upload skipped or failed:", uploadResult.reason);
    } else {
      console.info("[NPB:content] Resume upload succeeded.");
    }

    await delay(1200);

    const profileViews = scrapeProfileViews();
    await Promise.all([
      sendRuntimeMessage({ type: "CONTENT_LOGIN_STATUS", payload: { isLoggedIn: true } }),
      sendRuntimeMessage({ type: "CONTENT_INSIGHTS", payload: { profileViews } })
    ]);

    return { success: true, isLoggedIn: true, profileViews, mode, resume: uploadResult };
  }

  function detectLoggedIn() {
    const pageText = document.body?.innerText?.toLowerCase() || "";
    const hasLoginPrompt = ["login", "sign in", "forgot password"].some((needle) => pageText.includes(needle));
    const hasProfileSignals = ["profile", "resume", "update profile", "naukri"].some((needle) => pageText.includes(needle));

    const signInButton = document.querySelector('a[href*="/login"], button[id*="login"], .login');
    if (signInButton && !hasProfileSignals) {
      return false;
    }

    return !hasLoginPrompt || hasProfileSignals;
  }

  function detectAndBroadcastLoginStatus() {
    const isLoggedIn = detectLoggedIn();
    sendRuntimeMessage({ type: "CONTENT_LOGIN_STATUS", payload: { isLoggedIn } }).catch(() => undefined);
  }

  function scrapeProfileViews() {
    const candidates = [...document.querySelectorAll("div, span, p, strong")];
    const target = candidates.find((node) => {
      const text = (node.textContent || "").toLowerCase();
      return text.includes("profile views") || text.includes("views");
    });

    if (!target) {
      return "N/A";
    }

    const match = (target.textContent || "").match(/(\d+[\d,]*)/);
    return match ? match[1] : target.textContent.trim().slice(0, 40);
  }

  async function broadcastInsights() {
    const profileViews = scrapeProfileViews();
    await sendRuntimeMessage({ type: "CONTENT_INSIGHTS", payload: { profileViews } }).catch(() => undefined);
  }

  function findRefreshButton() {
    const selectors = ["button", "a", "div[role='button']", "span"];
    const needles = ["refresh", "update profile", "update", "save"];

    for (const selector of selectors) {
      const node = [...document.querySelectorAll(selector)].find((el) => {
        const text = (el.innerText || el.textContent || "").toLowerCase().trim();
        return text && needles.some((needle) => text.includes(needle));
      });

      if (node) {
        return node;
      }
    }

    return null;
  }

  async function tryResumeUpload() {
    const { resumeFileHandle } = await chrome.storage.local.get("resumeFileHandle");
    if (!resumeFileHandle) {
      return { success: false, reason: "Resume handle not configured." };
    }

    const permission = await ensureFilePermission(resumeFileHandle);
    if (!permission) {
      return { success: false, reason: "File permission not granted for selected resume." };
    }

    let file;
    try {
      file = await resumeFileHandle.getFile();
    } catch {
      return { success: false, reason: "Resume file is missing or permission revoked." };
    }

    const input = await getResumeFileInput();
    if (!input) {
      return { success: false, reason: "Resume file input not found on profile page." };
    }

    const dt = new DataTransfer();
    dt.items.add(file);

    try {
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      return { success: false, reason: "Failed to attach resume to upload input." };
    }

    await delay(1000);
    return { success: true, reason: "Resume attached and change event dispatched." };
  }

  async function ensureFilePermission(handle) {
    if (!handle?.queryPermission) {
      return true;
    }

    const readPermission = await handle.queryPermission({ mode: "read" });
    if (readPermission === "granted") {
      return true;
    }

    const requested = await handle.requestPermission({ mode: "read" });
    return requested === "granted";
  }

  async function getResumeFileInput(timeoutMs = 12000) {
    const existingInput = findBestResumeInput();
    if (existingInput) {
      return existingInput;
    }

    const resumeTriggers = findResumeTriggers();
    for (const trigger of resumeTriggers) {
      safeClick(trigger);
      await delay(350);

      const input = findBestResumeInput();
      if (input) {
        return input;
      }
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const input = findBestResumeInput();
      if (input) {
        return input;
      }
      await delay(250);
    }

    return null;
  }

  function findBestResumeInput() {
    const allInputs = [...document.querySelectorAll('input[type="file"]')];
    if (!allInputs.length) {
      return null;
    }

    const resumeInput = allInputs.find((input) => {
      const context = [
        input.accept,
        input.id,
        input.name,
        input.className,
        input.getAttribute("aria-label") || "",
        input.closest("section,div,form")?.innerText?.slice(0, 300) || ""
      ]
        .join(" ")
        .toLowerCase();

      const hasResumeSignal = ["resume", "cv", ".pdf", ".doc", "upload"].some((needle) => context.includes(needle));
      return hasResumeSignal;
    });

    return resumeInput || allInputs[0] || null;
  }

  function findResumeTriggers() {
    const selectors = ["button", "a", "span", "label", "div[role='button']"];
    const triggers = [];

    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter((node) => {
        const text = (node.innerText || node.textContent || "").toLowerCase().trim();
        return text && (
          text.includes("update resume") ||
          text === "update" ||
          text.includes("upload resume") ||
          text.includes("resume")
        );
      });
      triggers.push(...nodes);
    }

    return [...new Set(triggers)];
  }

  function safeClick(node) {
    try {
      node.scrollIntoView({ block: "center", behavior: "instant" });
    } catch {
      // Ignore scroll failures.
    }

    try {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    } catch {
      node.click();
    }
  }

  async function sendRuntimeMessage(payload) {
    return chrome.runtime.sendMessage(payload);
  }
})();
