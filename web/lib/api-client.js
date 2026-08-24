/**
 * @file api-client.js
 * @brief CaseLib HTTP capability layer (transport-agnostic catalog)
 * @note UI calls CaseApi.*; paths stay here so MCP/backends can swap later.
 *       Load before app.js. Call CaseApi.bindTransport(...) after apiGet/apiPost exist.
 * @version 1.0
 * @date 2026-08-21
 */

/* ---------------------------------------------------------------------------
 * Path catalog — single source of HTTP routes used by the live SPA
 * --------------------------------------------------------------------------- */
const CASE_API_PATHS = Object.freeze({
  /* Upstream paths (local server proxies 1:1; Network 面板可见真实接口) */
  propertyQuery: "/api/wireman-kong/ems/energy-device/property/query",
  /** @deprecated live read uses deviceDetail.dataPoints instead */
  shadowProperty: "/api/wireman-kong/ems/energy-device/query-shadow-property",
  pidSchema: "/api/wireman-kong/ems/energy-device/pid-schema",
  issue: "/api/wireman-kong/ems/energy-device/issue",
  groupDeviceIssue: "/api/wireman-kong/ems/energy-group/device/issue",
  highFrequency: "/api/smartenergy-kong/group/high/frequency",
  protocolQuery: "/api/wireman-kong/ems/energy-device/protocol/query",
  protocolModelPage: "/api/wireman-kong/ems/protocol-model/query/page",
  queryNeko: "/api/wireman-kong/ems/energy-device/query-neko",
  bizlogSearch: "/api/bizlog/search",
  homeDevice: "/inner/backendng/device/homeDevice",
  /**
   * prefix; append deviceId → /api/device/detail/{id}
   * Live DPs: result.dataPoints; SSID: result.deviceMetaShowVOList[ssid_hash]
   */
  deviceDetail: "/api/device/detail/",

  /* Local live service */
  store: "/api/store",
  cookiesImport: "/api/cookies/import",
  ssoRefresh: "/api/sso/refresh",
  ssoStatus: "/api/sso/status",
  reports: "/api/reports",
  report: "/api/report",
  reportSave: "/api/report/save",
  electionSettings: "/api/election/settings",
  electionRows: "/api/election/rows",
  electionAppend: "/api/election/append",
  electionClear: "/api/election/clear",
  electionDownload: "/api/election/download",
  models: "/api/models",
  beidouDpAbility: "/api/beidou/dp-ability",
});

/**
 * @brief Capability client. Transport is injected from app.js (cookie/auth).
 */
const CaseApi = {
  PATHS: CASE_API_PATHS,
  _tx: null,

  /**
   * @brief Bind low-level transport (apiGet / apiPost / raw fetch helpers)
   * @param[in] tx { get, post, fetchJson, fetchText? }
   * @return none
   */
  bindTransport(tx) {
    this._tx = tx || null;
  },

  _need() {
    if (!this._tx) {
      throw new Error("CaseApi: transport not bound (load api-client.js before app.js and call bindTransport)");
    }
    return this._tx;
  },

  async _get(path, homeOrHost, query) {
    return this._need().get(path, homeOrHost, query || {});
  },

  async _post(path, homeOrHost, body) {
    return this._need().post(path, homeOrHost, body);
  },

  async _fetchJson(url, init) {
    const tx = this._need();
    if (typeof tx.fetchJson === "function") {
      return tx.fetchJson(url, init || {});
    }
    const res = await fetch(url, init || {});
    const json = await res.json().catch(() => ({}));
    return { res, json };
  },

  /* -------- Device (wireman / energy-device) -------- */

  /**
   * @brief Query device properties (DP values)
   */
  queryProperties(home, query) {
    return this._get(CASE_API_PATHS.propertyQuery, home, query);
  },

  /**
   * @brief Query device shadow properties
   */
  queryShadowProperty(home, body) {
    return this._post(CASE_API_PATHS.shadowProperty, home, body);
  },

  /**
   * @brief PID → schema / DP definitions
   */
  queryPidSchema(home, query) {
    return this._get(CASE_API_PATHS.pidSchema, home, query);
  },

  /**
   * @brief Issue DP commands to one device
   */
  issueDevice(home, body) {
    return this._post(CASE_API_PATHS.issue, home, body);
  },

  /**
   * @brief Group concurrent issue
   */
  issueGroupDevice(home, body) {
    return this._post(CASE_API_PATHS.groupDeviceIssue, home, body);
  },

  /**
   * @brief High-frequency report device list for a group
   */
  queryHighFrequency(home, query) {
    return this._get(CASE_API_PATHS.highFrequency, home, query);
  },

  /**
   * @brief Protocol query for a device
   */
  queryProtocol(home, query) {
    return this._get(CASE_API_PATHS.protocolQuery, home, query);
  },

  /**
   * @brief Protocol model page
   */
  queryProtocolModelPage(home, query) {
    return this._get(CASE_API_PATHS.protocolModelPage, home, query);
  },

  /**
   * @brief SOC / series query-neko
   */
  queryNeko(home, query) {
    return this._get(CASE_API_PATHS.queryNeko, home, query);
  },

  /**
   * @brief Bizlog search (hestia host or home)
   */
  searchBizlog(homeOrHost, body) {
    return this._post(CASE_API_PATHS.bizlogSearch, homeOrHost, body);
  },

  /**
   * @brief One page of home devices (backendng)
   * @note Caller paginates; uses raw fetch with X-Target-Host backendng
   */
  async postHomeDevicePage(bnHost, cookie, body) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.homeDevice, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Target-Host": bnHost,
        "X-Cookie": cookie || "",
      },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok && json && json.ok === false) {
      return json;
    }
    return json;
  },

  /**
   * @brief Device detail / firmware versions (backendng)
   */
  async getDeviceDetail(bnHost, cookie, deviceId) {
    const id = encodeURIComponent(String(deviceId || "").trim());
    const url = `${CASE_API_PATHS.deviceDetail}${id}`;
    const tx = this._need();
    if (typeof tx.fetchText === "function") {
      return tx.fetchText(url, {
        headers: { "X-Target-Host": bnHost, "X-Cookie": cookie || "" },
      });
    }
    const res = await fetch(url, {
      headers: { "X-Target-Host": bnHost, "X-Cookie": cookie || "" },
    });
    const text = await res.text();
    return { res, text };
  },

  /* -------- Local store / auth -------- */

  async loadStore() {
    const { json } = await this._fetchJson(CASE_API_PATHS.store);
    return json;
  },

  async saveStore(store) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.store, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store }),
    });
    return { ok: res.ok && !!json?.ok, res, json };
  },

  async refreshSso(body) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.ssoRefresh, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { res, json };
  },

  async importCookies(remoteBase, cookies, merge) {
    const base = String(remoteBase || "").replace(/\/$/, "");
    const { res, json } = await this._fetchJson(`${base}${CASE_API_PATHS.cookiesImport}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies, merge: merge !== false }),
    });
    return { res, json };
  },

  /* -------- Reports -------- */

  async listReports() {
    const { json } = await this._fetchJson(CASE_API_PATHS.reports);
    return json;
  },

  async getReport(reportId, fmt) {
    const useFmt = fmt || "json";
    const q = `id=${encodeURIComponent(reportId || "")}&fmt=${encodeURIComponent(useFmt)}`;
    const url = `${CASE_API_PATHS.report}?${q}`;
    if (useFmt === "md") {
      const res = await fetch(url);
      const text = await res.text();
      return { res, text, json: null };
    }
    const { json, res } = await this._fetchJson(url);
    return { res, json, text: null };
  },

  async saveReport(body) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.reportSave, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { res, json };
  },

  /* -------- Election -------- */

  async getElectionSettings(homeId) {
    const { json } = await this._fetchJson(
      `${CASE_API_PATHS.electionSettings}?homeId=${encodeURIComponent(homeId || "")}`
    );
    return json;
  },

  async saveElectionSettings(body) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.electionSettings, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { res, json };
  },

  async getElectionRows(homeId, limit) {
    const q = `homeId=${encodeURIComponent(homeId || "")}&limit=${encodeURIComponent(String(limit || 2000))}`;
    const { json } = await this._fetchJson(`${CASE_API_PATHS.electionRows}?${q}`);
    return json;
  },

  async appendElection(body) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.electionAppend, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { res, json };
  },

  async clearElection(body) {
    const { res, json } = await this._fetchJson(CASE_API_PATHS.electionClear, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { res, json };
  },

  /* -------- Misc local -------- */

  async listModels() {
    const { json } = await this._fetchJson(CASE_API_PATHS.models);
    return json;
  },

  async getBeidouDpAbility(pid) {
    const { json } = await this._fetchJson(
      `${CASE_API_PATHS.beidouDpAbility}?pid=${encodeURIComponent(pid || "")}`
    );
    return json;
  },
};

if (typeof window !== "undefined") {
  window.CASE_API_PATHS = CASE_API_PATHS;
  window.CaseApi = CaseApi;
}
