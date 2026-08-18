/**
 * 涂鸦 SSO Token 获取与缓存管理脚本
 * 支持多环境（production/daily）、自动续期、多浏览器与 Electron 应用 Cookie 提取
 *
 * 兼容 Cursor / Claude Code / Codex 等主流 AI Agent 平台
 *
 * 获取优先级：
 *   P0   本地缓存（命中即返回，过期前自动续期）
 *   P0.5 CDP 远程调试（可选）：检测到 127.0.0.1:9222 上有 --remote-debugging-port
 *        启动的 Chrome 时，通过 DevTools Protocol 直接读已解密 cookie。
 *        主要解决 Chrome 127+ v20 ABE 用户无法手动复制的问题。
 *        通过 TUYA_CDP_PORTS=9222,9223 自定义端口；不启 CDP 时本路径静默跳过。
 *   P1   Chromium Cookie DB（Chrome / Edge / Brave / Arc / Canary / Chromium）
 *   P1d  Electron 应用（Cursor / VSCode / Code Insiders 内置浏览器 partition）
 *   P1b  Firefox Cookie DB
 *   P1c  Safari Cookies（macOS）
 *   P2   环境变量（SSO_TOKEN / LIBRA_COOKIE / SSO_TOKEN_DAILY / LIBRA_COOKIE_DAILY）
 *   P4   Cookie 文件（cookies.txt）：通过 import 子命令显式触发
 *   P5   手动设置：通过 set 子命令显式触发
 *
 * 使用方式：
 *   node scripts/sso-token.mjs get [--force] [--quiet] [--url <target-url>]
 *   node scripts/sso-token.mjs set "<cookie-value>" [--url <target-url>] [--from-set-cookie]
 *   node scripts/sso-token.mjs validate [--url <target-url>] [--quiet]
 *   node scripts/sso-token.mjs status [--env production|daily]
 *   node scripts/sso-token.mjs clear [--env production|daily]
 *   node scripts/sso-token.mjs import <cookies.txt> [--url <target-url>]
 *
 * 退出码：
 *   0 - 成功
 *   1 - 无法获取 / 命令使用错误（含 validate 的 --url 未通过白名单校验）
 *   2 - validate 命令：缓存 token 被服务端确认拒绝（cache valid 但 server invalid）
 *   3 - validate 命令：网络不通（VPN 未连 / DNS / TLS / 超时），无法判断服务端是否接受 token
 */
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import http from "http";
import https from "https";
import net from "net";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { parseArgs } from "node:util";

/* ---------------------------------------------------------------------------
 * Node.js flag bootstrap
 *
 * `node:sqlite` is built into Node.js 22.5+, but:
 *   - Node 22.5  – 22.10 require `--experimental-sqlite` to expose the module
 *                  (require/import would otherwise throw ERR_UNKNOWN_BUILTIN_MODULE)
 *   - Node 22.11 – 22.x    expose it without flag but emit ExperimentalWarning
 *                  (loud noise on every script start; we want a clean stderr)
 *   - Node 23.x+           stable, no warning
 *
 * To keep the user-facing call simple (`node scripts/sso-token.mjs ...`) we
 * detect the Node version on entry and, when needed, re-exec the same script
 * with the right flags. We only re-exec when:
 *   1. This file is the entry script (process.argv[1] points to us), AND
 *   2. The flags we want are not already present in process.execArgv, AND
 *   3. We aren't in an infinite loop (TUYA_SSO_BOOTSTRAPPED guard env var).
 *
 * Rationale for env-var guard: spawnSync inherits env to the child. If we
 * mis-detect or the child decides to re-exec again, the guard breaks the loop.
 * --------------------------------------------------------------------------- */
(function bootstrapNodeFlags() {
  if (process.env.TUYA_SSO_BOOTSTRAPPED === "1") return;

  // Only re-exec if this file is the entry script. When imported as a module
  // from another tool (rare, but defensive), re-execing would replace the
  // host process — bad behavior.
  let selfPath;
  try { selfPath = fileURLToPath(import.meta.url); } catch { return; }
  const argv1 = process.argv[1] || "";
  if (path.resolve(argv1) !== path.resolve(selfPath)) return;

  const m = /^v?(\d+)\.(\d+)\./.exec(process.versions.node);
  if (!m) return;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);

  // Decide which flags to add (do not duplicate flags the user already passed)
  const want = [];
  const has = (flag) => process.execArgv.some((a) => a === flag || a.startsWith(`${flag}=`));

  // 22.5 – 22.10: experimental flag is REQUIRED to expose node:sqlite
  if (major === 22 && minor >= 5 && minor <= 10 && !has("--experimental-sqlite")) {
    want.push("--experimental-sqlite");
  }

  // 22.11 – 22.x: node:sqlite available but emits a noisy warning every run.
  // Suppress only that one warning; do NOT blanket-suppress all warnings.
  if (major === 22 && minor >= 11 && !has("--no-warnings")) {
    want.push("--no-warnings=ExperimentalWarning");
  }

  if (want.length === 0) return;

  const result = spawnSync(
    process.execPath,
    [...want, selfPath, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, TUYA_SSO_BOOTSTRAPPED: "1" } },
  );
  process.exit(result.status == null ? 1 : result.status);
})();

/* ---------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------- */

const CACHE_DIR = path.join(os.homedir(), ".tuya");
const CACHE_FILE = path.join(CACHE_DIR, "sso-token-cache.json");
const DEFAULT_TTL = 2 * 86400; // 2 days — fallback when no Set-Cookie metadata
const REFRESH_THRESHOLD_RATIO = 0.2;
const REFRESH_THRESHOLD_SECONDS = 12 * 3600; // 12h absolute floor
const EXEC_TIMEOUT_MS = 5000;
const CHROME_EPOCH_OFFSET = 11644473600; // seconds between 1601-01-01 and 1970-01-01
const APPLE_EPOCH_OFFSET = 978307200; // seconds between 1970-01-01 and 2001-01-01 (Safari/macOS epoch)
const CHROME_GARBLED_PREFIX_LEN = 32; // 2 AES blocks — new Chrome inserts 16 bytes after "v10", garbling the first 2 decrypted blocks
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

const ENV_CONFIG = {
  production: {
    loginUrl: "https://login-cn.tuya-inc.com:7799/",
    envVars: ["SSO_TOKEN", "LIBRA_COOKIE"],
    domainPatterns: [/\.tuya-inc\.com/, /\.tuya-inc\.top/],
    chromeCookieHosts: [".tuya-inc.com"],
    // Hosts a server may 30x to when the SSO_USER_TOKEN is invalid. Used by
    // validateToken() to recognize "redirected to login" as server rejection.
    loginRedirectHosts: ["login-cn.tuya-inc.com"],
  },
  daily: {
    loginUrl: "https://login-daily.tuya-inc.cn:7799/login",
    envVars: ["SSO_TOKEN_DAILY", "LIBRA_COOKIE_DAILY"],
    domainPatterns: [/fast-inside\.tuya-inc\.cn/, /login-daily\.tuya-inc\.cn/],
    chromeCookieHosts: [".tuya-inc.cn"],
    loginRedirectHosts: ["login-daily.tuya-inc.cn"],
  },
};

// Supported Chromium-family browsers on macOS. All use the same SQLite schema
// and AES-CBC + Keychain encryption scheme — only the Safe Storage service
// name and user-data directory differ.
const CHROMIUM_BROWSERS = [
  {
    name: "Chrome",
    userDataDir: "Library/Application Support/Google/Chrome",
    keychainService: "Chrome Safe Storage",
  },
  {
    name: "Chrome Canary",
    userDataDir: "Library/Application Support/Google/Chrome Canary",
    keychainService: "Chrome Safe Storage",
  },
  {
    name: "Edge",
    userDataDir: "Library/Application Support/Microsoft Edge",
    keychainService: "Microsoft Edge Safe Storage",
  },
  {
    name: "Brave",
    userDataDir: "Library/Application Support/BraveSoftware/Brave-Browser",
    keychainService: "Brave Safe Storage",
  },
  {
    name: "Arc",
    userDataDir: "Library/Application Support/Arc/User Data",
    keychainService: "Arc Safe Storage",
  },
  {
    name: "Chromium",
    userDataDir: "Library/Application Support/Chromium",
    keychainService: "Chromium Safe Storage",
  },
];

// Windows Chromium browsers — paths computed from %LOCALAPPDATA%
const _localAppData = process.env.LOCALAPPDATA || "";
const CHROMIUM_BROWSERS_WIN = [
  { name: "Chrome",   userDataDir: path.join(_localAppData, "Google", "Chrome", "User Data") },
  { name: "Edge",     userDataDir: path.join(_localAppData, "Microsoft", "Edge", "User Data") },
  { name: "Brave",    userDataDir: path.join(_localAppData, "BraveSoftware", "Brave-Browser", "User Data") },
  { name: "Chromium", userDataDir: path.join(_localAppData, "Chromium", "User Data") },
];

// Linux Chromium browsers — XDG config paths
const CHROMIUM_BROWSERS_LINUX = [
  { name: "Chrome",   userDataDir: path.join(os.homedir(), ".config", "google-chrome") },
  { name: "Chromium", userDataDir: path.join(os.homedir(), ".config", "chromium") },
  { name: "Edge",     userDataDir: path.join(os.homedir(), ".config", "microsoft-edge") },
  { name: "Brave",    userDataDir: path.join(os.homedir(), ".config", "BraveSoftware", "Brave-Browser") },
];

// Electron desktop applications that embed a Chromium browser (Cursor / VSCode / etc).
// Their user-data layout differs from real Chromium: cookie DBs live at the app
// root (Network/Cookies) and inside per-partition subdirs (Partitions/<id>/Network/Cookies).
// Crucially, partition cookies are typically stored as PLAINTEXT in the `value` column
// (Electron does not enable os_crypt for non-default partitions by default), so they
// don't require DPAPI/Keychain — the only requirement is reading the SQLite file.
const _appDataRoaming = process.env.APPDATA || "";
const ELECTRON_APPS_MAC = [
  { name: "Cursor",          baseDir: path.join(os.homedir(), "Library", "Application Support", "Cursor") },
  { name: "VSCode",          baseDir: path.join(os.homedir(), "Library", "Application Support", "Code") },
  { name: "VSCode Insiders", baseDir: path.join(os.homedir(), "Library", "Application Support", "Code - Insiders") },
];
const ELECTRON_APPS_WIN = [
  { name: "Cursor",          baseDir: path.join(_appDataRoaming, "Cursor") },
  { name: "VSCode",          baseDir: path.join(_appDataRoaming, "Code") },
  { name: "VSCode Insiders", baseDir: path.join(_appDataRoaming, "Code - Insiders") },
];
const ELECTRON_APPS_LINUX = [
  { name: "Cursor",          baseDir: path.join(os.homedir(), ".config", "Cursor") },
  { name: "VSCode",          baseDir: path.join(os.homedir(), ".config", "Code") },
  { name: "VSCode Insiders", baseDir: path.join(os.homedir(), ".config", "Code - Insiders") },
];

/* ---------------------------------------------------------------------------
 * Diagnostics accumulator
 *
 * Every P0-P5 path that fails pushes a short, machine-readable reason here.
 * If we end up at the P5 fallback help text, we print these lines first so the
 * user (and the agent) can see WHY each path missed instead of just generic
 * "no token found" guidance.
 * --------------------------------------------------------------------------- */
const diagnostics = [];

/**
 * @brief Append a diagnostic record for the P5 fallback.
 * @param[in] category Coarse path label, e.g. "chromium", "cdp", "cursor".
 * @param[in] message  Human-readable Chinese explanation (printed verbatim).
 * @param[in] opts     Optional `{ code }` — a stable machine-readable tag used
 *                     by cmdGet to choose the recommendation order WITHOUT
 *                     reverse-parsing the localized `message` text.
 *                     Known codes:
 *                       "mac-keychain-user-canceled"  Keychain dialog canceled
 *                       "mac-keychain-unknown-fail"   Keychain failed (non-missing)
 *                       "mac-keychain-skipped-sticky" Skipped due to sticky flag
 * @note   Older call sites that only pass (category, message) keep working —
 *         `code` defaults to undefined and code-based filters simply don't match.
 */
function addDiag(category, message, opts) {
  const code = opts && typeof opts.code === "string" ? opts.code : undefined;
  diagnostics.push({ category, message, code });
}

/* ---------------------------------------------------------------------------
 * CLI argument parsing
 * --------------------------------------------------------------------------- */

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    force: { type: "boolean", short: "f", default: false },
    quiet: { type: "boolean", short: "q", default: false },
    ttl: { type: "string", default: String(DEFAULT_TTL) },
    env: { type: "string", short: "e", default: "" },
    url: { type: "string", short: "u", default: "" },
    "from-set-cookie": { type: "boolean", default: false },
  },
});

const command = positionals[0] || "get";
const cookieArg = positionals[1] || "";
const quiet = args.quiet;
const force = args.force;
const fromSetCookie = args["from-set-cookie"];
const envExplicit = args.env !== "";

const parsedTtl = parseInt(args.ttl, 10);
const ttl = Number.isNaN(parsedTtl) ? DEFAULT_TTL : parsedTtl;

let env = "production";
if (args.env === "daily") {
  env = "daily";
} else if (!envExplicit && args.url) {
  env = detectEnv(args.url);
}

/* ---------------------------------------------------------------------------
 * Utility helpers
 * --------------------------------------------------------------------------- */

function log(...messages) {
  if (!quiet) console.error(...messages);
}

function error(...messages) {
  console.error(...messages);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @brief Print a per-platform CDP launch hint (v2 / opt-in flow).
 * @param[in] indent  Leading whitespace prefix for the output lines.
 * @note   Kept module-level so cmdGet (P5 fallback) and cmdValidate (exit=2
 *         hint) share a single source of truth — when the launch arguments
 *         change once, both call sites pick it up.
 * @note   There is no `cdp` subcommand anymore (removed in the v2 refactor);
 *         the user pastes the command themselves and the script auto-detects
 *         127.0.0.1:9222 on the next `get`.
 */
function printCdpLaunchHint(indent) {
  const I = typeof indent === "string" ? indent : "  ";
  if (process.platform === "win32") {
    log(`${I}Windows (PowerShell)：`);
    log(`${I}  Start-Process chrome -ArgumentList @(`);
    log(`${I}    '--remote-debugging-port=9222',`);
    log(`${I}    "--user-data-dir=$env:LOCALAPPDATA\\TuyaSSO\\cdp-profile"`);
    log(`${I}  )`);
  } else if (process.platform === "darwin") {
    log(`${I}macOS：`);
    log(`${I}  open -na 'Google Chrome' --args \\`);
    log(`${I}    --remote-debugging-port=9222 \\`);
    log(`${I}    --user-data-dir="$HOME/.tuya/cdp-profile"`);
  } else {
    log(`${I}Linux：`);
    log(`${I}  google-chrome \\`);
    log(`${I}    --remote-debugging-port=9222 \\`);
    log(`${I}    --user-data-dir="$HOME/.tuya/cdp-profile" &`);
  }
}

function maskToken(token) {
  if (!token || token.length <= 20) return token;
  return token.substring(0, 20) + "...(" + token.length + " chars)";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "未知";
  if (seconds < 0) return "已过期";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}

/**
 * @brief Detect environment from a URL, domain, or Set-Cookie Domain attribute
 * @param[in] urlOrDomain target URL or domain string to inspect
 * @return "daily" or "production"
 */
function detectEnv(urlOrDomain) {
  if (!urlOrDomain) return "production";
  if (/fast-inside\.tuya-inc\.cn/.test(urlOrDomain)) return "daily";
  if (/login-daily\.tuya-inc\.cn/.test(urlOrDomain)) return "daily";
  if (/^\.?tuya-inc\.cn$/.test(urlOrDomain)) return "daily";
  return "production";
}

/**
 * @brief Check whether a URL is safe to send the cached cookie to
 * @param[in] urlStr   URL string supplied by the user (e.g. via --url)
 * @param[in] targetEnv environment key whose allowlist should match
 * @return true when the URL uses https and its hostname matches this env's
 *         domainPatterns; false otherwise (URL malformed / non-https / off-allowlist)
 * @note The cached SSO_USER_TOKEN is a Domain=.tuya-inc.com / .tuya-inc.cn
 *       cookie. Sending it to any host outside this allowlist is a credential
 *       leak (client-side SSRF). Always gate user-supplied URLs through this
 *       helper before issuing a cookie-bearing request.
 */
function isAllowedTargetUrl(urlStr, targetEnv) {
  if (!urlStr) return true; // caller will use ENV_CONFIG[env].loginUrl, always trusted
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const config = ENV_CONFIG[targetEnv];
  if (!config) return false;
  return config.domainPatterns.some((p) => p.test(parsed.hostname));
}

/* ---------------------------------------------------------------------------
 * SQLite engine selection (zero-dependency, with graceful fallback)
 *
 * Node.js 22.5+ ships a built-in `node:sqlite` module (experimental in 22.x,
 * stable in 23+). It removes the hard dependency on the `sqlite3` CLI binary,
 * which is NOT installed by default on Windows / many Linux base images and
 * which silently broke this script on cloud-desktop / VDI environments.
 *
 * Selection order:
 *   1. `node:sqlite` if importable (covers Node 22.5+ unflagged in 22.11+, and
 *      always in 23+; older 22.x needs --experimental-sqlite flag → user-fix)
 *   2. system `sqlite3` CLI (legacy path, retained for Node < 22.5 on Linux/macOS)
 *   3. neither → return null and accumulate a diagnostic
 *
 * Engines are probed once on first use and cached; probing is lazy so we don't
 * pay the cost on `status` / `clear` commands.
 * --------------------------------------------------------------------------- */

let _sqliteModuleCache = undefined; // undefined = not probed, null = unavailable, object = module
let _sqliteCliCache = undefined;    // undefined = not probed, false = unavailable, true = available

async function getNodeSqlite() {
  if (_sqliteModuleCache !== undefined) return _sqliteModuleCache;
  try {
    const mod = await import("node:sqlite");
    _sqliteModuleCache = mod;
  } catch {
    _sqliteModuleCache = null;
  }
  return _sqliteModuleCache;
}

function hasSqliteCli() {
  if (_sqliteCliCache !== undefined) return _sqliteCliCache;
  try {
    const probe = process.platform === "win32" ? "where sqlite3" : "command -v sqlite3";
    execSync(probe, { stdio: ["pipe", "pipe", "pipe"], timeout: EXEC_TIMEOUT_MS });
    _sqliteCliCache = true;
  } catch {
    _sqliteCliCache = false;
  }
  return _sqliteCliCache;
}

/**
 * @brief Run a read-only SQL query against a SQLite file using the best available engine
 * @param[in] dbPath  absolute path to the SQLite file
 * @param[in] sql     SQL statement; use CAST(col AS TEXT) for big integers (Chrome ms ts)
 * @param[in] options { allowCopyFallback: bool, columns: string[] }
 *                    - allowCopyFallback: when the live DB is locked (Windows
 *                      mandatory locks) try copying it to tmp first
 *                    - columns: required when the CLI fallback is used; gives
 *                      the SELECT column order so we can zip rows into objects
 *                      (node:sqlite path returns objects natively, columns ignored)
 * @return array of plain row objects on success, [] when query returns no rows,
 *         null when both engines failed or file unreadable
 * @note The query MUST return columns whose values fit in either TEXT or BLOB —
 *       big integers should be CAST'd in SQL to TEXT to avoid Number range issues.
 */
async function querySqlite(dbPath, sql, options = {}) {
  const { allowCopyFallback = true, columns = null } = options;
  if (!fs.existsSync(dbPath)) return null;

  // Try node:sqlite first (covers locked WAL DBs in read-only mode without copy)
  const mod = await getNodeSqlite();
  if (mod && mod.DatabaseSync) {
    const tryOpen = (file) => {
      try {
        const db = new mod.DatabaseSync(file, { readOnly: true });
        try {
          return { rows: db.prepare(sql).all() };
        } finally {
          try { db.close(); } catch { /* ignore */ }
        }
      } catch (err) {
        return { error: err };
      }
    };

    const direct = tryOpen(dbPath);
    if (direct.rows) return direct.rows;

    // Fall through to copy-and-open if direct failed (e.g. main-process Cookies file
    // held with mandatory lock on Windows).
    if (allowCopyFallback) {
      const tmp = path.join(os.tmpdir(), `sso-sqlite-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`);
      let copied = null;
      try {
        fs.copyFileSync(dbPath, tmp);
        copied = tryOpen(tmp);
      } catch { /* copy failed, e.g. EBUSY */ }
      finally {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
      if (copied?.rows) return copied.rows;
    }
  }

  // Legacy fallback: sqlite3 CLI (requires `columns` to assemble objects)
  if (hasSqliteCli() && Array.isArray(columns) && columns.length > 0) {
    const tmp = path.join(os.tmpdir(), `sso-sqlite-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`);
    try {
      fs.copyFileSync(dbPath, tmp);
    } catch {
      return null;
    }
    try {
      // 0x1f (ASCII Unit Separator) is unlikely to appear inside cookie values
      const out = execSync(`sqlite3 -separator "\u001f" "${tmp}"`, {
        input: sql,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: EXEC_TIMEOUT_MS,
      }).trim();
      if (!out) return [];
      return out.split("\n").map((line) => {
        const parts = line.split("\u001f");
        const obj = {};
        for (let i = 0; i < columns.length; i++) obj[columns[i]] = parts[i] ?? null;
        return obj;
      });
    } catch {
      return null;
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }

  return null;
}

/* ---------------------------------------------------------------------------
 * Set-Cookie parser
 * --------------------------------------------------------------------------- */

/**
 * @brief Parse a Set-Cookie header string into structured data
 * @param[in] header raw Set-Cookie header value
 * @return object with { name, value, cookie, maxAge?, expiresAt?, domain? } or null
 */
function parseSetCookie(header) {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  const cookiePart = parts[0];
  if (!cookiePart || !cookiePart.includes("=")) return null;

  const eqIdx = cookiePart.indexOf("=");
  const name = cookiePart.substring(0, eqIdx).trim();
  const value = cookiePart.substring(eqIdx + 1).trim();

  const attrs = {};
  for (let i = 1; i < parts.length; i++) {
    const [k, ...rest] = parts[i].split("=");
    attrs[k.trim().toLowerCase()] = rest.join("=").trim() || true;
  }

  const result = { name, value, cookie: `${name}=${value}` };

  if (attrs["max-age"]) {
    result.maxAge = parseInt(attrs["max-age"], 10);
    result.expiresAt = new Date(Date.now() + result.maxAge * 1000).toISOString();
  } else if (attrs.expires) {
    const expiresDate = new Date(attrs.expires);
    if (!isNaN(expiresDate.getTime())) {
      result.expiresAt = expiresDate.toISOString();
      result.maxAge = Math.round((expiresDate.getTime() - Date.now()) / 1000);
    }
  }

  if (attrs.domain) result.domain = attrs.domain;
  return result;
}

/* ---------------------------------------------------------------------------
 * Cache operations (multi-environment)
 * --------------------------------------------------------------------------- */

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  }
}

function readAllCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    if (data.cookie && typeof data.cookie === "string") {
      const migrated = { production: data };
      writeAllCache(migrated);
      return migrated;
    }
    return data;
  } catch {
    return {};
  }
}

function writeAllCache(data) {
  ensureCacheDir();
  const tmpFile = CACHE_FILE + ".tmp." + process.pid;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, CACHE_FILE);
}

function readCache(targetEnv) {
  return readAllCache()[targetEnv] || null;
}

function writeCache(cookie, source, targetEnv, extra = {}) {
  const all = readAllCache();
  all[targetEnv] = {
    cookie,
    updatedAt: new Date().toISOString(),
    source,
    ttl,
    ...extra,
  };
  writeAllCache(all);
  const lifeLabel = extra.maxAge != null ? formatDuration(extra.maxAge) : formatDuration(ttl);
  log(`[${targetEnv}] Token 已缓存 → ${CACHE_FILE}`);
  log(`来源: ${source} | 有效期: ${lifeLabel}`);
}

/* ---------------------------------------------------------------------------
 * Validity & refresh logic
 * --------------------------------------------------------------------------- */

function isCacheValid(cache) {
  if (!cache?.cookie || !cache?.updatedAt) return false;
  if (cache.expiresAt) {
    return Date.now() < new Date(cache.expiresAt).getTime();
  }
  const cacheTtl = cache.ttl || DEFAULT_TTL;
  const elapsed = (Date.now() - new Date(cache.updatedAt).getTime()) / 1000;
  return elapsed < cacheTtl;
}

function shouldRefresh(cache) {
  if (!cache?.cookie || !cache?.updatedAt) return false;

  let expiresAtMs;
  if (cache.expiresAt) {
    expiresAtMs = new Date(cache.expiresAt).getTime();
  } else {
    const cacheTtl = cache.ttl || DEFAULT_TTL;
    expiresAtMs = new Date(cache.updatedAt).getTime() + cacheTtl * 1000;
  }

  const remainingSec = (expiresAtMs - Date.now()) / 1000;
  if (remainingSec <= 0) return true;

  const totalLife = cache.maxAge || cache.ttl || DEFAULT_TTL;
  return remainingSec < totalLife * REFRESH_THRESHOLD_RATIO
    || remainingSec < REFRESH_THRESHOLD_SECONDS;
}

/* ---------------------------------------------------------------------------
 * HTTP helper (Node.js built-in, no dependencies)
 * --------------------------------------------------------------------------- */

function httpsGet(url, headers = {}, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      headers,
      timeout: 10000,
    }, (res) => {
      if (maxRedirects > 0 && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, url).href;
        // Carry Set-Cookie from redirect response
        const prevCookies = res.headers["set-cookie"] || [];
        httpsGet(redirectUrl, headers, maxRedirects - 1)
          .then((finalResp) => {
            const merged = [
              ...(Array.isArray(prevCookies) ? prevCookies : [prevCookies]),
              ...(Array.isArray(finalResp.headers["set-cookie"]) ? finalResp.headers["set-cookie"] : finalResp.headers["set-cookie"] ? [finalResp.headers["set-cookie"]] : []),
            ];
            if (merged.length > 0) finalResp.headers["set-cookie"] = merged;
            resolve(finalResp);
          })
          .catch(reject);
        return;
      }
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
      }));
      res.resume();
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.end();
  });
}

/* ---------------------------------------------------------------------------
 * Active server-side validation
 *
 * Cache freshness (TTL / expiresAt) only reflects what the *client* believes.
 * The server may have invalidated the session earlier (cross-device sign-in,
 * admin revoke, IP/fingerprint mismatch — common on cloud desktops / VDI /
 * RDP). Active validation hits a real internal endpoint with the cached
 * cookie and judges by status / Set-Cookie / Location.
 * --------------------------------------------------------------------------- */

/**
 * @brief Probe an internal URL with the cached cookie and judge whether the
 *        server still accepts the token
 * @param[in] targetEnv environment key
 * @param[in] cookie cached cookie string
 * @param[in] targetUrl URL to probe (default: env login URL)
 * @return `{ valid, reason, statusCode?, location?, refreshed? }`
 *         valid === true   server accepts the token
 *         valid === false  server rejected the token (login redirect / 401 / 403 / unexpected status)
 *         valid === null   network layer failure — cannot determine server's stance
 *                          (VPN not connected, DNS failure, TLS handshake error, timeout, etc.)
 * @note Disables redirect following so we can see the original 30x → login
 */
async function validateToken(targetEnv, cookie, targetUrl) {
  const config = ENV_CONFIG[targetEnv];
  if (!config) return { valid: false, reason: "unknown env" };

  const url = targetUrl || config.loginUrl;
  let resp;
  try {
    resp = await httpsGet(url, { cookie }, 0);
  } catch (err) {
    // Network-level failure: connection refused / TLS handshake / DNS / timeout.
    // We CANNOT tell whether the server would have accepted the token — only that
    // we couldn't reach it. Report `valid: null` so the agent doesn't trigger a
    // misleading "force refresh" when the real issue is no VPN / no internal access.
    return { valid: null, reason: `network unreachable: ${err.message}` };
  }

  const setCookies = resp.headers["set-cookie"];
  const cookieList = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  const refreshedToken = cookieList
    .map(parseSetCookie)
    .find((c) => c?.name === "SSO_USER_TOKEN" && c.value);

  if (refreshedToken) {
    return {
      valid: true,
      reason: "server refreshed SSO_USER_TOKEN",
      statusCode: resp.statusCode,
      refreshed: refreshedToken,
    };
  }

  const status = resp.statusCode;
  const location = String(resp.headers.location || "");
  const loginHosts = config.loginRedirectHosts || [];
  const isLoginRedirect = loginHosts.some((h) => location.includes(h));

  if (status >= 300 && status < 400 && isLoginRedirect) {
    return { valid: false, reason: `redirected to login (${status})`, statusCode: status, location };
  }
  if (status === 401 || status === 403) {
    return { valid: false, reason: `unauthorized (${status})`, statusCode: status };
  }
  if (status >= 200 && status < 300) {
    return { valid: true, reason: `200 OK (no token refresh needed)`, statusCode: status };
  }
  if (status >= 300 && status < 400) {
    return { valid: true, reason: `redirected to non-login (${status} → ${location})`, statusCode: status, location };
  }
  return { valid: false, reason: `unexpected status ${status}`, statusCode: status };
}

/* ---------------------------------------------------------------------------
 * Auto-refresh: visit login URL with current cookie, extract new token
 * --------------------------------------------------------------------------- */

async function refreshToken(targetEnv, currentCookie) {
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;

  try {
    log(`[${targetEnv}] 尝试自动续期...`);
    const resp = await httpsGet(config.loginUrl, { cookie: currentCookie });

    const setCookieHeaders = resp.headers["set-cookie"];
    if (!setCookieHeaders) return null;

    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const h of headers) {
      const parsed = parseSetCookie(h);
      if (parsed?.name === "SSO_USER_TOKEN" && parsed.value) {
        log(`[${targetEnv}] 自动续期成功`);
        return parsed;
      }
    }
    return null;
  } catch (err) {
    log(`[${targetEnv}] 自动续期失败: ${err.message}`);
    return null;
  }
}

/**
 * @brief Try to refresh token and write to cache
 * @param[in] targetEnv environment key
 * @param[in] currentCookie current cookie string
 * @return refreshed cookie string, or null on failure
 */
async function tryRefreshAndCache(targetEnv, currentCookie) {
  const refreshed = await refreshToken(targetEnv, currentCookie);
  if (!refreshed) return null;
  writeCache(refreshed.cookie, "auto-refresh", targetEnv, {
    ...(refreshed.maxAge != null && { maxAge: refreshed.maxAge }),
    ...(refreshed.expiresAt && { expiresAt: refreshed.expiresAt }),
  });
  return refreshed.cookie;
}

/* ---------------------------------------------------------------------------
 * Chrome Cookie DB extraction (all platforms, zero interaction)
 * --------------------------------------------------------------------------- */

/**
 * @brief Extract a printable cookie value from a decrypted buffer
 *
 * New Chrome builds insert 16 extra bytes (e.g. key version / nonce) right
 * after the "v10" marker but still encrypt with AES-128-CBC + a fixed IV.
 * Because those 16 bytes are treated as ciphertext, CBC decryption produces
 * garbage for the first 2 blocks (32 bytes) while the remainder is correct.
 * This helper returns the clean ASCII-printable value, stripping the garbage
 * prefix when detected.
 *
 * @param[in] decrypted raw Buffer produced by AES-128-CBC decryption
 * @return printable value string, or null when no clean value can be recovered
 */
function extractPrintableCookieValue(decrypted) {
  if (!decrypted || decrypted.length === 0) return null;

  // Fast path: legacy (pre-extra-prefix) Chrome — whole buffer is already the token
  const direct = decrypted.toString("utf-8");
  if (PRINTABLE_ASCII_RE.test(direct)) return direct;

  // Newer Chrome inserts extra bytes after the "v10" marker. Depending on
  // whether the inserted bytes act as a nonce-IV (1 garbled block) or as a
  // leading ciphertext block (2 garbled blocks), the correct recovery is to
  // strip either 16 or 32 bytes. We try 16 first (shorter skip = more data),
  // then fall back to 32.
  for (const skip of [16, CHROME_GARBLED_PREFIX_LEN]) {
    if (decrypted.length > skip) {
      const stripped = decrypted.subarray(skip).toString("utf-8");
      if (PRINTABLE_ASCII_RE.test(stripped)) {
        log(`Chrome Cookie 解密跳过 ${skip} 字节乱码前缀，恢复 ${stripped.length} 字节 token`);
        return stripped;
      }
    }
  }
  return null;
}

/**
 * @brief Enumerate all Chromium user profile directories inside a user-data-dir
 * @param[in] userDataPath absolute path to the browser's User Data directory
 * @return array of absolute profile directory paths (Default, Profile 1, ...)
 */
function listChromiumProfiles(userDataPath) {
  const profiles = [];
  const candidate = (name) => {
    const p = path.join(userDataPath, name);
    if (fs.existsSync(path.join(p, "Cookies"))) profiles.push(p);
  };
  candidate("Default");

  // Parse Local State for the canonical profile list when available
  const localStatePath = path.join(userDataPath, "Local State");
  if (fs.existsSync(localStatePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
      const infoCache = state?.profile?.info_cache || {};
      for (const name of Object.keys(infoCache)) {
        if (name === "Default") continue;
        candidate(name);
      }
    } catch { /* fall through to directory scan */ }
  }

  // Fallback: scan for Profile N directories that were not in info_cache
  try {
    for (const entry of fs.readdirSync(userDataPath)) {
      if (/^Profile \d+$/.test(entry) && !profiles.includes(path.join(userDataPath, entry))) {
        candidate(entry);
      }
    }
  } catch { /* userDataPath may not exist */ }

  return profiles;
}

/**
 * @brief Retrieve the AES key derived from a browser's Keychain "Safe Storage" entry
 * @param[in] keychainService Keychain service name, e.g. "Chrome Safe Storage"
 * @return `{ key, reason }` — key is a 16-byte Buffer on success, null otherwise.
 *         reason categorizes failure:
 *           "ok"               — key derived
 *           "user-canceled"    — user clicked Cancel on the Keychain dialog
 *                                (exit 128 + stderr "User canceled" / similar)
 *           "entry-not-found"  — no Safe Storage item for this service
 *                                (browser not installed or never created Cookie store)
 *           "unknown"          — `security` failed for other reasons
 * @note Distinguishing "user-canceled" from "entry-not-found" lets the caller
 *       short-circuit subsequent Chromium browsers in the same run — without
 *       this, Chrome → Edge → Brave → Arc each pop their own Keychain dialog
 *       even after the user has clearly decided not to authorize.
 */
function deriveBrowserKey(keychainService) {
  let password;
  try {
    password = execSync(
      `security find-generic-password -s "${keychainService.replace(/"/g, '\\"')}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: EXEC_TIMEOUT_MS },
    ).trim();
  } catch (err) {
    const exitCode = typeof err?.status === "number" ? err.status : null;
    const stderr = String(err?.stderr || "");
    // macOS `security` exit codes / messages we care about:
    //   - User canceled the auth dialog: exit 128 + stderr contains
    //     "User canceled the operation" (also seen: "The user name or
    //     passphrase you entered is not correct")
    //   - Entry not found: exit 44 + stderr "could not be found"
    let reason = "unknown";
    if (exitCode === 128 || /user canceled|user denied|not allowed/i.test(stderr)) {
      reason = "user-canceled";
    } else if (exitCode === 44 || /could not be found|specified item could not be found/i.test(stderr)) {
      reason = "entry-not-found";
    }
    return { key: null, reason };
  }
  return { key: crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1"), reason: "ok" };
}

/**
 * @brief Read and DPAPI-decrypt the Chromium master key from a Windows Local State file
 * @param[in] localStatePath absolute path to "Local State" JSON file
 * @return 32-byte AES-256-GCM key Buffer, or null on any failure
 * @note Uses PowerShell -EncodedCommand to avoid shell quoting issues.
 *       v20 (App-Bound Encryption, Chrome 127+) keys are NOT accessible this way.
 */
function getWindowsChromiumKey(localStatePath) {
  try {
    if (!fs.existsSync(localStatePath)) return null;
    const state = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
    const encKeyB64 = state?.os_crypt?.encrypted_key;
    if (!encKeyB64) return null;

    const encKeyBytes = Buffer.from(encKeyB64, "base64");
    if (encKeyBytes.length <= 5) return null;
    // Strip the leading "DPAPI" ASCII prefix (5 bytes) added by Chrome
    const dpApiBlob = encKeyBytes.subarray(5);
    const dpApiBlobB64 = dpApiBlob.toString("base64");

    // Use PowerShell -EncodedCommand (Base64 UTF-16LE) to avoid any quoting issues
    const psScript = `[Console]::OutputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Security;` +
      `$k=[Convert]::FromBase64String('${dpApiBlobB64}');` +
      `$d=[Security.Cryptography.ProtectedData]::Unprotect($k,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);` +
      `[Convert]::ToBase64String($d)`;
    const encodedCmd = Buffer.from(psScript, "utf16le").toString("base64");

    const result = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCmd}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: EXEC_TIMEOUT_MS,
    }).trim();

    if (!result) return null;
    return Buffer.from(result, "base64");
  } catch {
    return null;
  }
}

/**
 * @brief Get candidate AES keys for Chromium cookie decryption on Linux
 * @return array of 16-byte key Buffers to try (SecretService first, then fallbacks)
 * @note Linux Chrome uses PBKDF2-SHA1 with 1 iteration (not 1003 like macOS).
 *       Tries GNOME SecretService via secret-tool, falls back to hardcoded passwords.
 */
function getLinuxChromiumKeys() {
  const pbkdf2 = (pw) => crypto.pbkdf2Sync(pw, "saltysalt", 1, 16, "sha1");

  // Try GNOME Keyring / KWallet via secret-tool
  const lookups = [
    "xdg:schema chrome_libsecret_os_crypt_password_v2 application chrome",
    "xdg:schema chrome_libsecret_os_crypt_password_v1 application chrome",
    "xdg:schema chrome_libsecret_os_crypt_password_v2 application chromium",
    "xdg:schema chrome_libsecret_os_crypt_password_v1 application chromium",
  ];
  for (const attrs of lookups) {
    try {
      const password = execSync(`secret-tool lookup ${attrs}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: EXEC_TIMEOUT_MS,
      }).trim();
      if (password) return [pbkdf2(password)];
    } catch { /* secret-tool unavailable or attribute not found */ }
  }

  // Fallback: Chrome <v100 used "peanuts"; some builds use empty string
  return [pbkdf2("peanuts"), pbkdf2("")];
}

/**
 * @brief Decrypt a Windows Chromium cookie blob using AES-256-GCM
 * @param[in] encBuf raw encrypted_value bytes (v10/v11 prefix + 12-byte nonce + cipher + 16-byte tag)
 * @param[in] key    32-byte AES key from Local State + DPAPI
 * @return decrypted token string, or null on failure
 */
function decryptChromiumValueGCM(encBuf, key) {
  if (!encBuf || encBuf.length < 31) return null; // 3 prefix + 12 nonce + 0 data + 16 tag
  const prefix = encBuf.toString("utf-8", 0, 3);

  if (prefix === "v20") {
    log("Chrome Cookie 使用 v20 App-Bound-Encryption（Chrome 127+），独立进程无法解密");
    log("可改用：① CDP 远程调试（P0.5；让 Chrome 自己交还解密 cookie）");
    log("        ② Cursor / VSCode 内置浏览器登录（P1d）");
    log("        ③ 手动复制 cookie（P5）");
    return null;
  }
  if (prefix !== "v10" && prefix !== "v11") {
    log(`Chrome Cookie (Windows) 加密前缀 "${prefix}" 暂不支持`);
    return null;
  }

  try {
    const nonce = encBuf.subarray(3, 15);                    // 12-byte GCM nonce
    const authTag = encBuf.subarray(encBuf.length - 16);     // last 16 bytes = GCM auth tag
    const ciphertext = encBuf.subarray(15, encBuf.length - 16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const val = decrypted.toString("utf-8");
    return PRINTABLE_ASCII_RE.test(val) ? val : null;
  } catch (err) {
    log(`Chrome Cookie (Windows) GCM 解密异常: ${err.message}`);
    return null;
  }
}

/**
 * @brief Query the SSO_USER_TOKEN row directly from a live Chromium Cookies DB
 * @param[in] cookieDb absolute path to a Chromium Cookies SQLite file
 * @param[in] config   ENV_CONFIG entry for the target environment
 * @return `{ value, hexValue, expiresUtcStr }` or null when not found
 * @note  - `value` is the plaintext cookie value (Electron partitions / older
 *           Chromium without os_crypt); empty string when only encrypted_value present
 *         - `hexValue` is hex-encoded `encrypted_value` (standard Chromium path)
 *         - `expiresUtcStr` is the raw expires_utc as TEXT (avoids Number range issues)
 *         Caller decides which to use: prefer `value` when non-empty, else
 *         decrypt `hexValue` with the per-browser key.
 */
async function queryCookieRow(cookieDb, config) {
  const hostClauses = config.chromeCookieHosts
    .map((h) => `host_key LIKE '%' || '${h.replace(/'/g, "''")}'`)
    .join(" OR ");
  const sql = `
    SELECT
      COALESCE(value, '') AS value,
      hex(encrypted_value) AS hexValue,
      CAST(expires_utc AS TEXT) AS expiresUtcStr
    FROM cookies
    WHERE (${hostClauses}) AND name='SSO_USER_TOKEN'
    ORDER BY last_access_utc DESC
    LIMIT 1
  `;
  const rows = await querySqlite(cookieDb, sql, { columns: ["value", "hexValue", "expiresUtcStr"] });
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  if (!row.value && !row.hexValue) return null;
  return row;
}

/**
 * @brief Decrypt a Chromium encrypted_value blob using the derived AES key
 * @param[in] encBuf raw encrypted_value bytes (including version prefix)
 * @param[in] key    16-byte AES key from the Keychain
 * @return decrypted token string, or null when the blob uses an unsupported scheme
 * @note v10/v11: AES-128-CBC + fixed IV. v20: App-Bound-Encryption requiring
 *       the Chrome elevation service — cannot decrypt from a standalone process.
 */
function decryptChromiumValue(encBuf, key) {
  if (!encBuf || encBuf.length <= 3) return null;
  const prefix = encBuf.toString("utf-8", 0, 3);

  if (prefix === "v20") {
    log("Chrome Cookie 使用 v20 App-Bound-Encryption（Chrome 127+），本地解密已不可行");
    log("可改用：① CDP 远程调试（P0.5；让 Chrome 自己交还解密 cookie）");
    log("        ② Cursor / VSCode 内置浏览器登录（P1d）");
    log("        ③ 手动复制 cookie（P5）");
    return null;
  }
  if (prefix !== "v10" && prefix !== "v11") {
    log(`Chrome Cookie 加密前缀 "${prefix}" 暂不支持`);
    return null;
  }

  try {
    const iv = Buffer.alloc(16, 0x20);
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
      decipher.update(encBuf.subarray(3)),
      decipher.final(),
    ]);
    return extractPrintableCookieValue(decrypted);
  } catch (err) {
    log(`Chrome Cookie 解密异常: ${err.message}`);
    return null;
  }
}

/**
 * @brief Build a result object from a queryCookieRow result
 * @param[in] row        result from queryCookieRow ({ value, hexValue, expiresUtcStr })
 * @param[in] tokenValue decrypted (or already-plaintext) cookie value
 * @param[in] sourceTag  short identifier for the source (e.g. "chrome", "cursor")
 * @return `{ cookie, source, expiresAt?, maxAge? }`
 */
function buildCookieResult(row, tokenValue, sourceTag) {
  const out = {
    cookie: `SSO_USER_TOKEN=${tokenValue}`,
    source: `${sourceTag}-cookie-db`,
  };
  if (row.expiresUtcStr) {
    // Chrome stores expires_utc as microseconds since 1601-01-01.
    // Use BigInt parsing for precision (the value can exceed Number.MAX_SAFE_INTEGER).
    let expiresUnixSec;
    try {
      const expiresMicros = BigInt(String(row.expiresUtcStr));
      const microsAfterUnixEpoch = expiresMicros - BigInt(CHROME_EPOCH_OFFSET) * 1000000n;
      expiresUnixSec = Number(microsAfterUnixEpoch / 1000000n);
    } catch {
      expiresUnixSec = NaN;
    }
    if (Number.isFinite(expiresUnixSec) && expiresUnixSec > 0) {
      out.expiresAt = new Date(expiresUnixSec * 1000).toISOString();
      out.maxAge = Math.max(0, Math.round(expiresUnixSec - Date.now() / 1000));
    }
  }
  return out;
}

/**
 * @brief Try to extract SSO_USER_TOKEN from all Chromium browsers + profiles
 * @param[in] targetEnv environment key
 * @return `{ cookie, expiresAt?, maxAge?, source? }` or null
 * @note Supports macOS (Keychain + AES-CBC), Windows (DPAPI + AES-GCM), Linux (SecretService + AES-CBC)
 *       Plaintext `value` column is preferred when present (covers Chromium builds
 *       that did not enable os_crypt for some reason).
 */
async function getFromChromeCookieDB(targetEnv) {
  const platform = process.platform;
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;

  let browsers;
  if (platform === "darwin") {
    browsers = CHROMIUM_BROWSERS.map((b) => ({ ...b, absUserDataDir: path.join(os.homedir(), b.userDataDir) }));
  } else if (platform === "win32") {
    browsers = CHROMIUM_BROWSERS_WIN.map((b) => ({ ...b, absUserDataDir: b.userDataDir }));
  } else if (platform === "linux") {
    browsers = CHROMIUM_BROWSERS_LINUX.map((b) => ({ ...b, absUserDataDir: b.userDataDir }));
  } else {
    addDiag("chromium", `平台 ${platform} 不在 Chromium 扫描覆盖范围`);
    return null;
  }

  const installedBrowsers = browsers.filter((b) => fs.existsSync(b.absUserDataDir));
  if (installedBrowsers.length === 0) {
    addDiag("chromium", `${platform} 平台未发现任何已安装的 Chromium 系浏览器（Chrome/Edge/Brave/Chromium）`);
    return null;
  }

  // macOS: Keychain cache per keychainService (to avoid duplicate prompts).
  // Stores `{ key, reason }` so caller can distinguish user-canceled vs missing-entry.
  const macKeyCache = new Map();
  // macOS: sticky flag — if the user explicitly canceled the Keychain prompt
  // for ANY Chromium browser, do NOT pop the dialog again for sibling browsers
  // in the same run (different keychainService → otherwise would re-prompt).
  // This is the single biggest UX improvement for the common "user clicked
  // Cancel and got 4 more Keychain dialogs" complaint.
  let macKeychainUserCanceled = false;
  // Windows: master key cache per userDataDir (one Local State per browser install)
  const winKeyCache = new Map();
  // Linux: candidate keys computed once per run
  let linuxKeys = null;

  let anyProfileMatched = false; // a profile had the cookie row but couldn't decrypt

  for (const browser of installedBrowsers) {
    const userDataDir = browser.absUserDataDir;
    const profiles = listChromiumProfiles(userDataDir);
    if (profiles.length === 0) continue;

    // Windows: get master key from Local State before iterating profiles
    if (platform === "win32" && !winKeyCache.has(userDataDir)) {
      winKeyCache.set(userDataDir, getWindowsChromiumKey(path.join(userDataDir, "Local State")));
    }
    if (platform === "win32" && !winKeyCache.get(userDataDir)) {
      addDiag("chromium", `${browser.name}: Local State 解密失败（DPAPI 失败 / 用户 SID 漂移 / Profile 损坏）`);
      continue;
    }

    // Linux: derive candidate keys once per process
    if (platform === "linux" && !linuxKeys) {
      linuxKeys = getLinuxChromiumKeys();
    }

    for (const profilePath of profiles) {
      const cookieDb = path.join(profilePath, "Cookies");
      const profileLabel = path.basename(profilePath);

      const row = await queryCookieRow(cookieDb, config);
      if (!row) continue;

      anyProfileMatched = true;

      // Step 1: prefer plaintext value (rare for Chromium proper, but defensive)
      if (row.value && row.value.length > 0) {
        log(`[${targetEnv}] 命中 ${browser.name} / ${profileLabel}（明文 value）`);
        return buildCookieResult(row, row.value, browser.name.toLowerCase().replace(/\s+/g, "-"));
      }

      // Step 2: decrypt encrypted_value based on platform
      if (!row.hexValue) continue;
      const encBuf = Buffer.from(row.hexValue, "hex");
      let val = null;

      if (platform === "darwin") {
        // Stickily short-circuit if the user already declined / errored on
        // ANY Chromium Keychain prompt in this run — even for a different
        // keychainService (Chrome vs Edge vs Brave …). This is the single
        // biggest UX win: "canceled once → got 4 more dialogs" was the #1
        // complaint, and we trade a tiny amount of completeness for it.
        if (macKeychainUserCanceled) {
          addDiag(
            "chromium",
            `${browser.name}: 跳过 Keychain 查询（用户已在本次会话中取消 Chromium Safe Storage 授权弹窗，不再追加打扰）`,
            { code: "mac-keychain-skipped-sticky" },
          );
          continue;
        }
        let cached = macKeyCache.get(browser.keychainService);
        if (!cached) {
          cached = deriveBrowserKey(browser.keychainService);
          macKeyCache.set(browser.keychainService, cached);
        }
        if (cached.reason === "entry-not-found") {
          // Browser installed but never generated a Safe Storage item — this
          // is a genuine "no data here", does NOT mean the user said no, so
          // we do NOT arm the sticky flag. Sibling Chromium browsers may
          // still try (and pop their own legitimate prompt).
          addDiag(
            "chromium",
            `${browser.name}: Keychain 未找到 Safe Storage 条目（浏览器未生成过 cookie 加密项）`,
            { code: "mac-keychain-entry-missing" },
          );
          continue;
        }
        if (cached.reason !== "ok" || !cached.key) {
          // user-canceled / unknown / any non-ok failure → treat them all as
          // "user has expressed disinterest in granting access". Arming the
          // sticky flag is safer than letting the next browser re-prompt:
          // macOS `security` exit codes are unreliable across versions
          // (Touch ID, errSecAuthFailed=115, errSecUserCanceled=128 after
          // 8-bit truncation, etc.), so we cannot trust the exit code alone
          // to distinguish "definitely canceled" from "something else".
          const isCanceled = cached.reason === "user-canceled";
          macKeychainUserCanceled = true;
          log(`[${targetEnv}] ${browser.name} Keychain ${isCanceled ? "授权被用户取消" : "授权失败"}，跳过（已设置 sticky 标志）`);
          addDiag(
            "chromium",
            `${browser.name}: Keychain ${isCanceled ? "授权被用户取消" : `授权失败（${cached.reason}）`}（已设置 sticky 标志，后续 Chromium 浏览器不再弹窗）`,
            { code: isCanceled ? "mac-keychain-user-canceled" : "mac-keychain-unknown-fail" },
          );
          continue;
        }
        val = decryptChromiumValue(encBuf, cached.key);
      } else if (platform === "win32") {
        val = decryptChromiumValueGCM(encBuf, winKeyCache.get(userDataDir));
      } else if (platform === "linux") {
        for (const key of linuxKeys) {
          val = decryptChromiumValue(encBuf, key);
          if (val) break;
        }
      }

      if (!val) {
        addDiag("chromium", `${browser.name} / ${profileLabel}: 找到 SSO_USER_TOKEN 行但解密失败（v20 ABE / 不支持的加密版本）`);
        continue;
      }

      log(`[${targetEnv}] 命中 ${browser.name} / ${profileLabel}`);
      return buildCookieResult(row, val, browser.name.toLowerCase().replace(/\s+/g, "-"));
    }
  }

  if (!anyProfileMatched) {
    addDiag("chromium", `已扫描 ${installedBrowsers.map((b) => b.name).join("/")}，未找到 SSO_USER_TOKEN 行（这些浏览器未登录涂鸦内网？）`);
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Electron desktop apps Cookie DB extraction (Cursor / VSCode / VSCode Insiders)
 *
 * Background:
 *   Cursor and VSCode embed Chromium and expose a built-in browser / webview
 *   (e.g. cursor-ide-browser, the "Open Browser" command, MCP browser tools).
 *   When a user logs into an internal SSO inside that built-in browser, the
 *   cookies land under the app's user-data dir, NOT under Chrome / Edge.
 *
 * Layout (Windows example, mirrored on macOS / Linux):
 *   %APPDATA%\Cursor\
 *     Local State                           — JSON, has os_crypt.encrypted_key
 *     Network\Cookies                       — main-process cookies (often locked while app runs)
 *     Partitions\<partition_id>\Network\Cookies  — per-webview-partition cookies
 *
 * Critical observation (verified empirically on Cursor 1.x Windows):
 *   Partition cookies store the SSO_USER_TOKEN as PLAINTEXT in the `value`
 *   column — `encrypted_value` is empty. This is because Electron does not
 *   enable os_crypt for non-default partitions by default. So this path is
 *   especially attractive on cloud desktops / VDI where:
 *     - Chrome / Edge are NOT installed
 *     - sqlite3 CLI is NOT installed
 *     - DPAPI may fail due to roaming-profile SID drift
 *   …yet a Cursor login inside the built-in browser is fully readable with
 *   only `node:sqlite` (built into Node 22.5+) and zero decryption.
 *
 * The main-process Cookies file is usually held with a Windows mandatory
 * lock. We try direct read-only open first (works for most partition DBs),
 * then copy-then-open as fallback (works when the file is closed-shareable).
 * --------------------------------------------------------------------------- */

/**
 * @brief Enumerate all cookie DB candidates inside an Electron app's user-data dir
 * @param[in] baseDir absolute path to the app's user-data directory
 * @return array of `{ partition, dbPath }` — partition is "main" for the root
 *         Network/Cookies, or the partition subdir name for per-webview cookies
 */
function listElectronCookieDbs(baseDir) {
  const out = [];
  const mainDb = path.join(baseDir, "Network", "Cookies");
  if (fs.existsSync(mainDb)) out.push({ partition: "main", dbPath: mainDb });

  const partitionsDir = path.join(baseDir, "Partitions");
  if (fs.existsSync(partitionsDir)) {
    let entries = [];
    try { entries = fs.readdirSync(partitionsDir); } catch { /* ignore */ }
    for (const name of entries) {
      const dbPath = path.join(partitionsDir, name, "Network", "Cookies");
      if (fs.existsSync(dbPath)) out.push({ partition: name, dbPath });
    }
  }
  return out;
}

/**
 * @brief Try to extract SSO_USER_TOKEN from Cursor / VSCode / VSCode Insiders cookie DBs
 * @param[in] targetEnv environment key
 * @return `{ cookie, expiresAt?, maxAge?, source? }` or null
 * @note Plaintext value is preferred (the common case for Electron partitions).
 *       Encrypted-value decryption for Electron apps is intentionally NOT
 *       implemented yet — the per-app Keychain/DPAPI service-name is not
 *       standardized across apps and the plaintext path covers ≥ 99% of cases.
 *       Falls back to addDiag() when an encrypted-only row is encountered so
 *       the user understands why a hit didn't materialize.
 */
async function getFromElectronCookieDB(targetEnv) {
  const platform = process.platform;
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;

  let apps;
  if (platform === "darwin")      apps = ELECTRON_APPS_MAC;
  else if (platform === "win32")  apps = ELECTRON_APPS_WIN;
  else if (platform === "linux")  apps = ELECTRON_APPS_LINUX;
  else {
    addDiag("electron", `平台 ${platform} 不在 Electron 应用扫描覆盖范围`);
    return null;
  }

  const installedApps = apps.filter((a) => fs.existsSync(a.baseDir));
  if (installedApps.length === 0) {
    addDiag("electron", `${platform} 平台未发现已安装的 Electron 桌面应用（Cursor / VSCode / Code Insiders）`);
    return null;
  }

  let anyDbHit = false;       // any DB returned a row for SSO_USER_TOKEN
  let anyEncrypted = false;   // any row was encrypted-only (skipped)

  for (const app of installedApps) {
    const dbs = listElectronCookieDbs(app.baseDir);
    if (dbs.length === 0) {
      addDiag("electron", `${app.name}: 已安装但未发现 Cookies 数据库（应用可能从未启动过内置浏览器）`);
      continue;
    }

    for (const { partition, dbPath } of dbs) {
      const row = await queryCookieRow(dbPath, config);
      if (!row) continue;

      anyDbHit = true;

      if (row.value && row.value.length > 0) {
        const sourceTag = `${app.name.toLowerCase().replace(/\s+/g, "-")}-${partition === "main" ? "main" : "partition"}`;
        log(`[${targetEnv}] 命中 ${app.name} / ${partition === "main" ? "主进程" : "partition=" + partition}（明文 value）`);
        return buildCookieResult(row, row.value, sourceTag);
      }

      // Encrypted-only row: log and continue. Per-app key derivation is not
      // implemented; user can fall back to P5 manual paste if this is the
      // only available source.
      anyEncrypted = true;
      addDiag("electron",
        `${app.name} / ${partition} 找到 SSO_USER_TOKEN 但是 encrypted_value（本路径未实现 Electron 应用密钥派生，建议在内置浏览器里重新登录使其落到 partition 明文 cookie，或走 P5 手动复制）`,
      );
    }
  }

  if (!anyDbHit) {
    addDiag("electron",
      `已扫描 ${installedApps.map((a) => a.name).join("/")}，未在任何 partition 中找到 SSO_USER_TOKEN（内置浏览器未登录涂鸦内网？）`,
    );
  } else if (anyEncrypted) {
    addDiag("electron", "存在 encrypted_value 行但当前实现不支持 Electron 应用解密；建议优先走明文 partition cookie");
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Firefox Cookie DB extraction (all platforms, zero interaction)
 *
 * Firefox stores cookies in `cookies.sqlite` as plaintext — no encryption.
 * (NSS encryption applies only to saved passwords, not cookies.)
 * --------------------------------------------------------------------------- */

/**
 * @brief Find all Firefox profile directories that contain cookies.sqlite
 * @return array of absolute profile directory paths
 */
function listFirefoxProfiles() {
  const platform = process.platform;
  let profilesDir;
  if (platform === "darwin") {
    profilesDir = path.join(os.homedir(), "Library", "Application Support", "Firefox", "Profiles");
  } else if (platform === "win32") {
    profilesDir = path.join(process.env.APPDATA || "", "Mozilla", "Firefox", "Profiles");
  } else {
    profilesDir = path.join(os.homedir(), ".mozilla", "firefox");
  }

  if (!fs.existsSync(profilesDir)) return [];
  try {
    return fs.readdirSync(profilesDir)
      .map((name) => path.join(profilesDir, name))
      .filter((p) => {
        try { return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "cookies.sqlite")); }
        catch { return false; }
      });
  } catch { return []; }
}

/**
 * @brief Try to extract SSO_USER_TOKEN from Firefox profiles (all platforms)
 * @param[in] targetEnv environment key
 * @return `{ cookie, expiresAt?, maxAge?, source }` or null
 */
async function getFromFirefoxCookieDB(targetEnv) {
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;

  const profiles = listFirefoxProfiles();
  if (profiles.length === 0) {
    addDiag("firefox", "未发现任何 Firefox profile");
    return null;
  }

  const hostClauses = config.chromeCookieHosts
    .map((h) => `host LIKE '%' || '${h.replace(/'/g, "''")}'`)
    .join(" OR ");
  const sql = `
    SELECT value, CAST(expiry AS TEXT) AS expiryStr
    FROM moz_cookies
    WHERE (${hostClauses}) AND name='SSO_USER_TOKEN'
    ORDER BY lastAccessed DESC
    LIMIT 1
  `;

  for (const profilePath of profiles) {
    const cookieDb = path.join(profilePath, "cookies.sqlite");
    const rows = await querySqlite(cookieDb, sql, { columns: ["value", "expiryStr"] });
    if (!rows || rows.length === 0) continue;
    const row = rows[0];
    if (!row.value) continue;

    log(`[${targetEnv}] 命中 Firefox / ${path.basename(profilePath)}`);
    const out = { cookie: `SSO_USER_TOKEN=${row.value}`, source: "firefox-cookie-db" };
    if (row.expiryStr) {
      const expiry = parseInt(row.expiryStr, 10);
      if (Number.isFinite(expiry) && expiry > 0) {
        out.expiresAt = new Date(expiry * 1000).toISOString();
        out.maxAge = Math.max(0, expiry - Math.round(Date.now() / 1000));
      }
    }
    return out;
  }
  addDiag("firefox", `已扫描 ${profiles.length} 个 Firefox profile，未发现 SSO_USER_TOKEN`);
  return null;
}

/* ---------------------------------------------------------------------------
 * Safari Cookies extraction (macOS only, zero interaction)
 *
 * Safari stores cookies in a proprietary binary format (Cookies.binarycookies).
 * Values are plaintext — no encryption.
 * --------------------------------------------------------------------------- */

/**
 * @brief Parse Safari's Cookies.binarycookies binary format
 * @param[in] filePath absolute path to Cookies.binarycookies
 * @param[in] domains  array of domain strings to match (e.g. [".tuya-inc.com"])
 * @param[in] cookieName cookie name to find
 * @return `{ cookie, expiresAt?, maxAge?, source }` or null
 */
function parseBinaryCookies(filePath, domains, cookieName) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return null; }
  if (buf.length < 8 || buf.toString("ascii", 0, 4) !== "cook") return null;

  const pageCount = buf.readUInt32BE(4);
  if (pageCount === 0 || pageCount > 50000) return null;

  // Read page size table
  const pageSizes = [];
  let off = 8;
  for (let i = 0; i < pageCount; i++) {
    if (off + 4 > buf.length) return null;
    pageSizes.push(buf.readUInt32BE(off));
    off += 4;
  }

  for (let pi = 0; pi < pageCount; pi++) {
    const pageSize = pageSizes[pi];
    if (off + pageSize > buf.length) break;
    const page = buf.subarray(off, off + pageSize);
    off += pageSize;

    // Page magic: 0x00000100
    if (page.length < 8 || page.readUInt32BE(0) !== 0x00000100) continue;
    const numCookies = page.readUInt32LE(4);

    for (let ci = 0; ci < numCookies; ci++) {
      const coffPos = 8 + ci * 4;
      if (coffPos + 4 > page.length) break;
      const coff = page.readUInt32LE(coffPos);
      if (coff + 4 > page.length) continue;

      const cookieSize = page.readUInt32LE(coff);
      if (coff + cookieSize > page.length || cookieSize < 56) continue;

      const c = page.subarray(coff, coff + cookieSize);
      // Cookie record layout (little-endian):
      // 0:  size(4), unknown(4), flags(4), unknown(4)
      // 16: urlOffset(4), nameOffset(4), pathOffset(4), valueOffset(4)
      // 32: end-of-record marker(8)
      // 40: expiry date (float64, Apple epoch = 2001-01-01)
      // 48: creation date (float64)
      // 56+: null-terminated strings at offsets above
      const urlOff   = c.readUInt32LE(16);
      const nameOff  = c.readUInt32LE(20);
      const valueOff = c.readUInt32LE(28);
      const expiry   = c.readDoubleLE(40);

      const readStr = (o) => {
        if (o >= c.length) return "";
        const end = c.indexOf(0, o);
        return c.toString("utf8", o, end < 0 ? c.length : end);
      };

      if (readStr(nameOff) !== cookieName) continue;

      const domain = readStr(urlOff);
      const matchesDomain = domains.some((d) => {
        const norm = d.startsWith(".") ? d : `.${d}`;
        return domain === norm || domain.endsWith(norm) || domain === norm.slice(1);
      });
      if (!matchesDomain) continue;

      const value = readStr(valueOff);
      if (!value) continue;

      const out = { cookie: `${cookieName}=${value}`, source: "safari-cookies" };
      if (Number.isFinite(expiry) && expiry > 0) {
        const expiryUnix = expiry + APPLE_EPOCH_OFFSET;
        out.expiresAt = new Date(expiryUnix * 1000).toISOString();
        out.maxAge = Math.max(0, Math.round(expiryUnix - Date.now() / 1000));
      }
      return out;
    }
  }
  return null;
}

/**
 * @brief Try to extract SSO_USER_TOKEN from Safari's Cookies.binarycookies (macOS only)
 * @param[in] targetEnv environment key
 * @return `{ cookie, expiresAt?, maxAge?, source }` or null
 */
function getFromSafariCookies(targetEnv) {
  if (process.platform !== "darwin") return null;
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;

  const cookiesFile = path.join(os.homedir(), "Library", "Cookies", "Cookies.binarycookies");
  if (!fs.existsSync(cookiesFile)) return null;

  try {
    return parseBinaryCookies(cookiesFile, config.chromeCookieHosts, "SSO_USER_TOKEN");
  } catch { return null; }
}

/* ---------------------------------------------------------------------------
 * Environment variable extraction
 * --------------------------------------------------------------------------- */

function getFromEnv(targetEnv) {
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;

  for (const key of config.envVars) {
    if (process.env[key]) return process.env[key];
  }

  const envFile = path.join(process.cwd(), ".env");
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf-8");
    for (const key of config.envVars) {
      const match = content.match(new RegExp(`^${escapeRegExp(key)}=(.+?)(?:\\s*#.*)?$`, "m"));
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Cookie file import (Netscape cookies.txt format)
 * --------------------------------------------------------------------------- */

function importCookieFile(filePath, targetEnv) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    error(`文件不存在: ${resolved}`);
    process.exit(1);
  }

  const config = ENV_CONFIG[targetEnv];
  const lines = fs.readFileSync(resolved, "utf-8").split("\n");
  const cookiesByDomain = new Map();

  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) continue;
    const fields = line.split("\t");
    if (fields.length < 7) continue;

    const [domain, , , , expiry, name, value] = fields;
    const matchesDomain = config.chromeCookieHosts.some((h) => domain.endsWith(h))
      || config.domainPatterns.some((p) => p.test(domain));
    if (!matchesDomain) continue;

    if (name === "SSO_USER_TOKEN") {
      const extra = {};
      if (expiry && expiry !== "0") {
        const expMs = parseInt(expiry, 10) * 1000;
        extra.expiresAt = new Date(expMs).toISOString();
        extra.maxAge = Math.max(0, Math.round((expMs - Date.now()) / 1000));
      }
      const cookie = `SSO_USER_TOKEN=${value}`;
      writeCache(cookie, "cookie-file", targetEnv, extra);
      log(`[${targetEnv}] 从 Cookie 文件导入成功`);
      console.log(cookie);
      return;
    }
    if (!cookiesByDomain.has(domain)) cookiesByDomain.set(domain, []);
    cookiesByDomain.get(domain).push(`${name}=${value}`);
  }

  if (cookiesByDomain.size > 0) {
    // Pick the domain with the most cookies
    let bestDomain = "";
    let bestCookies = [];
    for (const [d, cookies] of cookiesByDomain) {
      if (cookies.length > bestCookies.length) {
        bestDomain = d;
        bestCookies = cookies;
      }
    }
    const cookie = bestCookies.join("; ");
    writeCache(cookie, "cookie-file", targetEnv);
    log(`[${targetEnv}] 从 Cookie 文件导入 ${bestCookies.length} 个 cookie (域名: ${bestDomain})`);
    console.log(cookie);
    return;
  }

  error(`[${targetEnv}] Cookie 文件中未找到匹配的涂鸦域名 cookie`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * P0.5: CDP (Chrome DevTools Protocol) — opt-in path for Chrome v20 ABE users
 *
 * Why this exists:
 *   Chrome 127+ enables App-Bound Encryption (v20 ABE) by default. Cookies
 *   in the user's main Chrome profile become unreadable to external processes:
 *   even if we obtain the master key from DPAPI/Keychain, the cookie values
 *   are wrapped in a second AES-GCM layer whose key is gated by Chrome's
 *   elevation service. P1 will fail for these users.
 *
 *   CDP bypasses this: we ask Chrome itself (via Storage.getCookies over the
 *   DevTools WebSocket) to hand us decrypted cookies. This requires Chrome to
 *   be running with --remote-debugging-port=N. We do NOT spawn Chrome — the
 *   user (or agent) opts in by launching once, e.g.:
 *
 *     # macOS
 *     /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *       --remote-debugging-port=9222 \
 *       --user-data-dir="$HOME/.tuya/cdp-profile" &
 *
 *     # Windows (PowerShell)
 *     Start-Process chrome -ArgumentList @(
 *       "--remote-debugging-port=9222",
 *       "--user-data-dir=$env:LOCALAPPDATA\TuyaSSO\cdp-profile"
 *     )
 *
 *   Then user logs into SSO once in that window. After that, sso-token.mjs get
 *   auto-detects the running endpoint and reads cookies via CDP indefinitely.
 *
 * Design notes:
 *   - We probe localhost:9222 only (single port; opt-in is explicit). Add more
 *     via TUYA_CDP_PORTS=9222,9223 if needed.
 *   - We do NOT ship a launcher script. Two reasons: (1) one-line shell
 *     command is enough; (2) we tried bundling cross-platform launchers with
 *     autostart and it ballooned to ~1300 lines for marginal UX gain.
 *   - Probe times out fast (800ms) so users without CDP running don't pay
 *     latency for nothing.
 *   - WebSocket frame handling is a minimal RFC 6455 client (text frames + close).
 *     We do not pull in `ws` — keeps the script zero-dependency.
 * --------------------------------------------------------------------------- */

const CDP_DEFAULT_PORTS = [9222];
const CDP_PROBE_TIMEOUT_MS = 800;
const CDP_CALL_TIMEOUT_MS = 3000;

/**
 * @brief Read configured CDP probe ports from env, falling back to default.
 * @return number[] non-empty list of TCP ports to probe on 127.0.0.1
 */
function getCdpProbePorts() {
  const raw = process.env.TUYA_CDP_PORTS;
  if (!raw) return CDP_DEFAULT_PORTS;
  const ports = raw.split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return ports.length > 0 ? ports : CDP_DEFAULT_PORTS;
}

/**
 * @brief Minimal HTTP GET that returns parsed JSON. Used to query CDP /json/version.
 * @param[in] url           full URL (must be http://, not https://)
 * @param[in] timeoutMs     request timeout in ms
 * @return Promise<any> parsed JSON body, or rejects with Error
 */
function cdpHttpGetJSON(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`bad JSON: ${e.message}`)); }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("HTTP timeout")); });
    req.on("error", reject);
  });
}

/**
 * @brief Encode a single FIN+text WebSocket frame, masked (RFC 6455, client→server).
 * @param[in] text UTF-8 string payload
 * @return Buffer ready to write to TCP socket
 */
function cdpEncodeWsTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN=1, opcode=text(0x1)
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * @brief Stream-friendly RFC 6455 frame parser. Calls onText for each completed
 *        text frame; ignores binary/ping/pong/continuation; resolves on close.
 *        Server→client frames are unmasked per spec, but we tolerate masked too.
 * @param[in] socket   TCP socket already upgraded to WebSocket
 * @param[in] onText   (text: string) => void
 * @param[in] onError  (err: Error)   => void
 */
function cdpAttachFrameReader(socket, onText, onError) {
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0F;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7F;
      let cursor = 2;
      if (payloadLen === 126) {
        if (buf.length < 4) return;
        payloadLen = buf.readUInt16BE(2);
        cursor = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          onError(new Error("CDP frame too large"));
          socket.destroy();
          return;
        }
        payloadLen = Number(big);
        cursor = 10;
      }
      let maskKey = null;
      if (masked) {
        if (buf.length < cursor + 4) return;
        maskKey = buf.slice(cursor, cursor + 4);
        cursor += 4;
      }
      if (buf.length < cursor + payloadLen) return;
      let payload = buf.slice(cursor, cursor + payloadLen);
      if (maskKey) {
        const out = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) out[i] = payload[i] ^ maskKey[i % 4];
        payload = out;
      }
      buf = buf.slice(cursor + payloadLen);

      if (opcode === 0x1) {
        try { onText(payload.toString("utf8")); }
        catch (e) { onError(e); socket.destroy(); return; }
      } else if (opcode === 0x8) {
        socket.destroy();
        return;
      }
      // ignore binary/ping/pong/continuation — not used by CDP for our calls
    }
  });
  socket.on("error", onError);
  socket.on("close", () => onError(new Error("CDP socket closed")));
}

/**
 * @brief Open a single-shot CDP RPC: TCP → WS upgrade → send {method, params} → await {id} response.
 *        Closes the socket after the first matching response or on timeout/error.
 * @param[in] wsUrl   ws:// URL from `/json/version` `webSocketDebuggerUrl`
 * @param[in] method  CDP method name, e.g. "Storage.getCookies"
 * @param[in] params  RPC params object (default {})
 * @param[in] timeoutMs upper bound for the whole call
 * @return Promise<any> CDP `result` object, rejects on error or timeout
 */
function cdpCall(wsUrl, method, params = {}, timeoutMs = CDP_CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(wsUrl); } catch (e) { reject(e); return; }
    const host = parsed.hostname;
    const port = parseInt(parsed.port || "80", 10);
    const path = parsed.pathname + parsed.search;
    const reqId = 1;

    const socket = net.createConnection({ host, port });
    let upgraded = false;
    let closed = false;
    const finalize = (err, value) => {
      if (closed) return;
      closed = true;
      try { socket.destroy(); } catch {}
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finalize(new Error(`CDP ${method} timeout`)), timeoutMs);

    socket.once("connect", () => {
      const wsKey = crypto.randomBytes(16).toString("base64");
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${wsKey}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    let preBuf = Buffer.alloc(0);
    const onPreUpgradeData = (chunk) => {
      preBuf = Buffer.concat([preBuf, chunk]);
      const idx = preBuf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const headerStr = preBuf.slice(0, idx).toString("utf8");
      if (!/^HTTP\/1\.1 101 /i.test(headerStr)) {
        finalize(new Error(`CDP upgrade rejected: ${headerStr.split("\r\n")[0]}`));
        return;
      }
      upgraded = true;
      socket.removeListener("data", onPreUpgradeData);
      cdpAttachFrameReader(socket, (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        if (msg.id !== reqId) return; // ignore other-id / events
        clearTimeout(timer);
        if (msg.error) finalize(new Error(`CDP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`));
        else finalize(null, msg.result);
      }, (err) => {
        clearTimeout(timer);
        if (!upgraded) finalize(err);
        // post-upgrade close after we got a result is fine; finalize is no-op when already resolved
      });

      // Re-feed any leftover bytes after the header — the frame reader consumes them.
      const leftover = preBuf.slice(idx + 4);
      if (leftover.length > 0) socket.emit("data", leftover);

      const rpc = JSON.stringify({ id: reqId, method, params });
      socket.write(cdpEncodeWsTextFrame(rpc));
    };
    socket.on("data", onPreUpgradeData);
    socket.on("error", (err) => { clearTimeout(timer); finalize(err); });
  });
}

/**
 * @brief Probe a single CDP endpoint by hitting /json/version.
 * @param[in] port localhost TCP port
 * @return Promise<{ wsUrl, browser } | null>
 */
async function cdpProbeEndpoint(port) {
  try {
    const info = await cdpHttpGetJSON(`http://127.0.0.1:${port}/json/version`, CDP_PROBE_TIMEOUT_MS);
    if (!info || typeof info.webSocketDebuggerUrl !== "string") return null;
    return { wsUrl: info.webSocketDebuggerUrl, browser: info.Browser || "unknown" };
  } catch {
    return null;
  }
}

/**
 * @brief Filter Storage.getCookies results to find SSO_USER_TOKEN matching env's domain.
 * @param[in] cookies array of CDP Cookie objects
 * @param[in] targetEnv environment key
 * @return `{ value, expires }` or null
 */
function cdpPickSsoCookie(cookies, targetEnv) {
  const config = ENV_CONFIG[targetEnv];
  if (!config || !Array.isArray(cookies)) return null;
  for (const c of cookies) {
    if (c.name !== "SSO_USER_TOKEN") continue;
    const domain = (c.domain || "").toLowerCase();
    const matches = config.chromeCookieHosts.some((h) => domain === h || domain === h.replace(/^\./, "") || domain.endsWith(h))
      || config.domainPatterns.some((p) => p.test(domain));
    if (!matches) continue;
    if (typeof c.value === "string" && c.value.length > 0) {
      return { value: c.value, expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : null };
    }
  }
  return null;
}

/**
 * @brief Try fetching SSO_USER_TOKEN from a running Chrome via CDP.
 *        Probes the configured ports and queries Storage.getCookies for the env's cookie host.
 *        Silent no-op when no endpoint responds — does not require Chrome to be running.
 * @param[in] targetEnv environment key
 * @return Promise<{ cookie, source, expiresAt?, maxAge? } | null>
 */
async function getFromCdp(targetEnv) {
  const config = ENV_CONFIG[targetEnv];
  if (!config) return null;
  const ports = getCdpProbePorts();

  let endpoint = null;
  for (const port of ports) {
    const ep = await cdpProbeEndpoint(port);
    if (ep) { endpoint = { ...ep, port }; break; }
  }
  if (!endpoint) {
    // Don't pollute diagnostics for the common case (no CDP running) — only
    // surface this when the user explicitly opted in via env override.
    if (process.env.TUYA_CDP_PORTS) {
      addDiag("cdp", `未在端口 ${ports.join(",")} 探测到 CDP 端点`);
    }
    return null;
  }

  // Storage.getCookies accepts a `browserContextId` (omitted = default context)
  // and filters server-side. We pass a domain-scoped URL so Chrome only returns
  // cookies for the relevant host group.
  const probeUrl = config.loginUrl;
  let result;
  try {
    result = await cdpCall(endpoint.wsUrl, "Storage.getCookies", { browserContextId: undefined });
  } catch (e) {
    addDiag("cdp", `Storage.getCookies 失败: ${e.message}`);
    return null;
  }
  const picked = cdpPickSsoCookie(result?.cookies || [], targetEnv);
  if (!picked) {
    addDiag("cdp", `CDP 端点 ${endpoint.port} 已连接（${endpoint.browser}），但当前会话未登录涂鸦 SSO（无 SSO_USER_TOKEN）。请先在该 Chrome 窗口访问 ${probeUrl} 完成登录`);
    return null;
  }

  const out = {
    cookie: `SSO_USER_TOKEN=${picked.value}`,
    source: `cdp:${endpoint.port}`,
  };
  if (picked.expires) {
    const expMs = picked.expires * 1000;
    out.expiresAt = new Date(expMs).toISOString();
    out.maxAge = Math.max(0, Math.round((expMs - Date.now()) / 1000));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Commands
 * --------------------------------------------------------------------------- */

async function cmdGet() {
  // P0: Cache (with auto-refresh when approaching expiry)
  if (!force) {
    const cache = readCache(env);
    if (isCacheValid(cache)) {
      if (shouldRefresh(cache)) {
        const cookie = await tryRefreshAndCache(env, cache.cookie);
        if (cookie) {
          log(`[${env}] Token: ${maskToken(cookie)}`);
          console.log(cookie);
          return;
        }
        log(`[${env}] 自动续期未成功，使用现有缓存`);
      }
      log(`[${env}] 从缓存获取 Token (来源: ${cache.source})`);
      log(`Token: ${maskToken(cache.cookie)}`);
      console.log(cache.cookie);
      return;
    }
    if (cache) {
      log(`[${env}] 缓存已过期，尝试续期...`);
      const cookie = await tryRefreshAndCache(env, cache.cookie);
      if (cookie) {
        log(`[${env}] 续期成功`);
        console.log(cookie);
        return;
      }
    }
  } else {
    log(`[${env}] 强制刷新模式，跳过缓存...`);
  }

  // P0.5: CDP — opt-in path for users running Chrome with --remote-debugging-port.
  // Solves Chrome 127+ v20 ABE: regular cookie DB read is blocked, but CDP
  // asks Chrome itself for decrypted cookies. Silent skip when no endpoint runs.
  const cdpResult = await getFromCdp(env);
  if (cdpResult) {
    log(`[${env}] 从 ${cdpResult.source} 获取 Token`);
    log(`Token: ${maskToken(cdpResult.cookie)}`);
    writeCache(cdpResult.cookie, cdpResult.source, env, {
      ...(cdpResult.maxAge != null && { maxAge: cdpResult.maxAge }),
      ...(cdpResult.expiresAt && { expiresAt: cdpResult.expiresAt }),
    });
    console.log(cdpResult.cookie);
    return;
  }

  // P1: Chromium Cookie DB (all platforms) — Chrome / Edge / Brave / Arc / Canary / Chromium
  const chromeResult = await getFromChromeCookieDB(env);
  if (chromeResult) {
    const source = chromeResult.source || "chrome-cookie-db";
    log(`[${env}] 从 ${source} 获取 Token`);
    log(`Token: ${maskToken(chromeResult.cookie)}`);
    writeCache(chromeResult.cookie, source, env, {
      ...(chromeResult.maxAge != null && { maxAge: chromeResult.maxAge }),
      ...(chromeResult.expiresAt && { expiresAt: chromeResult.expiresAt }),
    });
    console.log(chromeResult.cookie);
    return;
  }

  // P1d: Electron desktop apps (Cursor / VSCode / Code Insiders) — covers cloud-desktop / VDI cases
  // where Chrome/Edge are not installed but the user logged in via Cursor's built-in browser
  const electronResult = await getFromElectronCookieDB(env);
  if (electronResult) {
    const source = electronResult.source || "electron-cookie-db";
    log(`[${env}] 从 ${source} 获取 Token`);
    log(`Token: ${maskToken(electronResult.cookie)}`);
    writeCache(electronResult.cookie, source, env, {
      ...(electronResult.maxAge != null && { maxAge: electronResult.maxAge }),
      ...(electronResult.expiresAt && { expiresAt: electronResult.expiresAt }),
    });
    console.log(electronResult.cookie);
    return;
  }

  // P1b: Firefox Cookie DB (all platforms, zero interaction)
  const firefoxResult = await getFromFirefoxCookieDB(env);
  if (firefoxResult) {
    log(`[${env}] 从 firefox-cookie-db 获取 Token`);
    log(`Token: ${maskToken(firefoxResult.cookie)}`);
    writeCache(firefoxResult.cookie, "firefox-cookie-db", env, {
      ...(firefoxResult.maxAge != null && { maxAge: firefoxResult.maxAge }),
      ...(firefoxResult.expiresAt && { expiresAt: firefoxResult.expiresAt }),
    });
    console.log(firefoxResult.cookie);
    return;
  }

  // P1c: Safari Cookies (macOS only, zero interaction)
  const safariResult = getFromSafariCookies(env);
  if (safariResult) {
    log(`[${env}] 从 safari-cookies 获取 Token`);
    log(`Token: ${maskToken(safariResult.cookie)}`);
    writeCache(safariResult.cookie, "safari-cookies", env, {
      ...(safariResult.maxAge != null && { maxAge: safariResult.maxAge }),
      ...(safariResult.expiresAt && { expiresAt: safariResult.expiresAt }),
    });
    console.log(safariResult.cookie);
    return;
  }

  // P2: Environment variables / .env
  const envToken = getFromEnv(env);
  if (envToken) {
    log(`[${env}] 从环境变量获取 Token`);
    log(`Token: ${maskToken(envToken)}`);
    writeCache(envToken, "env", env);
    console.log(envToken);
    return;
  }

  // P3+: Require agent or user intervention
  const config = ENV_CONFIG[env];
  log("");
  log(`[${env}] 未找到可用的 SSO Token`);

  // Print accumulated diagnostics so the user / agent can see WHY each path missed
  if (diagnostics.length > 0) {
    log("");
    log("自动路径排查记录：");
    for (const d of diagnostics) {
      log(`  • [${d.category}] ${d.message}`);
    }
  }

  // SQLite engine availability hint (silent path failure is the most common
  // confusing failure mode on Windows cloud desktops)
  const mod = await getNodeSqlite();
  if (!mod && !hasSqliteCli()) {
    log("");
    log("⚠️ 检测到当前环境既没有 node:sqlite 内置模块（需要 Node.js ≥ 22.5），");
    log("    也没有 sqlite3 命令行工具。所有需要读取 SQLite 的路径会被静默跳过。");
    log("    建议升级 Node.js 到 22.11+（22.x 用 --experimental-sqlite）或 23+，或安装 sqlite3 CLI。");
  }

  // ---------------------------------------------------------------------------
  // P5 fallback: pick the recommendation order based on diagnostics signals.
  //
  // The classic mistake here is showing a generic 5-way menu in every failure.
  // When we *know* why P1 failed (e.g. macOS Keychain canceled), the agent /
  // user should be steered to a path that doesn't repeat the same problem —
  // not "please re-allow Keychain", which is what most users instinctively try
  // and which keeps failing if they really don't want to authorize.
  // ---------------------------------------------------------------------------
  const platform = process.platform;
  // Use structured diagnostic codes set by getFromChromeCookieDB on macOS —
  // NEVER reverse-parse `d.message` for routing decisions: the message is for
  // humans (Chinese, may change), `d.code` is the contract.
  // The three codes we treat as "Keychain blocked":
  //   - mac-keychain-user-canceled   user explicitly canceled the dialog
  //   - mac-keychain-unknown-fail    any non-ok, non-missing failure (treated
  //                                  conservatively as "user-equivalent NO")
  //   - mac-keychain-skipped-sticky  sibling browser skipped after first NO
  // `entry-not-found` is excluded — that just means the browser isn't actually
  // installed / has no Safe Storage entry, which is not a Keychain UX problem.
  const macKeychainBlockedCodes = new Set([
    "mac-keychain-user-canceled",
    "mac-keychain-unknown-fail",
    "mac-keychain-skipped-sticky",
  ]);
  const macKeychainBlocked = platform === "darwin"
    && diagnostics.some((d) => d.code && macKeychainBlockedCodes.has(d.code));

  log("");
  log("请通过以下方式之一获取 Token：");
  log("");

  // Numbering: each branch maintains its own counter so the displayed list
  // is always 1, 2, 3, … contiguous (no skipped indices). The common tail
  // entries (cookies.txt import, MCP) get the next two numbers in line.
  let n = 0;
  const next = () => ++n;

  if (macKeychainBlocked) {
    // Specialized order for the "user canceled Keychain" case
    log("⚠️ 检测到本次失败的根因是 Chromium Keychain 授权被取消。");
    log("    建议**绕开 Keychain** 而非反复尝试授权；以下按 ROI 由高到低排序：");
    log("");
    log(`方式 ${next()}（一次设定 30 天）- CDP 独立 profile，永不依赖 Keychain：`);
    printCdpLaunchHint("    ");
    log(`    在弹出的独立 Chrome 窗口里访问 ${config.loginUrl} 完成 SSO 登录`);
    log("    然后重新运行 sso-token.mjs get（自动探测 127.0.0.1:9222，命中 source=cdp:9222）");
    log("");
    log(`方式 ${next()}（已用 Cursor / VSCode）- 走内置浏览器 partition cookie：`);
    log("    在 Cursor 里 Cmd+Shift+P → \"Open Browser\"");
    log(`    访问 ${config.loginUrl} 完成 SSO 登录，重新运行本命令`);
    log("    （脚本从 Cursor Partitions/<id>/Network/Cookies 的明文 value 读取）");
    log("");
    log(`方式 ${next()}（一次性救火）- DevTools 手动复制：`);
    log(`    1. 在你已登录的浏览器里访问 ${config.loginUrl}`);
    log("    2. DevTools → Application → Cookies → 找 SSO_USER_TOKEN → 复制 Value 列");
    log(`    3. node scripts/sso-token.mjs set "SSO_USER_TOKEN=<你复制的值>" --url <目标URL>`);
    log("");
    log(`方式 ${next()}（确实要修 Keychain）- 让 /usr/bin/security 永久授权：`);
    log("    钥匙串访问.app → 搜 \"Chrome Safe Storage\" → 双击 → 访问控制");
    log("    → 把 /usr/bin/security 加进允许应用列表 → 保存（要再输一次 Mac 密码）");
    log("    之后 Chromium 系浏览器的 P1 路径就不会再弹窗，但仅推荐给确实需要 P1 的场景");
    log("");
  } else {
    // Default order — manual copy first (always works), then CDP, then partition
    log(`方式 ${next()}（最简单，永远可用）- 手动复制 Cookie：`);
    log(`  1. 在浏览器中访问 ${config.loginUrl} 完成 SSO 登录`);
    log("  2. 打开 DevTools → Application → Cookies → 目标域");
    log("     或 Network → 任一请求 → Request Headers → Cookie");
    log("  3. 复制 SSO_USER_TOKEN 的值，粘贴到：");
    log(`     node scripts/sso-token.mjs set "SSO_USER_TOKEN=<你复制的值>" --url <目标URL>`);
    log("");
    log(`方式 ${next()}（云电脑 / VDI 推荐）- 通过 Cursor 内置浏览器登录：`);
    log("  1. 在 Cursor 里 Ctrl+Shift+P → \"Open Browser\" / 使用 cursor-ide-browser MCP");
    log(`  2. 在内置浏览器里访问 ${config.loginUrl} 完成 SSO 登录`);
    log("  3. 重新运行本命令；脚本会从 Cursor partition cookie（明文）直接读取");
    log("  优点：不需要装 Chrome / 不需要 sqlite3 CLI / 不依赖 DPAPI 解密");
    log("");
    log(`方式 ${next()}（Chrome 127+ v20 ABE 用户推荐）- CDP 远程调试一次性登录：`);
    log("  让脚本通过 DevTools Protocol 直接问 Chrome 要解密后的 cookie。");
    log("  独立 profile，不污染日常 Chrome；登录一次后续 30 天自动。");
    printCdpLaunchHint("  ");
    log(`  然后在弹出的 Chrome 窗口里访问 ${config.loginUrl} 完成 SSO 登录，`);
    log("  再重新运行本命令即可（脚本自动探测 127.0.0.1:9222）");
    log("");
  }

  log(`方式 ${next()} - Cookie 文件导入：`);
  log("  安装浏览器插件 'Get cookies.txt LOCALLY' 导出 cookies.txt");
  log(`  然后运行: node scripts/sso-token.mjs import <cookies.txt> --url <目标URL>`);
  log("");
  log(`方式 ${next()} - Agent MCP 自动获取（Cursor / Claude Code 有 MCP 时）：`);
  log("  通过 chrome-devtools-mcp / cursor-ide-browser / Playwright MCP 抓取 cookie");
  log("  拿到后调用 set 写入缓存");
  log("");
  process.exit(1);
}

function cmdSet() {
  if (!cookieArg) {
    error('用法: node scripts/sso-token.mjs set "SSO_USER_TOKEN=xxx" [--url <url>] [--from-set-cookie]');
    process.exit(1);
  }

  if (fromSetCookie) {
    const parsed = parseSetCookie(cookieArg);
    if (parsed) {
      const targetEnv = envExplicit ? env : (parsed.domain ? detectEnv(parsed.domain) : env);
      writeCache(parsed.cookie, "manual", targetEnv, {
        ...(parsed.maxAge != null && { maxAge: parsed.maxAge }),
        ...(parsed.expiresAt && { expiresAt: parsed.expiresAt }),
      });
      log(`[${targetEnv}] Token: ${maskToken(parsed.cookie)}`);
      console.log(parsed.cookie);
      return;
    }
    log("Set-Cookie 解析失败，按普通 cookie 值处理");
  }

  writeCache(cookieArg, "manual", env);
  log(`[${env}] Token: ${maskToken(cookieArg)}`);
  console.log(cookieArg);
}

function buildStatus(cache, targetEnv) {
  if (!cache) return { env: targetEnv, cached: false, message: "无缓存" };

  const elapsed = (Date.now() - new Date(cache.updatedAt).getTime()) / 1000;
  const valid = isCacheValid(cache);
  const needsRefresh = shouldRefresh(cache);

  let remaining;
  if (cache.expiresAt) {
    remaining = (new Date(cache.expiresAt).getTime() - Date.now()) / 1000;
  } else {
    remaining = (cache.ttl || DEFAULT_TTL) - elapsed;
  }

  return {
    env: targetEnv,
    cached: true,
    valid,
    needsRefresh,
    source: cache.source,
    updatedAt: cache.updatedAt,
    elapsed: formatDuration(elapsed),
    remaining: formatDuration(remaining),
    ...(cache.expiresAt && { expiresAt: cache.expiresAt }),
    ...(cache.maxAge != null && { maxAge: cache.maxAge }),
    ttl: cache.ttl || DEFAULT_TTL,
    tokenPreview: maskToken(cache.cookie),
  };
}

function cmdStatus() {
  if (!envExplicit) {
    const all = readAllCache();
    const envs = Object.keys(ENV_CONFIG);
    const result = envs.map((e) => buildStatus(all[e] || null, e));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const cache = readCache(env);
  console.log(JSON.stringify(buildStatus(cache, env), null, 2));
}

function cmdClear() {
  if (!envExplicit) {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
      log("所有环境的缓存已清除");
    } else {
      log("无缓存文件");
    }
    return;
  }

  const all = readAllCache();
  if (all[env]) {
    delete all[env];
    writeAllCache(all);
    log(`[${env}] 缓存已清除`);
  } else {
    log(`[${env}] 无缓存`);
  }
}

function cmdImport() {
  const filePath = cookieArg;
  if (!filePath) {
    error("用法: node scripts/sso-token.mjs import <cookies.txt> [--url <target-url>]");
    process.exit(1);
  }
  importCookieFile(filePath, env);
}

/**
 * @brief Actively probe the server to confirm the cached cookie still works
 * @return none (process.exit with one of the codes below)
 * @note Useful when local cache claims valid (TTL / expiresAt) but downstream
 *       APIs return login pages — common after cross-device sign-in, admin
 *       revoke, or cloud-desktop / VDI IP changes.
 * @note Exit codes:
 *         0 - server accepts the cached token
 *         1 - no cache to validate, or --url failed allowlist (security gate)
 *         2 - server explicitly rejected the token (login redirect / 401 / 403)
 *         3 - network unreachable (VPN off / DNS / TLS / timeout) — cannot decide
 * @attention Refuses to send the cached cookie to any URL outside the env's
 *            domainPatterns allowlist (see isAllowedTargetUrl). This is a
 *            credential-leak guard; do not weaken it.
 */
async function cmdValidate() {
  const cache = readCache(env);
  if (!cache?.cookie) {
    error(`[${env}] 无缓存可验证；先运行 sso-token.mjs get --url <目标URL>`);
    process.exit(1);
  }

  if (args.url && !isAllowedTargetUrl(args.url, env)) {
    error(`[${env}] 拒绝：--url 不在允许的域名白名单内`);
    error(`  传入的 URL：${args.url}`);
    error(`  ${env} 环境允许的域名特征：${ENV_CONFIG[env].domainPatterns.map((p) => p.source).join(", ")}`);
    error("  原因：缓存的 SSO_USER_TOKEN 是凭据，发送到环境外域名等同于凭据泄露");
    process.exit(1);
  }

  const targetUrl = args.url || ENV_CONFIG[env].loginUrl;
  log(`[${env}] 主动验证缓存 token 是否被服务端接受...`);
  log(`目标 URL: ${targetUrl}`);

  const result = await validateToken(env, cache.cookie, targetUrl);

  const out = {
    env,
    valid: result.valid,
    reason: result.reason,
    ...(result.statusCode != null && { statusCode: result.statusCode }),
    ...(result.location && { location: result.location }),
    cacheUpdatedAt: cache.updatedAt,
    tokenPreview: maskToken(cache.cookie),
  };
  console.log(JSON.stringify(out, null, 2));

  if (result.refreshed?.cookie) {
    writeCache(result.refreshed.cookie, "validate-refresh", env, {
      ...(result.refreshed.maxAge != null && { maxAge: result.refreshed.maxAge }),
      ...(result.refreshed.expiresAt && { expiresAt: result.refreshed.expiresAt }),
    });
    log(`[${env}] 服务端在验证响应里下发了新 token，已写回缓存`);
  }

  // valid === null: network failure → can't determine; exit 3 distinguishes from "server rejected"
  if (result.valid === null) {
    log("");
    log("**网络不通**，无法确定服务端是否接受 token。先排查连通性，不要立即 force refresh：");
    log(`  - 公司 VPN 是否已连接？目标 URL 是否需要内网访问（${targetUrl}）`);
    log("  - DNS 是否能解析涂鸦内网域名？");
    log("  - 云电脑 / VDI：出口网络是否被防火墙限制了？");
    log("  - 排查后重试：node scripts/sso-token.mjs validate --url <目标URL>");
    process.exit(3);
  }

  if (result.valid === false) {
    log("");
    log("处理建议（服务端确认拒绝当前 token）：");
    log(`  1. node scripts/sso-token.mjs get --force --url ${targetUrl}  # 走 P1-P5 重新获取`);
    if (process.platform === "darwin") {
      log("  2. macOS 上若 Keychain 授权被你取消（症状：get 反复弹窗或最终失败）：");
      log("     - 优先（绕开 Keychain，30 天稳定）：用 --remote-debugging-port 启 Chrome 走 P0.5：");
      printCdpLaunchHint("         ");
      log("         # 在弹出窗口里完成一次 SSO 登录后，重新跑 get 即可（自动探测 9222）");
      log("     - 或在 Cursor / VSCode 内置浏览器登录涂鸦 → P1d 命中（明文 partition cookie）");
      log("     - 修 Keychain（次选）：钥匙串访问 → \"Chrome Safe Storage\" → 访问控制 → 加 /usr/bin/security");
      log("  3. 若本地无浏览器登录态（云电脑 / VDI / 无 Chrome 的 Windows）：");
    } else {
      log("  2. 若本地无浏览器登录态（云电脑 / VDI / 无 Chrome 的 Windows）：");
    }
    log("     - 在物理机/能登录的浏览器里访问 https://login-cn.tuya-inc.com:7799/ 完成 SSO");
    log("     - DevTools → Application → Cookies → 复制 SSO_USER_TOKEN 值");
    log("     - 通过 RDP 剪贴板粘到目标机器：");
    log(`       node scripts\\sso-token.mjs set "SSO_USER_TOKEN=<value>" --url ${targetUrl}`);
    process.exit(2);
  }
}

/* ---------------------------------------------------------------------------
 * Main entry (async for HTTP-based refresh)
 * --------------------------------------------------------------------------- */

async function main() {
  switch (command) {
    case "get":      await cmdGet();      break;
    case "set":      cmdSet();            break;
    case "validate": await cmdValidate(); break;
    case "status":   cmdStatus();         break;
    case "clear":    cmdClear();          break;
    case "import":   cmdImport();         break;
    default:
      error(`未知命令: ${command}`);
      error("可用命令: get, set, validate, status, clear, import");
      process.exit(1);
  }
}

main().catch((err) => {
  error(`错误: ${err.message}`);
  process.exit(1);
});
