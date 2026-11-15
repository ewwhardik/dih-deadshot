/**
 * Safe Discord Rich Presence manager for Dih Client.
 */

const DISCORD_APP_ID = "1314242900422496356";

class DiscordRpcService {
  constructor() {
    this.client = null;
    this.enabled = false;
    this.privacyMode = false;
    this.startTimestamp = new Date();
    this.currentState = {
      weapon: "AR-15",
      skinName: "Default",
      mode: "In Match",
    };
    this._connected = false;
  }

  setConfig({ enabled, privacyMode }) {
    const nextEnabled = Boolean(enabled);
    const prevEnabled = this.enabled;
    this.privacyMode = Boolean(privacyMode);
    this.enabled = nextEnabled;

    if (nextEnabled && !prevEnabled) {
      this.start();
    } else if (!nextEnabled && prevEnabled) {
      this.stop();
    } else if (nextEnabled && this._connected) {
      this.updateActivity(this.currentState);
    }
  }

  start() {
    if (!this.enabled || this.client) return;
    try {
      const RPC = require("discord-rpc");
      const client = new RPC.Client({ transport: "ipc" });
      this.client = client;

      client.on("ready", () => {
        this._connected = true;
        this.updateActivity(this.currentState);
      });

      client.on("disconnected", () => {
        this._connected = false;
      });

      client.login({ clientId: DISCORD_APP_ID }).catch(() => {
        this._connected = false;
      });
    } catch {
      this._connected = false;
    }
  }

  updateActivity(partial = {}) {
    this.currentState = { ...this.currentState, ...partial };
    if (!this.enabled || !this.client || !this._connected) return;

    const details = this.privacyMode
      ? "Playing Deadshot.io via Dih"
      : `Deadshot.io • ${this.currentState.mode || "Uncapped FPS"}`;

    const state = this.privacyMode
      ? "Private Session"
      : `${this.currentState.weapon || "Loadout"} (${this.currentState.skinName || "Default"})`;

    this.client
      .setActivity({
        details,
        state,
        startTimestamp: this.startTimestamp,
        largeImageText: "Dih Client",
        instance: false,
      })
      .catch(() => {});
  }

  stop() {
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
