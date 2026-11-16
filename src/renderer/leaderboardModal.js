/**
 * Deadshot.io Live Leaderboard Modal (Daily / Weekly / All-Time Kills & Wins + Player Rank Lookup).
 */

DIH_NS.createLeaderboardModal = function createLeaderboardModal(shadowRoot) {
  const { el, createDarkSelect, closeDarkSelects } = DIH_NS.utils;

  const backdrop = el("div", { className: "dih-backdrop dih-lb-backdrop dih-hidden" });
  const modal = el("div", {
    className: "dih-card",
    style: {
      width: "min(680px, 90vw)",
      maxHeight: "80vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
  });

  const searchInput = el("input", {
    className: "dih-input",
    placeholder: "Player username to find rank...",
    style: { flex: "1" },
  });
  const catSelect = createDarkSelect(shadowRoot, [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "all", label: "All-Time" },
  ], { value: "daily" });
  const statSelect = createDarkSelect(shadowRoot, [
    { value: "kills", label: "Kills" },
    { value: "wins", label: "Wins" },
  ], { value: "kills" });
  const refreshBtn = el("button", { className: "dih-btn primary" }, "Fetch");
  const closeBtn = el("button", { className: "dih-btn" }, "Close");

  const header = el("div", { className: "dih-stage-header" }, [
    el("div", {}, [
      el("div", { className: "dih-stage-title" }, "Deadshot.io Leaderboards"),
      el("div", { className: "dih-stage-sub" }, "Live rankings fetched from login.deadshot.io/leaderboards"),
    ]),
    closeBtn,
  ]);

  const bar = el("div", {
    style: { padding: "12px 20px", borderBottom: "1px solid var(--dih-border)", display: "flex", gap: "8px" },
  }, [searchInput, catSelect, statSelect, refreshBtn]);

  const rankBanner = el("div", {
    style: { padding: "8px 20px", fontSize: "12px", color: "var(--dih-muted)", borderBottom: "1px solid var(--dih-border)" },
  }, "Enter a player name or browse Top 50.");

  const tableWrap = el("div", {
    className: "dih-stage-body",
    style: { padding: "10px 20px" },
  });

  modal.append(header, bar, rankBanner, tableWrap);
  backdrop.appendChild(modal);
  shadowRoot.appendChild(backdrop);

  let cachedData = null;

  function renderTable() {
    tableWrap.innerHTML = "";
    if (!cachedData) {
      tableWrap.appendChild(el("div", { style: { color: "var(--dih-muted)", fontSize: "12px" } }, "Loading..."));
      return;
    }

    const cat = catSelect.value || "daily";
    const stat = statSelect.value || "kills";
    const list = [...(cachedData?.[cat]?.[stat] || [])].sort((a, b) => (b[stat] || 0) - (a[stat] || 0));

    const query = searchInput.value.trim();
    if (query) {
      const idx = list.findIndex((p) => String(p.name || "").toLowerCase() === query.toLowerCase());
      rankBanner.textContent =
        idx >= 0
          ? `${list[idx].name} — Rank #${idx + 1} in ${cat} ${stat} (${list[idx][stat]})`
          : `"${query}" is not ranked in Top leaderboard list for ${cat} ${stat}.`;
    } else {
      rankBanner.textContent = `Showing Top ${Math.min(50, list.length)} players (${cat} • ${stat})`;
    }

    const top = list.slice(0, 50);
    if (!top.length) {
      tableWrap.appendChild(el("div", { style: { color: "var(--dih-muted)", fontSize: "12px" } }, "No leaderboard entries available."));
      return;
    }

    for (let i = 0; i < top.length; i++) {
      const row = top[i];
      const highlight = query && String(row.name || "").toLowerCase() === query.toLowerCase();
      tableWrap.appendChild(
        el("div", {
          className: "dih-panel dih-row",
          style: {
            padding: "7px 12px",
            borderColor: highlight ? "var(--dih-accent)" : undefined,
          },
        }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
            el("span", { className: "dih-mono", style: { width: "36px", color: "var(--dih-muted)", fontSize: "11px" } }, `#${i + 1}`),
            el("span", { style: { fontWeight: "600", fontSize: "12px" } }, row.name || "Player"),
          ]),
          el("span", { className: "dih-mono", style: { fontWeight: "700", fontSize: "12px" } }, `${row[stat] ?? 0} ${stat}`),
        ])
      );
    }
  }

  async function load() {
    tableWrap.innerHTML = "";
    tableWrap.appendChild(el("div", { style: { color: "var(--dih-muted)", fontSize: "12px" } }, "Fetching leaderboards..."));
    try {
      const res = await fetch("https://login.deadshot.io/leaderboards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cachedData = await res.json();
      renderTable();
    } catch (err) {
      tableWrap.innerHTML = "";
      tableWrap.appendChild(
        el("div", { style: { color: "#d98484", fontSize: "12px" } }, `Unable to load leaderboards: ${err.message}`)
      );
    }
  }

  catSelect.addEventListener("change", renderTable);
  statSelect.addEventListener("change", renderTable);
  searchInput.addEventListener("input", renderTable);
  refreshBtn.addEventListener("click", load);
  closeBtn.addEventListener("click", () => {
    closeDarkSelects?.();
    backdrop.classList.add("dih-hidden");
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeDarkSelects?.();
      backdrop.classList.add("dih-hidden");
    }
  });

  return {
    open: () => {
      backdrop.classList.remove("dih-hidden");
      if (!cachedData) load();
      else renderTable();
    },
    close: () => {
      closeDarkSelects?.();
      backdrop.classList.add("dih-hidden");
    },
  };
};
