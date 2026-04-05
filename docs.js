// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENTS TAB — Google Drive Integration
// Office TaskFlow · docs.js
// ══════════════════════════════════════════════════════════════════════════════

const DRIVE_API_KEY   = "AIzaSyDripufMldUf6vVbmc8Kvgpw4uUNmYy1sU";
const DRIVE_CLIENT_ID = "187454183232-24avm1tj5dfunm03ifob21p4nocv2usv.apps.googleusercontent.com";
const DRIVE_SCOPES    = "https://www.googleapis.com/auth/drive";

const FOLDER_IDS = {
  root:  "1h-bZKbAuy4PCarGxGpU_P13xzqpPGbEv",
  child: "1LRHo_o9wYRQYLAXKNbzK2DTd5SnvM1L7",
  oral:  "1bKLRxOMroKX1svAQXrXBgBE2FkXKZlUb",
  ci:    "1wr16w_eOLviMJEe7F5Dysnyl4p9OWQkm",
  admin: "17UG5qCPtWaSV28Knx7e0XFU-hcQUN4Qo",
};

const DEPT_FOLDERS = {
  child: { label: "Child Health",       icon: "👶", color: "#0d9488" },
  oral:  { label: "Oral Health",        icon: "🦷", color: "#7c3aed" },
  ci:    { label: "Cochlear Implant",   icon: "🔊", color: "#2563eb" },
  admin: { label: "Admin & Management", icon: "📋", color: "#d97706" },
};

const FILE_ICONS = {
  "application/vnd.google-apps.document":      "📄",
  "application/vnd.google-apps.spreadsheet":   "📊",
  "application/vnd.google-apps.presentation":  "📑",
  "application/vnd.google-apps.folder":        "📁",
  "application/pdf":                           "📕",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":   "📝",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         "📊",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "📑",
  "image/jpeg": "🖼", "image/png": "🖼",
  "default": "📄",
};

let driveReady      = false;
let driveSignedIn   = false;
let currentDocDept  = "child";
let currentFolderId = null;
let folderStack     = [];
let tokenClient     = null;
let accessToken     = null;

export function initDrive() {
  if (driveReady) return;
  const tryInit = () => {
    if (typeof google === "undefined" || !google.accounts) { setTimeout(tryInit, 300); return; }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: DRIVE_SCOPES,
      callback: (resp) => {
        if (resp.error) { showDocsToast("Sign-in failed: " + resp.error, "error"); return; }
        accessToken = resp.access_token;
        driveSignedIn = true;
        renderDocsPanel();
      },
    });
    driveReady = true;
  };
  tryInit();
}

window.driveSignIn = function () {
  if (!driveReady) { showDocsToast("Still loading, please wait…", ""); return; }
  tokenClient.requestAccessToken({ prompt: "" });
};

window.driveSignOut = function () {
  if (accessToken) { google.accounts.oauth2.revoke(accessToken, () => {}); accessToken = null; }
  driveSignedIn = false; folderStack = []; currentFolderId = null;
  renderDocsPanel();
};

export function renderDocsPanel() {
  const panel = document.getElementById("docsPanel");
  if (!panel) return;
  if (!driveSignedIn) { _renderSignInScreen(panel); return; }
  _renderDocsUI(panel);
}

function _renderSignInScreen(panel) {
  panel.innerHTML = `
    <div class="docs-signin-wrap">
      <div class="docs-signin-card">
        <div class="docs-signin-icon">📁</div>
        <div class="docs-signin-title">Office Documents</div>
        <div class="docs-signin-sub">One central place for all office documents.<br>Access, share and collaborate across departments.</div>
        <button class="docs-signin-btn" onclick="driveSignIn()">
          <svg width="18" height="18" viewBox="0 0 24 24" style="flex-shrink:0">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google Drive
        </button>
        <div class="docs-dept-preview">
          ${Object.entries(DEPT_FOLDERS).map(([,d]) =>
            `<div class="docs-dept-pill" style="border-color:${d.color}30;background:${d.color}12;color:${d.color}">${d.icon} ${d.label}</div>`
          ).join("")}
        </div>
        <div class="docs-signin-note">Sign in with your Child Health Google account. Staff can open shared documents directly without signing in.</div>
      </div>
    </div>`;
}

function _renderDocsUI(panel) {
  const dept = DEPT_FOLDERS[currentDocDept];
  panel.innerHTML = `
    <div class="docs-wrap">
      <div class="docs-dept-tabs">
        ${Object.entries(DEPT_FOLDERS).map(([key, d]) =>
          `<button class="docs-dept-tab${currentDocDept===key?" active":""}"
            style="${currentDocDept===key?`border-bottom-color:${d.color};color:${d.color}`:""}"
            onclick="switchDocDept('${key}')">${d.icon} ${d.label.split(" ")[0]}</button>`
        ).join("")}
        <button class="docs-dept-tab docs-signout-tab" onclick="driveSignOut()" title="Disconnect">⇄</button>
      </div>
      <div class="docs-search-wrap">
        <input class="docs-search" id="docsSearch" placeholder="🔍  Search in ${dept.label}…" oninput="searchDocs(this.value)"/>
        <button class="docs-upload-btn" onclick="uploadToDrive()">⬆ Upload</button>
      </div>
      <div class="docs-breadcrumb" id="docsBreadcrumb"></div>
      <div class="docs-filelist" id="docsFileList">
        <div class="docs-loading"><div class="spinner"></div><p>Loading documents…</p></div>
      </div>
      <div class="docs-new-row">
        <button class="docs-new-btn" onclick="createGoogleDoc()">📄 New Doc</button>
        <button class="docs-new-btn" onclick="createGoogleSheet()">📊 New Sheet</button>
        <button class="docs-new-btn" onclick="createGoogleSlides()">📑 New Slides</button>
        <button class="docs-new-btn" onclick="createDriveFolder()">📁 New Folder</button>
      </div>
    </div>`;
  _loadFolder(FOLDER_IDS[currentDocDept]);
}

window.switchDocDept = function (key) {
  currentDocDept = key; folderStack = []; currentFolderId = null; renderDocsPanel();
};

function _updateBreadcrumb() {
  const el = document.getElementById("docsBreadcrumb");
  if (!el) return;
  const dept = DEPT_FOLDERS[currentDocDept];
  const crumbs = [`<span class="docs-crumb docs-crumb-root" onclick="navToRoot()">${dept.icon} ${dept.label}</span>`];
  folderStack.forEach((f, i) => {
    crumbs.push(`<span class="docs-crumb-sep">›</span>`);
    crumbs.push(`<span class="docs-crumb" onclick="navToBreadcrumb(${i})">${f.name}</span>`);
  });
  el.innerHTML = crumbs.join("");
}

window.navToRoot = function () { folderStack = []; currentFolderId = null; _loadFolder(FOLDER_IDS[currentDocDept]); };
window.navToBreadcrumb = function (idx) {
  folderStack = folderStack.slice(0, idx + 1);
  _loadFolder(folderStack[folderStack.length - 1].id);
};

async function _loadFolder(folderId) {
  currentFolderId = folderId; _updateBreadcrumb();
  const listEl = document.getElementById("docsFileList");
  if (!listEl) return;
  listEl.innerHTML = `<div class="docs-loading"><div class="spinner"></div><p>Loading…</p></div>`;
  try {
    const q = `'${folderId}' in parents and trashed=false`;
    const fields = "files(id,name,mimeType,modifiedTime,webViewLink,size,lastModifyingUser)";
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&orderBy=folder,name&pageSize=100&key=${DRIVE_API_KEY}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    _renderFileList(listEl, data.files || []);
  } catch(e) {
    listEl.innerHTML = `<div class="docs-error"><div style="font-size:28px;margin-bottom:8px">⚠️</div><div style="font-weight:800;margin-bottom:4px">Could not load files</div><div style="font-size:12px;color:#64748b;margin-bottom:12px">${e.message}</div><button onclick="_retryLoad()" class="docs-retry-btn">↻ Retry</button></div>`;
  }
}
window._retryLoad = () => _loadFolder(currentFolderId || FOLDER_IDS[currentDocDept]);

function _renderFileList(listEl, files) {
  if (!files.length) {
    listEl.innerHTML = `<div class="docs-empty"><div style="font-size:36px;margin-bottom:10px">📂</div><div style="font-weight:700;color:#475569">This folder is empty</div><div style="font-size:12px;color:#94a3b8;margin-top:4px">Upload a file or create a new document</div></div>`;
    return;
  }
  const folders = files.filter(f => f.mimeType === "application/vnd.google-apps.folder");
  const docs    = files.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
  let html = "";
  if (folders.length) {
    html += `<div class="docs-section-lbl">📁 Folders (${folders.length})</div>`;
    html += folders.map(f => `
      <div class="docs-folder-row" onclick="openDriveFolder('${f.id}','${_escJ(f.name)}')">
        <div class="docs-folder-icon">📁</div>
        <div class="docs-file-info"><div class="docs-file-name">${f.name}</div><div class="docs-file-meta">Folder · ${_fmtDate(f.modifiedTime)}</div></div>
        <div class="docs-folder-arrow">›</div>
      </div>`).join("");
  }
  if (docs.length) {
    html += `<div class="docs-section-lbl">📄 Documents (${docs.length})</div>`;
    html += docs.map(f => {
      const icon = FILE_ICONS[f.mimeType] || FILE_ICONS.default;
      const size = f.size ? " · " + _fmtSize(f.size) : "";
      const who  = f.lastModifyingUser?.displayName ? ` · ${f.lastModifyingUser.displayName}` : "";
      return `
        <div class="docs-file-row">
          <div class="docs-file-icon">${icon}</div>
          <div class="docs-file-info" onclick="openDriveFile('${f.webViewLink}')">
            <div class="docs-file-name">${f.name}</div>
            <div class="docs-file-meta">${_fmtDate(f.modifiedTime)}${size}${who}</div>
          </div>
          <div class="docs-file-acts">
            <button class="docs-act-btn" onclick="openDriveFile('${f.webViewLink}')" title="Open">↗</button>
            <button class="docs-act-btn" onclick="copyDriveLink('${f.webViewLink}')" title="Copy link">🔗</button>
          </div>
        </div>`;
    }).join("");
  }
  listEl.innerHTML = html;
}

window.openDriveFolder = function (id, name) { folderStack.push({ id, name }); _loadFolder(id); };
window.openDriveFile   = function (url) { window.open(url, "_blank"); };
window.copyDriveLink   = function (url) {
  navigator.clipboard.writeText(url).then(() => showDocsToast("Link copied! 🔗", "success")).catch(() => showDocsToast("Could not copy", "error"));
};

let _searchTimer = null;
window.searchDocs = function (query) {
  clearTimeout(_searchTimer);
  if (!query.trim()) { _loadFolder(currentFolderId || FOLDER_IDS[currentDocDept]); return; }
  _searchTimer = setTimeout(async () => {
    const listEl = document.getElementById("docsFileList");
    if (!listEl) return;
    listEl.innerHTML = `<div class="docs-loading"><div class="spinner"></div><p>Searching…</p></div>`;
    try {
      const safe = query.replace(/'/g,"\\'");
      const q = `name contains '${safe}' and '${FOLDER_IDS[currentDocDept]}' in parents and trashed=false`;
      const fields = "files(id,name,mimeType,modifiedTime,webViewLink,size)";
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime desc&key=${DRIVE_API_KEY}`;
      const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
      const data = await res.json();
      _renderFileList(listEl, data.files || []);
    } catch(e) { listEl.innerHTML = `<div class="docs-error">Search failed: ${e.message}</div>`; }
  }, 400);
};

window.createGoogleDoc    = () => _createFile("application/vnd.google-apps.document",     "New Document");
window.createGoogleSheet  = () => _createFile("application/vnd.google-apps.spreadsheet",  "New Spreadsheet");
window.createGoogleSlides = () => _createFile("application/vnd.google-apps.presentation", "New Presentation");

async function _createFile(mimeType, defaultName) {
  const name = prompt("Name for the new file:", defaultName);
  if (!name) return;
  const folderId = currentFolderId || FOLDER_IDS[currentDocDept];
  try {
    const res = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType, parents: [folderId] }),
    });
    const file = await res.json();
    showDocsToast("Created: " + name + " ✓", "success");
    window.open(file.webViewLink, "_blank");
    _loadFolder(folderId);
  } catch(e) { showDocsToast("Error creating file", "error"); }
}

window.createDriveFolder = async function () {
  const name = prompt("Folder name:");
  if (!name) return;
  const folderId = currentFolderId || FOLDER_IDS[currentDocDept];
  try {
    await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [folderId] }),
    });
    showDocsToast("Folder created ✓", "success");
    _loadFolder(folderId);
  } catch(e) { showDocsToast("Error creating folder", "error"); }
};

window.uploadToDrive = function () {
  const input = document.createElement("input");
  input.type = "file"; input.multiple = true;
  input.onchange = async () => {
    const folderId = currentFolderId || FOLDER_IDS[currentDocDept];
    for (const file of Array.from(input.files)) {
      showDocsToast(`Uploading ${file.name}…`, "");
      try {
        const meta = JSON.stringify({ name: file.name, parents: [folderId] });
        const form = new FormData();
        form.append("metadata", new Blob([meta], { type: "application/json" }));
        form.append("file", file);
        await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          { method: "POST", headers: { Authorization: "Bearer " + accessToken }, body: form });
        showDocsToast(`${file.name} uploaded ✓`, "success");
      } catch(e) { showDocsToast(`Upload failed: ${file.name}`, "error"); }
    }
    _loadFolder(folderId);
  };
  input.click();
};

function _fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" });
}
function _fmtSize(bytes) {
  bytes = Number(bytes);
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1048576).toFixed(1) + " MB";
}
function _escJ(s) { return s.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function showDocsToast(msg, type) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg; el.className = "toast show " + (type || "");
  setTimeout(() => { el.className = "toast"; }, 2800);
}
