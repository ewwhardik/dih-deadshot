/**
 * Safe Discord Rich Presence manager for Dih Client (Electron).
 * Supports custom Discord Application ID, live connection status/error reporting,
 * clickable Download + Showcase buttons, and automatic reconnect.
 */

const DEFAULT_DISCORD_APP_ID = "1571744646219169873";

const RPC_BUTTONS = [
  { label: "Download Dih", url: "https://github.com/ewwhardik/dih-deadshot/releases/latest" },
  { label: "Join Discord", url: "https://discord.gg/KkCjEdv9Jv" },
];

class DiscordRpcService {
  constructor() {
    this.client = null;
    this.enabled = false;
    this.privacyMode = false;
    this.clientId = DEFAULT_DISCORD_APP_ID;
    this.startEpochSec = Math.floor(Date.now() / 1000);
    this.currentState = {
      weapon: "Uncapped Engine",
      skinName: "201 Controls",
      mode: "In Match",
    };
    this._connected = false;
    this._connecting = false;
    this._lastError = "";
    this._appName = "";
    this._retryTimer = null;
  }

  setConfig({ enabled, privacyMode, clientId }) {
    const nextEnabled = Boolean(enabled);
    const prevEnabled = this.enabled;
    const nextId = typeof clientId === "string" ? clientId.trim() : this.clientId;
    const idChanged = nextId !== this.clientId;

    this.privacyMode = Boolean(privacyMode);
    this.enabled = nextEnabled;
    this.clientId = nextId || DEFAULT_DISCORD_APP_ID;

    if (!nextEnabled) {
      if (prevEnabled || this.client) this.stop();
      return;
    }

    if (idChanged && this.client) {
      this.stop();
    }

    if (!this.client) {
      this.start();
    } else if (this._connected) {
      this.updateActivity(this.currentState);
    }
  }

  start() {
    if (!this.enabled || this.client || this._connecting) return;
    if (!this.clientId) {
      this._connected = false;
      this._lastError = "Set your Discord App ID (named 'Dih deadshot.io') in Visuals & Sync -> Privacy";
      return;
    }

    this._connecting = true;
    this._lastError = "";
    try {
      const RPC = require("discord-rpc");
      const client = new RPC.Client({ transport: "ipc" });
      this.client = client;

      client.on("ready", () => {
        this._connecting = false;
        this._connected = true;
        this._lastError = "";
        this._appName = client.application?.name || "";
        this.updateActivity(this.currentState);
      });

      client.on("disconnected", () => {
        this._connecting = false;
        this._connected = false;
        this.client = null;
        this._scheduleRetry();
      });

      client.login({ clientId: this.clientId }).catch((err) => {
        this._connecting = false;
        this._connected = false;
        this._lastError = err?.message || String(err || "Discord IPC connection failed");
        this.client = null;
        this._scheduleRetry();
      });
    } catch (err) {
      this._connecting = false;
      this._connected = false;
      this._lastError = err?.message || String(err || "Discord RPC init failed");
      this.client = null;
    }
  }

  _scheduleRetry() {
    if (this._retryTimer || !this.enabled || !this.clientId) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this.enabled && !this._connected && !this.client) {
        this.start();
      }
    }, 8000);
  }

  updateActivity(partial = {}) {
    this.currentState = { ...this.currentState, ...partial };
    if (!this.enabled || !this.client || !this._connected) return;

    const details = this.privacyMode
      ? "Playing Deadshot.io via Dih"
      : "The client feels like hacking!";

    const state = this.privacyMode
      ? "Private Session"
      : "755.5 KB Uncapped Engine • 201 Controls";

    this.client
      .setActivity({
        details,
        state,
        startTimestamp: this.startEpochSec,
        largeImageKey: "dih_logo",
        largeImageText: "Dih Client — Uncapped deadshot.io",
        buttons: RPC_BUTTONS,
        instance: false,
      })
      .then((res) => {
        if (res?.name) this._appName = res.name;
        this._lastError = "";
      })
      .catch((err) => {
        this._lastError = err?.message || String(err || "SET_ACTIVITY failed");
      });
  }

  reconnect() {
    this.stop();
    if (this.enabled) this.start();
    return this.getStatus();
  }

  getStatus() {
    return {
      enabled: this.enabled,
      connected: this._connected,
      appId: this.clientId,
      appName: this._appName,
      lastError: this._lastError,
      details: this.privacyMode ? "Playing Deadshot.io via Dih" : "The client feels like hacking!",
      state: this.privacyMode ? "Private Session" : "755.5 KB Uncapped Engine • 201 Controls",
      buttons: RPC_BUTTONS,
    };
  }

  stop() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._connecting = false;
    this._connected = false;
    if (this.client) {
      try {
        this.client.clearActivity().catch(() => {});
        this.client.destroy().catch(() => {});
      } catch {}
      this.client = null;
    }
  }
}

module.exports = {
  DiscordRpcService,
};
