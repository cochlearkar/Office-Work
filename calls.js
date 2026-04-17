// ═══════════════════════════════════════════════════════════════════════════
// calls.js  —  Call Reminders module for TaskFlow
// Features: Contact Picker, Push Notifications, In-app reminders, Tap-to-call
// ═══════════════════════════════════════════════════════════════════════════
import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Shared state injected from app.js via initCalls() ─────────────────────
let _currentUser  = null;
let _isAdmin      = false;
let _allStaff     = [];
let _avatarColors = [];

export function initCalls(currentUser, isAdmin, allStaff, avatarColors) {
  _currentUser  = currentUser;
  _isAdmin      = isAdmin;
  _allStaff     = allStaff;
  _avatarColors = avatarColors;
  _initNotifications();
}

// ── Firestore collection ───────────────────────────────────────────────────
const CALLS_COL = "callReminders";

// ── In-memory reminder timers ──────────────────────────────────────────────
let _reminderTimers = [];

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function _initNotifications() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); }
    catch(e) { console.warn("SW registration failed:", e.message); }
  }
  // Ask for permission after a short delay so it's not intrusive on login
  if ("Notification" in window && Notification.permission === "default") {
    setTimeout(async () => {
      const perm = await Notification.requestPermission();
      if (perm === "granted") showToast("🔔 Call reminders enabled", "success");
    }, 3000);
  }
}

function _scheduleReminder(call) {
  if (!call.scheduledDate || !call.scheduledTime) return;
  if (Notification.permission !== "granted") return;
  const dateStr = toDate(call.scheduledDate).toISOString().slice(0, 10);
  const dt = new Date(`${dateStr}T${call.scheduledTime}:00`);
  const ms = dt - Date.now();
  if (ms <= 0 || ms > 86400000) return; // only schedule if within next 24h
  const t = setTimeout(() => _fireNotification(call), ms);
  _reminderTimers.push(t);
}

function _fireNotification(call) {
  if (Notification.permission !== "granted") return;
  const title = `📞 Call Reminder: ${call.contactName}`;
  const body  = [
    call.purpose      ? call.purpose              : "",
    call.contactPhone ? `📱 ${call.contactPhone}` : "",
    `Assigned to: ${call.assignedTo}`
  ].filter(Boolean).join("\n");

  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body, tag: `call-${call.id}`, vibrate: [200, 100, 200],
        data: { phone: call.contactPhone || "" },
        actions: [
          { action: "call",    title: "📞 Call Now" },
          { action: "dismiss", title: "Dismiss"     }
        ]
      });
    });
  } else {
    new Notification(title, { body, tag: `call-${call.id}` });
  }
}

function _clearAllTimers() {
  _reminderTimers.forEach(clearTimeout);
  _reminderTimers = [];
}

function _scheduleAllReminders(calls) {
  _clearAllTimers();
  const today = new Date().toISOString().slice(0, 10);
  calls
    .filter(c =>
      c.status !== "done" &&
      c.scheduledTime &&
      toDate(c.scheduledDate).toISOString().slice(0, 10) === today &&
      (c.assignedTo === _currentUser || _isAdmin)
    )
    .forEach(_scheduleReminder);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function toDate(v) {
  if (!v) return new Date();
  if (typeof v.toDate === "function") return v.toDate();
  return new Date(v);
}

function fmt12(slot) {
  if (!slot) return "";
  const [h, m] = slot.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function dayLabel(d) {
  const now  = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - now) / 86400000);
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0)   return `${Math.abs(diff)}d overdue`;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function avatarFor(name) {
  const fallback = ["#0d9488","#7c3aed","#db2777","#d97706","#2563eb","#059669","#dc2626"];
  const colors   = _avatarColors.length ? _avatarColors : fallback;
  const idx      = _allStaff.indexOf(name);
  const color    = colors[Math.max(idx, 0) % colors.length];
  const inits    = (name || "?").split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return { color, inits };
}

function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className   = "toast show" + (type ? " toast-" + type : "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2800);
}

// ── Live listener handle ───────────────────────────────────────────────────
let _callsUnsub = null;

// ═══════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

export function switchToCallsTab() {
  ["dashboard", "calendarPanel", "docsPanel", "homeCalendarPanel"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  document.getElementById("callsPanel").style.display = "block";
  ["bnavHome", "bnavCalendar", "bnavDocs"].forEach(id =>
    document.getElementById(id)?.classList.remove("active")
  );
  document.getElementById("bnavCalls")?.classList.add("active");
  const fab = document.getElementById("fabAddBtn");
  if (fab) fab.style.display = "none";
  document.querySelectorAll(".dept-tab")?.forEach(b => b.classList.remove("active"));
  startCallsListener();
}

export function hideCallsPanel() {
  const cp = document.getElementById("callsPanel");
  if (cp) cp.style.display = "none";
  document.getElementById("bnavCalls")?.classList.remove("active");
  if (_callsUnsub) { _callsUnsub(); _callsUnsub = null; }
  _clearAllTimers();
}

function startCallsListener() {
  if (_callsUnsub) return;
  const panel = document.getElementById("callsPanel");
  if (panel) panel.innerHTML = `<div class="calls-loading">Loading calls…</div>`;
  const q = query(collection(db, CALLS_COL), orderBy("scheduledDate", "asc"));
  _callsUnsub = onSnapshot(q, snap => {
    const calls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCallsPanel(calls);
    _scheduleAllReminders(calls);
  }, err => {
    console.error("Calls listener:", err.message);
    const p = document.getElementById("callsPanel");
    if (p) p.innerHTML = `<div class="calls-error">⚠️ Could not load calls: ${err.message}</div>`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════

function renderCallsPanel(calls) {
  const panel = document.getElementById("callsPanel");
  if (!panel) return;

  const visible  = _isAdmin
    ? calls
    : calls.filter(c => c.assignedTo === _currentUser || c.createdBy === _currentUser);
  const pending  = visible.filter(c => c.status !== "done");
  const done     = visible.filter(c => c.status === "done");
  const overdue  = pending.filter(c => {
    const d = toDate(c.scheduledDate); d.setHours(0,0,0,0);
    const n = new Date(); n.setHours(0,0,0,0);
    return d < n;
  });
  const todayC   = pending.filter(c => dayLabel(toDate(c.scheduledDate)) === "Today");
  const upcoming = pending.filter(c => {
    const lbl = dayLabel(toDate(c.scheduledDate));
    return lbl !== "Today" && !lbl.includes("overdue");
  });

  // ── Notification permission nudge ────────────────────────────────────────
  const notifNudge = ("Notification" in window && Notification.permission === "default") ? `
    <div class="calls-notif-nudge" onclick="window._requestCallNotifPermission()">
      🔔 <strong>Enable call reminders</strong> — get notified at call time
      <span class="nudge-arrow">→</span>
    </div>` : "";

  // ── In-app alert banner ───────────────────────────────────────────────────
  const urgentCount = overdue.length + todayC.length;
  const alertBanner = urgentCount > 0 ? `
    <div class="calls-alert-banner">
      <div class="calls-alert-icon">🔔</div>
      <div class="calls-alert-body">
        <div class="calls-alert-title">Calls Need Attention</div>
        <div class="calls-alert-chips">
          ${overdue.length ? `<span class="alert-chip alert-chip-red">⚠️ ${overdue.length} overdue</span>` : ""}
          ${todayC.length  ? `<span class="alert-chip alert-chip-amber">📅 ${todayC.length} due today</span>` : ""}
        </div>
      </div>
    </div>` : "";

  // ── Stats bar ─────────────────────────────────────────────────────────────
  const statsBar = `
    <div class="calls-stats-bar">
      <div class="calls-stat ${overdue.length ? "calls-stat-red" : ""}">
        <div class="calls-stat-num">${overdue.length}</div>
        <div class="calls-stat-lbl">Overdue</div>
      </div>
      <div class="calls-stat ${todayC.length ? "calls-stat-amber" : ""}">
        <div class="calls-stat-num">${todayC.length}</div>
        <div class="calls-stat-lbl">Today</div>
      </div>
      <div class="calls-stat">
        <div class="calls-stat-num">${upcoming.length}</div>
        <div class="calls-stat-lbl">Upcoming</div>
      </div>
      <div class="calls-stat calls-stat-green">
        <div class="calls-stat-num">${done.length}</div>
        <div class="calls-stat-lbl">Done</div>
      </div>
    </div>`;

  const addBar = `
    <div class="calls-add-bar">
      <button class="calls-add-btn" onclick="window.openAddCallModal()">📞 Schedule a Call</button>
      <button class="calls-add-btn calls-add-btn-group" onclick="window.openAddGroupCallModal()">👥 Group Session</button>
    </div>`;

  function section(title, icon, accent, bg, list) {
    if (!list.length) return "";
    return `
      <div class="calls-section">
        <div class="calls-sec-hdr" style="background:${bg}">
          <span class="calls-sec-icon">${icon}</span>
          <span class="calls-sec-title" style="color:${accent}">${title}</span>
          <span class="calls-sec-count" style="background:${accent}20;color:${accent}">${list.length}</span>
        </div>
        <div class="calls-sec-body">${list.map(callCard).join("")}</div>
      </div>`;
  }

  const content =
    section("Overdue Calls", "⚠️", "#dc2626", "#fef2f2", overdue)  +
    section("Today's Calls", "📞", "#d97706", "#fffbeb", todayC)   +
    section("Upcoming",      "📅", "#0d9488", "#f0fdfa", upcoming) +
    (done.length ? section("Completed", "✅", "#64748b", "#f8fafc", done) : "");

  const empty = !pending.length && !done.length ? `
    <div class="calls-empty">
      <div class="calls-empty-icon">📵</div>
      <div class="calls-empty-title">No call reminders yet</div>
      <div class="calls-empty-sub">Tap "Schedule a Call" or "Group Session" to get started</div>
    </div>` : "";

  // Group call sessions injected by meetings module
  const gcMod = window._meetingsModule;
  let groupCallsHTML = "";
  if (gcMod && gcMod.getGroupCallsCache && gcMod.groupCallCard) {
    const groupCalls = gcMod.getGroupCallsCache();
    const visibleGC  = _isAdmin ? groupCalls : groupCalls.filter(gc => gc.createdBy === _currentUser);
    if (visibleGC.length) {
      const pendingGC = visibleGC.filter(gc => gc.status !== "done");
      const doneGC    = visibleGC.filter(gc => gc.status === "done");
      groupCallsHTML = `
        <div class="calls-section gcc-section">
          <div class="calls-sec-hdr" style="background:#f5f3ff">
            <span class="calls-sec-icon">👥</span>
            <span class="calls-sec-title" style="color:#7c3aed">Group Call Sessions</span>
            <span class="calls-sec-count" style="background:#7c3aed20;color:#7c3aed">${visibleGC.length}</span>
          </div>
          <div class="calls-sec-body">
            ${pendingGC.map(gc => gcMod.groupCallCard(gc)).join("")}
            ${doneGC.map(gc => gcMod.groupCallCard(gc)).join("")}
          </div>
        </div>`;
    }
  }

  panel.innerHTML = notifNudge + alertBanner + statsBar + addBar + content + groupCallsHTML + empty;
}

// ── Call card ──────────────────────────────────────────────────────────────
function callCard(c) {
  const av        = avatarFor(c.assignedTo || "?");
  const done      = c.status === "done";
  const dateLbl   = dayLabel(toDate(c.scheduledDate));
  const timeTxt   = c.scheduledTime ? fmt12(c.scheduledTime) : "";
  const isOverdue = dateLbl.includes("overdue");
  const typeIcon  = { inbound:"📲", outbound:"📤", followup:"🔄" }[c.callType] || "📞";
  const priDot    = { p1:"#ef4444", p2:"#f97316", p3:"#3b82f6", p4:"#94a3b8" }[c.priority||"p3"];

  // Prominent tap-to-call + WhatsApp buttons
  const dialBtn = c.contactPhone ? `
    <div class="cc-dial-row">
      <a class="cc-dial-btn" href="tel:${c.contactPhone}">📞 ${c.contactPhone}</a>
      <a class="cc-wa-btn" href="https://wa.me/${c.contactPhone.replace(/\D/g,"")}" target="_blank" title="WhatsApp Call">
        <svg class="cc-wa-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WA
      </a>
    </div>` : "";

  const doneBtn = `
    <button class="cc-done-btn ${done ? "cc-done-active" : ""}"
      onclick="window.toggleCallDone('${c.id}', ${!done})">
      ${done ? "✅ Done" : "○ Done"}
    </button>`;

  const adminActions = _isAdmin ? `
    <div class="cc-admin-btns">
      <button class="cc-action-btn cc-edit" onclick="window.openEditCallModal('${c.id}')" title="Edit">✏️</button>
      <button class="cc-action-btn cc-del"  onclick="window.openDeleteCallModal('${c.id}')" title="Delete">🗑</button>
    </div>` : "";

  return `
    <div class="call-card ${done ? "call-card-done" : isOverdue ? "call-card-overdue" : ""}">
      <div class="cc-left">
        <div class="cc-av" style="background:${av.color}">${av.inits}</div>
      </div>
      <div class="cc-body">
        <div class="cc-top">
          <span class="cc-type-icon">${typeIcon}</span>
          <span class="cc-contact">${c.contactName || "(No name)"}</span>
          <span class="cc-pri-dot" style="background:${priDot}"></span>
        </div>
        ${dialBtn}
        ${c.purpose ? `<div class="cc-purpose">${c.purpose}</div>` : ""}
        <div class="cc-meta">
          <span class="cc-assignee">👤 ${c.assignedTo}</span>
          <span class="cc-date ${isOverdue ? "cc-date-red" : dateLbl==="Today" ? "cc-date-amber" : ""}">
            ${dateLbl}${timeTxt ? " · "+timeTxt : ""}
          </span>
        </div>
        ${c.notes ? `<div class="cc-notes">${c.notes}</div>` : ""}
      </div>
      <div class="cc-actions">
        ${doneBtn}
        ${adminActions}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT PICKER  (Android Chrome — hidden on unsupported devices)
// ═══════════════════════════════════════════════════════════════════════════

window._contactPickerSupported = () =>
  "contacts" in navigator && "ContactsManager" in window;

window.pickContact = async function () {
  if (!window._contactPickerSupported()) return;
  try {
    const [c] = await navigator.contacts.select(["name", "tel"], { multiple: false });
    if (!c) return;
    document.getElementById("callContactName").value  = c.name?.[0]  || "";
    document.getElementById("callContactPhone").value = c.tel?.[0]   || "";
    showToast("Contact filled ✓", "success");
  } catch(e) { showToast("Could not open contacts", ""); }
};

window.pickContactEdit = async function () {
  if (!window._contactPickerSupported()) return;
  try {
    const [c] = await navigator.contacts.select(["name", "tel"], { multiple: false });
    if (!c) return;
    document.getElementById("editCallContactName").value  = c.name?.[0] || "";
    document.getElementById("editCallContactPhone").value = c.tel?.[0]  || "";
    showToast("Contact filled ✓", "success");
  } catch(e) { showToast("Could not open contacts", ""); }
};

window._requestCallNotifPermission = async function () {
  if (!("Notification" in window)) return;
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    showToast("🔔 Reminders enabled!", "success");
    document.querySelector(".calls-notif-nudge")?.remove();
  } else {
    showToast("Notifications blocked — enable in browser settings", "");
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADD CALL MODAL
// ═══════════════════════════════════════════════════════════════════════════

window.openAddCallModal = function () {
  _populateCallStaffSelect("callAssignTo");
  document.getElementById("callContactName").value  = "";
  document.getElementById("callContactPhone").value = "";
  document.getElementById("callPurpose").value      = "";
  document.getElementById("callNotes").value        = "";
  document.getElementById("callDate").value         = new Date().toISOString().slice(0, 10);
  document.getElementById("callTime").value         = "";
  document.getElementById("callType").value         = "outbound";
  document.getElementById("callPriority").value     = "p3";
  // Show contact picker only on supported devices
  const btn = document.getElementById("contactPickerBtn");
  if (btn) btn.style.display = window._contactPickerSupported() ? "flex" : "none";
  document.getElementById("addCallModal").style.display = "flex";
  setTimeout(() => document.getElementById("callContactName").focus(), 100);
};

window.closeAddCallModal = function () {
  document.getElementById("addCallModal").style.display = "none";
};
window.closeAddCallIfOutside = function (e) {
  if (e.target === document.getElementById("addCallModal")) window.closeAddCallModal();
};

window.saveAddCall = async function () {
  const contactName = document.getElementById("callContactName").value.trim();
  const assignedTo  = document.getElementById("callAssignTo").value || _currentUser;
  const dateVal     = document.getElementById("callDate").value;
  if (!contactName) { showToast("Enter a contact name", "error"); return; }
  if (!dateVal)     { showToast("Pick a date", "error"); return; }
  const btn = document.getElementById("saveCallBtn");
  btn.textContent = "Saving…"; btn.disabled = true;
  try {
    await addDoc(collection(db, CALLS_COL), {
      contactName,
      contactPhone : document.getElementById("callContactPhone").value.trim(),
      purpose      : document.getElementById("callPurpose").value.trim(),
      notes        : document.getElementById("callNotes").value.trim(),
      assignedTo,
      scheduledDate: Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      scheduledTime: document.getElementById("callTime").value || "",
      callType     : document.getElementById("callType").value,
      priority     : document.getElementById("callPriority").value,
      status       : "pending",
      createdBy    : _currentUser,
      createdAt    : Timestamp.now(),
    });
    showToast("Call reminder saved ✓", "success");
    window.closeAddCallModal();
  } catch (e) { showToast("Error saving: " + e.message, "error"); }
  btn.textContent = "Save"; btn.disabled = false;
};

// ═══════════════════════════════════════════════════════════════════════════
// EDIT CALL MODAL
// ═══════════════════════════════════════════════════════════════════════════
let _editCallId = null;

window.openEditCallModal = function (id) {
  if (!_isAdmin) return;
  _editCallId = id;
  getDocs(collection(db, CALLS_COL)).then(snap => {
    const c = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(c => c.id === id);
    if (!c) return;
    _populateCallStaffSelect("editCallAssignTo", c.assignedTo);
    document.getElementById("editCallContactName").value  = c.contactName   || "";
    document.getElementById("editCallContactPhone").value = c.contactPhone  || "";
    document.getElementById("editCallPurpose").value      = c.purpose       || "";
    document.getElementById("editCallNotes").value        = c.notes         || "";
    document.getElementById("editCallDate").value         = toDate(c.scheduledDate).toISOString().slice(0, 10);
    document.getElementById("editCallTime").value         = c.scheduledTime || "";
    document.getElementById("editCallType").value         = c.callType      || "outbound";
    document.getElementById("editCallPriority").value     = c.priority      || "p3";
    const btn = document.getElementById("contactPickerBtnEdit");
    if (btn) btn.style.display = window._contactPickerSupported() ? "flex" : "none";
    document.getElementById("editCallModal").style.display = "flex";
    setTimeout(() => document.getElementById("editCallContactName").focus(), 100);
  });
};

window.closeEditCallModal = function () {
  document.getElementById("editCallModal").style.display = "none";
  _editCallId = null;
};
window.closeEditCallIfOutside = function (e) {
  if (e.target === document.getElementById("editCallModal")) window.closeEditCallModal();
};

window.saveEditCall = async function () {
  if (!_editCallId) return;
  const contactName = document.getElementById("editCallContactName").value.trim();
  const assignedTo  = document.getElementById("editCallAssignTo").value;
  const dateVal     = document.getElementById("editCallDate").value;
  if (!contactName) { showToast("Enter contact name", "error"); return; }
  if (!dateVal)     { showToast("Pick a date", "error"); return; }
  const btn = document.getElementById("saveEditCallBtn");
  btn.textContent = "Saving…"; btn.disabled = true;
  try {
    await updateDoc(doc(db, CALLS_COL, _editCallId), {
      contactName,
      contactPhone : document.getElementById("editCallContactPhone").value.trim(),
      purpose      : document.getElementById("editCallPurpose").value.trim(),
      notes        : document.getElementById("editCallNotes").value.trim(),
      assignedTo,
      scheduledDate: Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      scheduledTime: document.getElementById("editCallTime").value || "",
      callType     : document.getElementById("editCallType").value,
      priority     : document.getElementById("editCallPriority").value,
    });
    showToast("Updated ✓", "success");
    window.closeEditCallModal();
  } catch (e) { showToast("Error: " + e.message, "error"); }
  btn.textContent = "Save Changes"; btn.disabled = false;
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════════════════════
let _delCallId = null;

window.openDeleteCallModal = function (id) {
  if (!_isAdmin) return;
  _delCallId = id;
  document.getElementById("deleteCallModal").style.display = "flex";
};
window.closeDeleteCallModal = function () {
  document.getElementById("deleteCallModal").style.display = "none";
  _delCallId = null;
};
window.confirmDeleteCall = async function () {
  if (!_delCallId) return;
  try {
    await deleteDoc(doc(db, CALLS_COL, _delCallId));
    showToast("Deleted", "");
    window.closeDeleteCallModal();
  } catch (e) { showToast("Error", "error"); }
};

// ═══════════════════════════════════════════════════════════════════════════
// TOGGLE DONE
// ═══════════════════════════════════════════════════════════════════════════
window.toggleCallDone = async function (id, markDone) {
  try {
    await updateDoc(doc(db, CALLS_COL, id), {
      status     : markDone ? "done" : "pending",
      completedAt: markDone ? Timestamp.now() : null,
      completedBy: markDone ? _currentUser    : null,
    });
    showToast(markDone ? "Call marked done ✓" : "Reopened", markDone ? "success" : "");
  } catch (e) { showToast("Error", "error"); }
};

// ── Staff dropdown helper ──────────────────────────────────────────────────
function _populateCallStaffSelect(selId, selected = null) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const autoSelect = selected || _currentUser;
  const staff = _allStaff.length ? _allStaff : [_currentUser].filter(Boolean);
  sel.innerHTML = staff.map(s =>
    `<option value="${s}" ${s === autoSelect ? "selected" : ""}>${s}</option>`
  ).join("");
}
