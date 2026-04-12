// ═══════════════════════════════════════════════════════════════════════════
// calls.js  —  Call Reminders module for TaskFlow
// Drop this file next to app.js and follow index.html / style.css patch notes.
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

/** Called once from app.js loginAs() so this module knows who is logged in. */
export function initCalls(currentUser, isAdmin, allStaff, avatarColors) {
  _currentUser  = currentUser;
  _isAdmin      = isAdmin;
  _allStaff     = allStaff;
  _avatarColors = avatarColors;
}

// ── Firestore collection ───────────────────────────────────────────────────
const CALLS_COL = "callReminders";

// ── Helpers ────────────────────────────────────────────────────────────────
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
  const diff = Math.round((new Date(d).setHours(0,0,0,0) - now) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function avatarFor(name) {
  const idx    = _allStaff.indexOf(name);
  const color  = _avatarColors[idx % _avatarColors.length] || "#0d9488";
  const inits  = name.split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return { color, inits };
}

function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className   = "toast show" + (type ? " toast-" + type : "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ── Live listener handle ───────────────────────────────────────────────────
let _callsUnsub = null;

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC: Switch to Calls tab
// ══════════════════════════════════════════════════════════════════════════
export function switchToCallsTab() {
  // Hide all other panels
  const panels = ["dashboard", "calendarPanel", "docsPanel", "homeCalendarPanel"];
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  // Show calls panel
  const cp = document.getElementById("callsPanel");
  if (cp) cp.style.display = "block";

  // Update bottom nav
  ["bnavHome", "bnavCalendar", "bnavDocs"].forEach(id =>
    document.getElementById(id)?.classList.remove("active")
  );
  document.getElementById("bnavCalls")?.classList.add("active");

  // Hide FAB (calls has its own add button)
  const fab = document.getElementById("fabAddBtn");
  if (fab) fab.style.display = "none";

  // Admin dept tabs — deselect
  document.querySelectorAll(".dept-tab")?.forEach(b => b.classList.remove("active"));

  // Start live listener
  startCallsListener();
}

// Called from home tab switch so calls panel is hidden properly
export function hideCallsPanel() {
  const cp = document.getElementById("callsPanel");
  if (cp) cp.style.display = "none";
  document.getElementById("bnavCalls")?.classList.remove("active");
  if (_callsUnsub) { _callsUnsub(); _callsUnsub = null; }
}

// ── Live listener ──────────────────────────────────────────────────────────
function startCallsListener() {
  if (_callsUnsub) return; // already listening
  const q = query(collection(db, CALLS_COL), orderBy("scheduledDate", "asc"));
  _callsUnsub = onSnapshot(q, snap => {
    const calls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCallsPanel(calls);
  }, err => {
    console.error("Calls listener:", err.message);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════════════════
function renderCallsPanel(calls) {
  const panel = document.getElementById("callsPanel");
  if (!panel) return;

  // ── Filter for current user (staff sees only their calls; admin sees all) ─
  const visible = _isAdmin
    ? calls
    : calls.filter(c => c.assignedTo === _currentUser || c.createdBy === _currentUser);

  const pending   = visible.filter(c => c.status !== "done");
  const done      = visible.filter(c => c.status === "done");
  const overdue   = pending.filter(c => {
    const d = toDate(c.scheduledDate); d.setHours(0,0,0,0);
    const n = new Date(); n.setHours(0,0,0,0);
    return d < n;
  });
  const todayC    = pending.filter(c => dayLabel(toDate(c.scheduledDate)) === "Today");
  const upcoming  = pending.filter(c => {
    const lbl = dayLabel(toDate(c.scheduledDate));
    return lbl !== "Today" && !lbl.includes("overdue");
  });

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

  // ── Add button ────────────────────────────────────────────────────────────
  const addBar = `
    <button class="calls-add-btn" onclick="window.openAddCallModal()">
      📞 Schedule a Call
    </button>`;

  // ── Section builder ───────────────────────────────────────────────────────
  function section(title, icon, accent, bg, list) {
    if (!list.length) return "";
    const rows = list.map(c => callCard(c)).join("");
    return `
      <div class="calls-section">
        <div class="calls-sec-hdr" style="background:${bg}">
          <span class="calls-sec-icon">${icon}</span>
          <span class="calls-sec-title" style="color:${accent}">${title}</span>
          <span class="calls-sec-count" style="background:${accent}20;color:${accent}">${list.length}</span>
        </div>
        <div class="calls-sec-body">${rows}</div>
      </div>`;
  }

  const content =
    section("Overdue Calls", "⚠️", "#dc2626", "#fef2f2", overdue) +
    section("Today's Calls", "📞", "#d97706", "#fffbeb", todayC) +
    section("Upcoming", "📅", "#0d9488", "#f0fdfa", upcoming) +
    (done.length ? section("Completed", "✅", "#64748b", "#f8fafc", done) : "");

  const empty = !pending.length && !done.length
    ? `<div class="calls-empty">
         <div class="calls-empty-icon">📵</div>
         <div class="calls-empty-title">No call reminders yet</div>
         <div class="calls-empty-sub">Tap "Schedule a Call" to add one</div>
       </div>`
    : "";

  panel.innerHTML = statsBar + addBar + content + empty;
}

// ── Individual call card ────────────────────────────────────────────────────
function callCard(c) {
  const av      = avatarFor(c.assignedTo || "?");
  const done    = c.status === "done";
  const dateLbl = dayLabel(toDate(c.scheduledDate));
  const timeTxt = c.scheduledTime ? fmt12(c.scheduledTime) : "";
  const isOverdue = dateLbl.includes("overdue");

  const typeIcon = { inbound: "📲", outbound: "📤", followup: "🔄" }[c.callType] || "📞";
  const priorityDot = { p1: "#ef4444", p2: "#f97316", p3: "#3b82f6", p4: "#94a3b8" }[c.priority || "p3"];

  const adminActions = _isAdmin ? `
    <button class="cc-action-btn cc-edit" onclick="window.openEditCallModal('${c.id}')" title="Edit">✏️</button>
    <button class="cc-action-btn cc-del"  onclick="window.openDeleteCallModal('${c.id}')" title="Delete">🗑</button>
  ` : "";

  const doneBtn = `
    <button class="cc-done-btn ${done ? "cc-done-active" : ""}"
      onclick="window.toggleCallDone('${c.id}', ${!done})"
      title="${done ? "Mark pending" : "Mark done"}">
      ${done ? "✅ Done" : "○ Mark Done"}
    </button>`;

  return `
    <div class="call-card ${done ? "call-card-done" : isOverdue ? "call-card-overdue" : ""}">
      <div class="cc-left">
        <div class="cc-av" style="background:${av.color}">${av.inits}</div>
      </div>
      <div class="cc-body">
        <div class="cc-top">
          <span class="cc-type-icon">${typeIcon}</span>
          <span class="cc-contact">${c.contactName || "(No name)"}</span>
          ${c.contactPhone ? `<a class="cc-phone-link" href="tel:${c.contactPhone}">📱 ${c.contactPhone}</a>` : ""}
        </div>
        ${c.purpose ? `<div class="cc-purpose">${c.purpose}</div>` : ""}
        <div class="cc-meta">
          <span class="cc-assignee">${c.assignedTo}</span>
          <span class="cc-date ${isOverdue ? "cc-date-red" : dateLbl === "Today" ? "cc-date-amber" : ""}">${dateLbl}${timeTxt ? " · " + timeTxt : ""}</span>
          <span class="cc-pri-dot" style="background:${priorityDot}"></span>
        </div>
        ${c.notes ? `<div class="cc-notes">${c.notes}</div>` : ""}
      </div>
      <div class="cc-actions">
        ${doneBtn}
        ${adminActions}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// ADD CALL MODAL
// ══════════════════════════════════════════════════════════════════════════
window.openAddCallModal = function () {
  _populateCallStaffSelect("callAssignTo");
  document.getElementById("callContactName").value   = "";
  document.getElementById("callContactPhone").value  = "";
  document.getElementById("callPurpose").value       = "";
  document.getElementById("callNotes").value         = "";
  document.getElementById("callDate").value          = new Date().toISOString().slice(0, 10);
  document.getElementById("callTime").value          = "";
  document.getElementById("callType").value          = "outbound";
  document.getElementById("callPriority").value      = "p3";
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
  const assignedTo  = document.getElementById("callAssignTo").value;
  const dateVal     = document.getElementById("callDate").value;

  if (!contactName) { showToast("Enter contact name", "error"); return; }
  if (!assignedTo)  { showToast("Assign to someone", "error"); return; }
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
  } catch (e) {
    showToast("Error saving: " + e.message, "error");
  }
  btn.textContent = "Save"; btn.disabled = false;
};

// ══════════════════════════════════════════════════════════════════════════
// EDIT CALL MODAL  (admin only)
// ══════════════════════════════════════════════════════════════════════════
let _editCallId = null;

window.openEditCallModal = function (id) {
  if (!_isAdmin) return;
  _editCallId = id;
  // Fetch from Firestore in case data is fresh
  const panel = document.getElementById("callsPanel");
  // We rely on the live snapshot data already rendered — read from DOM attrs
  // Better: fetch directly
  getDocs(collection(db, CALLS_COL)).then(snap => {
    const c = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(c => c.id === id);
    if (!c) return;
    _populateCallStaffSelect("editCallAssignTo", c.assignedTo);
    document.getElementById("editCallContactName").value  = c.contactName  || "";
    document.getElementById("editCallContactPhone").value = c.contactPhone || "";
    document.getElementById("editCallPurpose").value      = c.purpose      || "";
    document.getElementById("editCallNotes").value        = c.notes        || "";
    document.getElementById("editCallDate").value         = toDate(c.scheduledDate).toISOString().slice(0, 10);
    document.getElementById("editCallTime").value         = c.scheduledTime || "";
    document.getElementById("editCallType").value         = c.callType     || "outbound";
    document.getElementById("editCallPriority").value     = c.priority     || "p3";
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
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
  btn.textContent = "Save Changes"; btn.disabled = false;
};

// ══════════════════════════════════════════════════════════════════════════
// DELETE CALL  (admin only)
// ══════════════════════════════════════════════════════════════════════════
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
  } catch (e) {
    showToast("Error", "error");
  }
};

// ══════════════════════════════════════════════════════════════════════════
// TOGGLE DONE
// ══════════════════════════════════════════════════════════════════════════
window.toggleCallDone = async function (id, markDone) {
  try {
    await updateDoc(doc(db, CALLS_COL, id), {
      status     : markDone ? "done" : "pending",
      completedAt: markDone ? Timestamp.now() : null,
      completedBy: markDone ? _currentUser : null,
    });
    showToast(markDone ? "Call marked done ✓" : "Reopened", markDone ? "success" : "");
  } catch (e) {
    showToast("Error", "error");
  }
};

// ── Populate staff dropdowns ───────────────────────────────────────────────
function _populateCallStaffSelect(selId, selected = null) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = `<option value="">— Assign to —</option>` +
    _allStaff.map(s =>
      `<option value="${s}" ${s === (selected || _currentUser) ? "selected" : ""}>${s}</option>`
    ).join("");
}
