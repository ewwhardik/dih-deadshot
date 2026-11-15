/**
 * Auto-Join Match Chat Broadcaster for Dih Client:
 * Safely detects lobby -> match transitions (or manual trigger) and sends
 * the user's configured greeting (default: "Dih User Joined") in Deadshot chat.
 */

DIH_NS.createAutoChat = function createAutoChat(shadowRoot, getSettings, onNotify) {
  const DEFAULT_MSG = "Dih User Joined";

  let lastSentAt = 0;
  let lobbyVisibleSince = 0;
  let sentForThisMatch = false;
  let pendingTimer = null;
  let destroyed = false;

  function findChatInput() {
    return (
      document.querySelector('input[placeholder="[Enter] to use chat"]') ||
      document.querySelector('input[placeholder*="Enter"][placeholder*="chat" i]:not(.partyChatInput)') ||
      Array.from(document.querySelectorAll('input[maxlength="100"]')).find(
        (inp) => !inp.classList.contains("partyChatInput")
      ) ||
      null
    );
  }

  function isInHomeLobby() {
    // Deadshot mounts #banner-home and menu/play elements in the main lobby
    const banner = document.getElementById("banner-home");
    const playBtn = document.querySelector('[class*="play" i][class*="btn" i], #playBtn, [data-screen="home"]');
    return Boolean(banner || playBtn) && !document.pointerLockElement;
  }

  function dispatchEnter(target) {
    const opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    target.dispatchEvent(new KeyboardEvent("keydown", opts));
    target.dispatchEvent(new KeyboardEvent("keypress", opts));
    target.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function sendChatMessage(rawText) {
    const cleanText = String(rawText || DEFAULT_MSG).trim().slice(0, 100);
    if (!cleanText) return false;

    const chatInput = findChatInput();
    if (!chatInput) return false;
    if (document.activeElement === chatInput) return false;

    const now = Date.now();
    const cfg = getSettings()?.autoChat || {};
    const cooldownMs = Math.max(2000, Number(cfg.cooldownMs) || 15000);
    if (now - lastSentAt < cooldownMs) return false;

    const prevFocus = document.activeElement;
    // Open Deadshot's chat input if it's currently closed
    if (getComputedStyle(chatInput).display === "none") {
      dispatchEnter(window);
      dispatchEnter(document);
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    try {
      chatInput.focus({ preventScroll: true });
    } catch {
      try { chatInput.focus(); } catch {}
    }
    if (setter) {
      setter.call(chatInput, cleanText);
    } else {
      chatInput.value = cleanText;
    }
    chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    chatInput.dispatchEvent(new Event("change", { bubbles: true }));

    setTimeout(() => {
      if (destroyed) return;
      dispatchEnter(chatInput);
      lastSentAt = Date.now();
      try { chatInput.blur(); } catch {}
      if (prevFocus && typeof prevFocus.focus === "function" && prevFocus !== chatInput) {
        try { prevFocus.focus({ preventScroll: true }); } catch {}
      }
      if (typeof onNotify === "function") {
        onNotify(`Auto-Chat sent: "${cleanText}"`);
      }
    }, 45);

    return true;
  }

  function scheduleMatchGreeting() {
    if (destroyed || pendingTimer) return;
    const cfg = getSettings()?.autoChat || {};
    if (cfg.enabled === false) return;
    const delayMs = Math.max(250, Math.min(8000, Number(cfg.delayMs) || 1400));
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (destroyed || sentForThisMatch) return;
      const latestCfg = getSettings()?.autoChat || {};
      if (latestCfg.enabled === false) return;
      if (findChatInput() && sendChatMessage(latestCfg.message || DEFAULT_MSG)) {
        sentForThisMatch = true;
      }
    }, delayMs);
  }

  function onPointerLockChange() {
    if (destroyed) return;
    const cfg = getSettings()?.autoChat || {};
    if (cfg.enabled === false) return;

    const locked = Boolean(document.pointerLockElement);
    if (locked && !sentForThisMatch) {
      scheduleMatchGreeting();
    }
  }

  const pollTimer = setInterval(() => {
    if (destroyed) return;
    const cfg = getSettings()?.autoChat || {};
    if (cfg.enabled === false) {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      return;
    }

    const inLobby = isInHomeLobby();
    if (inLobby) {
      if (!lobbyVisibleSince) lobbyVisibleSince = Date.now();
      // Reset once the user has genuinely returned to the main lobby menu for >=1.2s
      if (Date.now() - lobbyVisibleSince >= 1200) {
        sentForThisMatch = false;
      }
    } else {
      lobbyVisibleSince = 0;
      if (!cfg.onlyOnMatchJoin && !sentForThisMatch && findChatInput()) {
        scheduleMatchGreeting();
      }
    }
  }, 750);

  document.addEventListener("pointerlockchange", onPointerLockChange);

  return {
    triggerManualSend() {
      const cfg = getSettings()?.autoChat || {};
      // Bypass cooldown check slightly for explicit test button while staying safe
      lastSentAt = 0;
      return sendChatMessage(cfg.message || DEFAULT_MSG);
    },
    refresh() {
      const cfg = getSettings()?.autoChat || {};
      if (cfg.enabled === false && pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    },
    destroy() {
      destroyed = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      clearInterval(pollTimer);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    },
  };
};
