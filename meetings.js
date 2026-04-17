// ═══════════════════════════════════════════════════════════════════════════
// meetings.js  —  Meetings module for TaskFlow
// • Meetings live inside the Calendar tab (Events sub-tab)
// • Group Call Sessions live inside the Calls tab
// ═══════════════════════════════════════════════════════════════════════════
import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Shared state injected from app.js ─────────────────────────────────────
let _currentUser  = null;
let _isAdmin      = false;
let _allStaff     = [];
let _avatarColors = [];

export function initMeetings(currentUser, isAdmin, allStaff, avatarColors) {
  _currentUser  = currentUser;
  _isAdmin      = isAdmin;
  _allStaff     = allStaff;
  _avatarColors = avatarColors;
}

// ── Firestore collections ──────────────────────────────────────────────────
const MEETINGS_COL    = "meetings";
const GROUPCALLS_COL  = "groupCallSessions";

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
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function dayLabel(d) {
  const now  = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - now) / 86400000);
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0)   return `${Math.abs(diff)}d ago`;
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

// ═══════════════════════════════════════════════════════════════════════════
// MEETINGS — rendered inside Calendar tab → Events pane
// ═══════════════════════════════════════════════════════════════════════════

let _meetingsCache = [];
let _meetingsUnsub = null;

export function startMeetingsListener(onUpdate) {
  if (_meetingsUnsub) return;
  const q = query(collection(db, MEETINGS_COL), orderBy("meetingDate", "asc"));
  _meetingsUnsub = onSnapshot(q, snap => {
    _meetingsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (onUpdate) onUpdate(_meetingsCache);
  }, err => console.error("Meetings listener:", err.message));
}

export function stopMeetingsListener() {
  if (_meetingsUnsub) { _meetingsUnsub(); _meetingsUnsub = null; }
}

export function getMeetingsForDate(dateKey) {
  return _meetingsCache.filter(m => {
    const d = toDate(m.meetingDate);
    return d.toISOString().slice(0, 10) === dateKey;
  });
}

export function getMeetingsSummary() {
  const now = new Date(); now.setHours(0,0,0,0);
  const upcoming = _meetingsCache.filter(m => toDate(m.meetingDate) >= now && m.status !== "cancelled");
  const today    = upcoming.filter(m => dayLabel(toDate(m.meetingDate)) === "Today");
  return { total: upcoming.length, today: today.length };
}

// ── Meeting card HTML (used in calendar events pane) ──────────────────────
export function meetingCard(m, isPast = false) {
  const dt      = toDate(m.meetingDate);
  const timeTxt = m.meetingTime ? fmt12(m.meetingTime) : "All day";
  const typeIcon = { staff:"👥", vendor:"🤝", hospital:"🏥", external:"🌐" }[m.meetingType] || "📋";
  const typeLbl  = { staff:"Staff", vendor:"Vendor", hospital:"Hospital", external:"External" }[m.meetingType] || m.meetingType;
  const cancelled = m.status === "cancelled";

  // Attendees chips
  const staffChips = (m.staffAttendees || []).map(name => {
    const av = avatarFor(name);
    return `<span class="mtg-attendee-chip" style="background:${av.color}20;color:${av.color};border-color:${av.color}40">${av.inits} ${name.split(" ")[0]}</span>`;
  }).join("");

  const extChips = (m.externalAttendees || []).filter(Boolean).map(name =>
    `<span class="mtg-attendee-chip mtg-ext-chip">🔗 ${name}</span>`
  ).join("");

  const adminActions = _isAdmin && !isPast ? `
    <div class="mtg-admin-row">
      <button class="mtg-action-btn mtg-edit" onclick="window.openEditMeetingModal('${m.id}')" title="Edit">✏️ Edit</button>
      ${!cancelled ? `<button class="mtg-action-btn mtg-cancel" onclick="window.cancelMeeting('${m.id}')">✕ Cancel</button>` : ""}
      <button class="mtg-action-btn mtg-del" onclick="window.deleteMeeting('${m.id}')">🗑</button>
    </div>` : "";

  return `
    <div class="mtg-card ${isPast ? "mtg-card-past" : ""} ${cancelled ? "mtg-card-cancelled" : ""}">
      <div class="mtg-card-accent" style="background:${cancelled ? "#94a3b8" : _typeColor(m.meetingType)}"></div>
      <div class="mtg-card-body">
        <div class="mtg-top">
          <span class="mtg-type-badge" style="background:${_typeColor(m.meetingType)}20;color:${_typeColor(m.meetingType)}">${typeIcon} ${typeLbl}</span>
          ${cancelled ? `<span class="mtg-cancelled-badge">Cancelled</span>` : ""}
          <span class="mtg-time">${timeTxt}</span>
        </div>
        <div class="mtg-title">${m.title || "(No title)"}</div>
        ${m.location ? `<div class="mtg-location">📍 ${m.location}</div>` : ""}
        ${(staffChips || extChips) ? `<div class="mtg-attendees">${staffChips}${extChips}</div>` : ""}
        ${m.notes ? `<div class="mtg-notes">${m.notes}</div>` : ""}
        ${adminActions}
      </div>
    </div>`;
}

function _typeColor(type) {
  return { staff:"#7c3aed", vendor:"#d97706", hospital:"#0d9488", external:"#2563eb" }[type] || "#64748b";
}

// ── Inject meeting cards into the existing calendar HTML ───────────────────
export function injectMeetingsIntoCalendar(pane) {
  if (!pane) return;

  // Inject "Add Meeting" button at top
  const addBtn = document.createElement("div");
  addBtn.innerHTML = `<button class="mtg-add-btn" onclick="window.openAddMeetingModal()">🤝 Schedule a Meeting</button>`;
  pane.insertBefore(addBtn.firstElementChild, pane.firstChild);

  // After ICS events are rendered, find each .cal-day block and inject meetings
  const dayBlocks = pane.querySelectorAll(".cal-day");
  dayBlocks.forEach(dayEl => {
    const lbl = dayEl.querySelector(".cal-day-lbl");
    if (!lbl) return;
    // Extract date from the day block's data or from surrounding context
    const dateAttr = dayEl.dataset.dateKey;
    if (!dateAttr) return;
    const meetings = getMeetingsForDate(dateAttr);
    if (!meetings.length) return;
    const wrap = document.createElement("div");
    wrap.className = "mtg-in-cal";
    wrap.innerHTML = meetings.map(m => meetingCard(m)).join("");
    dayEl.appendChild(wrap);
  });

  // Also show standalone upcoming meetings section if any exist
  _renderUpcomingMeetingsSection(pane);
}

function _renderUpcomingMeetingsSection(pane) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const upcoming = _meetingsCache
    .filter(m => toDate(m.meetingDate) >= now && m.status !== "cancelled")
    .sort((a, b) => toDate(a.meetingDate) - toDate(b.meetingDate));

  if (!upcoming.length && _isAdmin) {
    // Just show the add button already injected
    return;
  }

  if (!upcoming.length) return;

  // Group by date
  const groups = {};
  upcoming.forEach(m => {
    const k = toDate(m.meetingDate).toISOString().slice(0, 10);
    if (!groups[k]) groups[k] = { label: dayLabel(toDate(m.meetingDate)), meetings: [] };
    groups[k].meetings.push(m);
  });

  const section = document.createElement("div");
  section.className = "mtg-section";
  section.innerHTML = `<div class="mtg-section-hdr"><span class="mtg-sec-icon">🤝</span><span class="mtg-sec-title">Meetings</span><span class="mtg-sec-count">${upcoming.length}</span></div>`;

  Object.entries(groups).forEach(([key, g]) => {
    const groupEl = document.createElement("div");
    groupEl.className = "mtg-date-group";
    groupEl.innerHTML = `<div class="mtg-date-lbl">${g.label === "Today" ? "📍 Today" : g.label === "Tomorrow" ? "⏭ Tomorrow" : "📅 " + g.label}</div>
      ${g.meetings.map(m => meetingCard(m)).join("")}`;
    section.appendChild(groupEl);
  });

  // Past meetings (collapsed)
  const past = _meetingsCache
    .filter(m => toDate(m.meetingDate) < now)
    .sort((a, b) => toDate(b.meetingDate) - toDate(a.meetingDate))
    .slice(0, 10);

  if (past.length) {
    const pastEl = document.createElement("details");
    pastEl.className = "mtg-past-details";
    pastEl.innerHTML = `<summary class="mtg-past-summary">🕘 Past meetings (${past.length})</summary>
      ${past.map(m => meetingCard(m, true)).join("")}`;
    section.appendChild(pastEl);
  }

  pane.appendChild(section);
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD MEETING MODAL
// ═══════════════════════════════════════════════════════════════════════════

window.openAddMeetingModal = function() {
  _populateMeetingStaffChecks("mtgStaffChecks");
  document.getElementById("mtgTitle").value      = "";
  document.getElementById("mtgLocation").value   = "";
  document.getElementById("mtgNotes").value      = "";
  document.getElementById("mtgExternalList").innerHTML = "";
  document.getElementById("mtgDate").value       = new Date().toISOString().slice(0, 10);
  document.getElementById("mtgTime").value       = "";
  document.getElementById("mtgType").value       = "staff";
  document.getElementById("addMeetingModal").style.display = "flex";
  setTimeout(() => document.getElementById("mtgTitle").focus(), 100);
};

window.closeAddMeetingModal = function() {
  document.getElementById("addMeetingModal").style.display = "none";
};
window.closeAddMeetingIfOutside = function(e) {
  if (e.target === document.getElementById("addMeetingModal")) window.closeAddMeetingModal();
};

window.addMeetingExternalRow = function() {
  const list = document.getElementById("mtgExternalList");
  const row  = document.createElement("div");
  row.className = "mtg-ext-row";
  row.innerHTML = `
    <input class="modal-input mtg-ext-input" placeholder="Name (e.g. Dr. Sharma - Apollo)" autocomplete="name" style="margin-bottom:0;flex:1"/>
    <button class="mtg-ext-remove" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(row);
  row.querySelector("input").focus();
};

window.saveAddMeeting = async function() {
  const title   = document.getElementById("mtgTitle").value.trim();
  const dateVal = document.getElementById("mtgDate").value;
  if (!title)   { showToast("Enter a meeting title", "error"); return; }
  if (!dateVal) { showToast("Pick a date", "error"); return; }

  const staffAttendees = [...document.querySelectorAll("#mtgStaffChecks input:checked")].map(cb => cb.value);
  const externalAttendees = [...document.querySelectorAll(".mtg-ext-input")].map(i => i.value.trim()).filter(Boolean);

  const btn = document.getElementById("saveMeetingBtn");
  btn.textContent = "Saving…"; btn.disabled = true;
  try {
    await addDoc(collection(db, MEETINGS_COL), {
      title,
      meetingType     : document.getElementById("mtgType").value,
      location        : document.getElementById("mtgLocation").value.trim(),
      notes           : document.getElementById("mtgNotes").value.trim(),
      meetingDate     : Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      meetingTime     : document.getElementById("mtgTime").value || "",
      staffAttendees,
      externalAttendees,
      status          : "scheduled",
      createdBy       : _currentUser,
      createdAt       : Timestamp.now(),
    });
    showToast("Meeting scheduled ✓", "success");
    window.closeAddMeetingModal();
    // Refresh calendar if it's open
    if (typeof window.renderCalendarPanel === "function") window.renderCalendarPanel();
  } catch(e) { showToast("Error: " + e.message, "error"); }
  btn.textContent = "Schedule"; btn.disabled = false;
};

// ═══════════════════════════════════════════════════════════════════════════
// EDIT MEETING MODAL
// ═══════════════════════════════════════════════════════════════════════════
let _editMeetingId = null;

window.openEditMeetingModal = function(id) {
  _editMeetingId = id;
  const m = _meetingsCache.find(x => x.id === id);
  if (!m) return;
  _populateMeetingStaffChecks("editMtgStaffChecks", m.staffAttendees || []);
  document.getElementById("editMtgTitle").value    = m.title || "";
  document.getElementById("editMtgLocation").value = m.location || "";
  document.getElementById("editMtgNotes").value    = m.notes || "";
  document.getElementById("editMtgDate").value     = toDate(m.meetingDate).toISOString().slice(0, 10);
  document.getElementById("editMtgTime").value     = m.meetingTime || "";
  document.getElementById("editMtgType").value     = m.meetingType || "staff";
  // Restore external attendees
  const list = document.getElementById("editMtgExternalList");
  list.innerHTML = "";
  (m.externalAttendees || []).forEach(name => {
    const row = document.createElement("div");
    row.className = "mtg-ext-row";
    row.innerHTML = `
      <input class="modal-input mtg-ext-input" value="${name}" autocomplete="name" style="margin-bottom:0;flex:1"/>
      <button class="mtg-ext-remove" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
  });
  document.getElementById("editMeetingModal").style.display = "flex";
};

window.closeEditMeetingModal = function() {
  document.getElementById("editMeetingModal").style.display = "none";
  _editMeetingId = null;
};
window.closeEditMeetingIfOutside = function(e) {
  if (e.target === document.getElementById("editMeetingModal")) window.closeEditMeetingModal();
};

window.addEditMeetingExternalRow = function() {
  const list = document.getElementById("editMtgExternalList");
  const row  = document.createElement("div");
  row.className = "mtg-ext-row";
  row.innerHTML = `
    <input class="modal-input mtg-ext-input" placeholder="Name (e.g. Dr. Sharma - Apollo)" autocomplete="name" style="margin-bottom:0;flex:1"/>
    <button class="mtg-ext-remove" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(row);
  row.querySelector("input").focus();
};

window.saveEditMeeting = async function() {
  if (!_editMeetingId) return;
  const title   = document.getElementById("editMtgTitle").value.trim();
  const dateVal = document.getElementById("editMtgDate").value;
  if (!title)   { showToast("Enter a meeting title", "error"); return; }
  if (!dateVal) { showToast("Pick a date", "error"); return; }
  const staffAttendees    = [...document.querySelectorAll("#editMtgStaffChecks input:checked")].map(cb => cb.value);
  const externalAttendees = [...document.querySelectorAll("#editMtgExternalList .mtg-ext-input")].map(i => i.value.trim()).filter(Boolean);
  const btn = document.getElementById("saveEditMeetingBtn");
  btn.textContent = "Saving…"; btn.disabled = true;
  try {
    await updateDoc(doc(db, MEETINGS_COL, _editMeetingId), {
      title,
      meetingType     : document.getElementById("editMtgType").value,
      location        : document.getElementById("editMtgLocation").value.trim(),
      notes           : document.getElementById("editMtgNotes").value.trim(),
      meetingDate     : Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      meetingTime     : document.getElementById("editMtgTime").value || "",
      staffAttendees,
      externalAttendees,
    });
    showToast("Meeting updated ✓", "success");
    window.closeEditMeetingModal();
    if (typeof window.renderCalendarPanel === "function") window.renderCalendarPanel();
  } catch(e) { showToast("Error: " + e.message, "error"); }
  btn.textContent = "Save Changes"; btn.disabled = false;
};

window.cancelMeeting = async function(id) {
  try {
    await updateDoc(doc(db, MEETINGS_COL, id), { status: "cancelled" });
    showToast("Meeting cancelled", "");
    if (typeof window.renderCalendarPanel === "function") window.renderCalendarPanel();
  } catch(e) { showToast("Error", "error"); }
};

window.deleteMeeting = async function(id) {
  try {
    await deleteDoc(doc(db, MEETINGS_COL, id));
    showToast("Deleted", "");
    if (typeof window.renderCalendarPanel === "function") window.renderCalendarPanel();
  } catch(e) { showToast("Error", "error"); }
};

// ── Staff checkbox helper ──────────────────────────────────────────────────
function _populateMeetingStaffChecks(containerId, selected = []) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const staff = _allStaff.length ? _allStaff : [_currentUser].filter(Boolean);
  el.innerHTML = staff.map(name => {
    const av      = avatarFor(name);
    const checked = selected.includes(name) ? "checked" : "";
    return `<label class="mtg-staff-check">
      <input type="checkbox" value="${name}" ${checked}/>
      <span class="mtg-staff-av" style="background:${av.color}">${av.inits}</span>
      <span class="mtg-staff-name">${name}</span>
    </label>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP CALL SESSIONS — rendered inside Calls tab
// ═══════════════════════════════════════════════════════════════════════════

let _groupCallsCache  = [];
let _groupCallsUnsub  = null;

export function startGroupCallsListener(onUpdate) {
  if (_groupCallsUnsub) return;
  const q = query(collection(db, GROUPCALLS_COL), orderBy("scheduledDate", "asc"));
  _groupCallsUnsub = onSnapshot(q, snap => {
    _groupCallsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (onUpdate) onUpdate(_groupCallsCache);
  }, err => console.error("Group calls listener:", err.message));
}

export function stopGroupCallsListener() {
  if (_groupCallsUnsub) { _groupCallsUnsub(); _groupCallsUnsub = null; }
}

export function getGroupCallsCache() { return _groupCallsCache; }

// ── Group call card HTML ───────────────────────────────────────────────────
export function groupCallCard(gc) {
  const done      = gc.status === "done";
  const dt        = toDate(gc.scheduledDate);
  const dateLbl   = dayLabel(dt);
  const timeTxt   = gc.scheduledTime ? fmt12(gc.scheduledTime) : "";
  const isOverdue = dateLbl.includes("ago") && !done;
  const contacts  = gc.contacts || [];

  // Each contact row: name + phone/WA buttons + per-contact tick
  const contactRows = contacts.map((c, i) => {
    const called = (gc.calledContacts || []).includes(i);
    const phoneBtn = c.phone ? `<a class="gcc-dial-btn" href="tel:${c.phone}" title="Call">📞</a>` : "";
    const waBtn    = c.phone ? `<a class="gcc-wa-btn" href="https://wa.me/${c.phone.replace(/\D/g,"")}" target="_blank" title="WhatsApp">
      <svg class="gcc-wa-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      WA Call
    </a>` : "";

    return `<div class="gcc-contact-row ${called ? "gcc-contact-called" : ""}">
      <button class="gcc-tick ${called ? "gcc-tick-done" : ""}" onclick="window.toggleGroupCallContact('${gc.id}', ${i})" title="${called ? "Mark uncalled" : "Mark called"}">
        ${called ? "✓" : "○"}
      </button>
      <div class="gcc-contact-info">
        <div class="gcc-contact-name">${c.name || "(No name)"}</div>
        ${c.role ? `<div class="gcc-contact-role">${c.role}</div>` : ""}
      </div>
      <div class="gcc-contact-btns">
        ${phoneBtn}
        ${waBtn}
      </div>
    </div>`;
  }).join("");

  const calledCount = (gc.calledContacts || []).length;
  const progress = contacts.length > 0
    ? `<div class="gcc-progress">
        <div class="gcc-progress-bar" style="width:${Math.round(calledCount/contacts.length*100)}%"></div>
      </div>
      <div class="gcc-progress-lbl">${calledCount}/${contacts.length} called</div>`
    : "";

  const doneBtn = `<button class="cc-done-btn ${done ? "cc-done-active" : ""}" onclick="window.toggleGroupCallDone('${gc.id}', ${!done})">${done ? "✅ Done" : "○ Done"}</button>`;

  const adminActions = _isAdmin ? `
    <div class="cc-admin-btns">
      <button class="cc-action-btn cc-edit" onclick="window.openEditGroupCallModal('${gc.id}')" title="Edit">✏️</button>
      <button class="cc-action-btn cc-del"  onclick="window.deleteGroupCall('${gc.id}')" title="Delete">🗑</button>
    </div>` : "";

  return `
    <div class="gcc-card ${done ? "gcc-card-done" : isOverdue ? "gcc-card-overdue" : ""}">
      <div class="gcc-header">
        <div class="gcc-title-row">
          <span class="gcc-icon">👥</span>
          <span class="gcc-title">${gc.title || "Group Call Session"}</span>
          <span class="gcc-count-badge">${contacts.length} contacts</span>
        </div>
        <div class="gcc-meta">
          ${gc.purpose ? `<span class="gcc-purpose">${gc.purpose}</span>` : ""}
          <span class="gcc-date ${isOverdue ? "cc-date-red" : dateLbl === "Today" ? "cc-date-amber" : ""}">
            ${dateLbl}${timeTxt ? " · " + timeTxt : ""}
          </span>
        </div>
        ${progress}
      </div>
      <div class="gcc-contacts">${contactRows}</div>
      <div class="gcc-footer">
        ${doneBtn}
        ${adminActions}
      </div>
    </div>`;
}

// ── Toggle individual contact called state ─────────────────────────────────
window.toggleGroupCallContact = async function(id, contactIndex) {
  const gc = _groupCallsCache.find(x => x.id === id);
  if (!gc) return;
  let called = [...(gc.calledContacts || [])];
  if (called.includes(contactIndex)) {
    called = called.filter(i => i !== contactIndex);
  } else {
    called.push(contactIndex);
  }
  try {
    await updateDoc(doc(db, GROUPCALLS_COL, id), { calledContacts: called });
  } catch(e) { showToast("Error", "error"); }
};

window.toggleGroupCallDone = async function(id, markDone) {
  try {
    await updateDoc(doc(db, GROUPCALLS_COL, id), {
      status     : markDone ? "done" : "pending",
      completedAt: markDone ? Timestamp.now() : null,
    });
    showToast(markDone ? "Session marked done ✓" : "Reopened", markDone ? "success" : "");
  } catch(e) { showToast("Error", "error"); }
};

window.deleteGroupCall = async function(id) {
  try {
    await deleteDoc(doc(db, GROUPCALLS_COL, id));
    showToast("Deleted", "");
  } catch(e) { showToast("Error", "error"); }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADD GROUP CALL MODAL
// ═══════════════════════════════════════════════════════════════════════════

window.openAddGroupCallModal = function() {
  document.getElementById("gcTitle").value   = "";
  document.getElementById("gcPurpose").value = "";
  document.getElementById("gcDate").value    = new Date().toISOString().slice(0, 10);
  document.getElementById("gcTime").value    = "";
  document.getElementById("gcContactsList").innerHTML = "";
  _addGroupCallContactRow("gcContactsList"); // start with one row
  document.getElementById("addGroupCallModal").style.display = "flex";
  setTimeout(() => document.getElementById("gcTitle").focus(), 100);
};

window.closeAddGroupCallModal = function() {
  document.getElementById("addGroupCallModal").style.display = "none";
};
window.closeAddGroupCallIfOutside = function(e) {
  if (e.target === document.getElementById("addGroupCallModal")) window.closeAddGroupCallModal();
};

window.addGCContactRow = function() { _addGroupCallContactRow("gcContactsList"); };

function _addGroupCallContactRow(listId, name = "", phone = "", role = "") {
  const list = document.getElementById(listId);
  const row  = document.createElement("div");
  row.className = "gcc-form-row";
  const contactPickerSupported = "contacts" in navigator && "ContactsManager" in window;
  row.innerHTML = `
    <div class="gcc-form-row-inner">
      ${contactPickerSupported ? `<button class="gcc-pick-btn" onclick="window.pickGCContact(this)" type="button">👤</button>` : ""}
      <input class="modal-input gcc-name-input" placeholder="Name" value="${name}" autocomplete="name" style="margin-bottom:0;flex:2"/>
      <input class="modal-input gcc-role-input" placeholder="Role / Org" value="${role}" style="margin-bottom:0;flex:1.5"/>
      <input class="modal-input gcc-phone-input" placeholder="Phone" type="tel" value="${phone}" autocomplete="tel" style="margin-bottom:0;flex:2"/>
      <button class="mtg-ext-remove" onclick="this.closest('.gcc-form-row').remove()" type="button">✕</button>
    </div>`;
  list.appendChild(row);
  row.querySelector(".gcc-name-input").focus();
}

window.pickGCContact = async function(btn) {
  if (!("contacts" in navigator)) return;
  try {
    const [c] = await navigator.contacts.select(["name", "tel"], { multiple: false });
    if (!c) return;
    const row = btn.closest(".gcc-form-row");
    row.querySelector(".gcc-name-input").value  = c.name?.[0] || "";
    row.querySelector(".gcc-phone-input").value = c.tel?.[0]  || "";
    showToast("Contact filled ✓", "success");
  } catch(e) { showToast("Could not open contacts", ""); }
};

window.saveAddGroupCall = async function() {
  const title   = document.getElementById("gcTitle").value.trim();
  const dateVal = document.getElementById("gcDate").value;
  if (!title)   { showToast("Enter a session title", "error"); return; }
  if (!dateVal) { showToast("Pick a date", "error"); return; }

  const contacts = [...document.querySelectorAll("#gcContactsList .gcc-form-row")].map(row => ({
    name : row.querySelector(".gcc-name-input")?.value.trim() || "",
    role : row.querySelector(".gcc-role-input")?.value.trim() || "",
    phone: row.querySelector(".gcc-phone-input")?.value.trim() || "",
  })).filter(c => c.name || c.phone);

  if (!contacts.length) { showToast("Add at least one contact", "error"); return; }

  const btn = document.getElementById("saveGroupCallBtn");
  btn.textContent = "Saving…"; btn.disabled = true;
  try {
    await addDoc(collection(db, GROUPCALLS_COL), {
      title,
      purpose       : document.getElementById("gcPurpose").value.trim(),
      scheduledDate : Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      scheduledTime : document.getElementById("gcTime").value || "",
      contacts,
      calledContacts: [],
      status        : "pending",
      createdBy     : _currentUser,
      createdAt     : Timestamp.now(),
    });
    showToast("Group call session saved ✓", "success");
    window.closeAddGroupCallModal();
  } catch(e) { showToast("Error: " + e.message, "error"); }
  btn.textContent = "Save Session"; btn.disabled = false;
};

// ═══════════════════════════════════════════════════════════════════════════
// EDIT GROUP CALL MODAL
// ═══════════════════════════════════════════════════════════════════════════
let _editGCId = null;

window.openEditGroupCallModal = function(id) {
  _editGCId = id;
  const gc = _groupCallsCache.find(x => x.id === id);
  if (!gc) return;
  document.getElementById("editGcTitle").value   = gc.title || "";
  document.getElementById("editGcPurpose").value = gc.purpose || "";
  document.getElementById("editGcDate").value    = toDate(gc.scheduledDate).toISOString().slice(0, 10);
  document.getElementById("editGcTime").value    = gc.scheduledTime || "";
  const list = document.getElementById("editGcContactsList");
  list.innerHTML = "";
  (gc.contacts || []).forEach(c => _addEditGCContactRow(c.name, c.phone, c.role));
  if (!(gc.contacts || []).length) _addEditGCContactRow();
  document.getElementById("editGroupCallModal").style.display = "flex";
};

function _addEditGCContactRow(name = "", phone = "", role = "") {
  const list = document.getElementById("editGcContactsList");
  const row  = document.createElement("div");
  row.className = "gcc-form-row";
  const contactPickerSupported = "contacts" in navigator && "ContactsManager" in window;
  row.innerHTML = `
    <div class="gcc-form-row-inner">
      ${contactPickerSupported ? `<button class="gcc-pick-btn" onclick="window.pickEditGCContact(this)" type="button">👤</button>` : ""}
      <input class="modal-input gcc-name-input" placeholder="Name" value="${name}" autocomplete="name" style="margin-bottom:0;flex:2"/>
      <input class="modal-input gcc-role-input" placeholder="Role / Org" value="${role}" style="margin-bottom:0;flex:1.5"/>
      <input class="modal-input gcc-phone-input" placeholder="Phone" type="tel" value="${phone}" autocomplete="tel" style="margin-bottom:0;flex:2"/>
      <button class="mtg-ext-remove" onclick="this.closest('.gcc-form-row').remove()" type="button">✕</button>
    </div>`;
  list.appendChild(row);
}

window.addEditGCContactRow = function() { _addEditGCContactRow(); };

window.pickEditGCContact = async function(btn) {
  if (!("contacts" in navigator)) return;
  try {
    const [c] = await navigator.contacts.select(["name", "tel"], { multiple: false });
    if (!c) return;
    const row = btn.closest(".gcc-form-row");
    row.querySelector(".gcc-name-input").value  = c.name?.[0] || "";
    row.querySelector(".gcc-phone-input").value = c.tel?.[0]  || "";
    showToast("Contact filled ✓", "success");
  } catch(e) { showToast("Could not open contacts", ""); }
};

window.closeEditGroupCallModal = function() {
  document.getElementById("editGroupCallModal").style.display = "none";
  _editGCId = null;
};
window.closeEditGroupCallIfOutside = function(e) {
  if (e.target === document.getElementById("editGroupCallModal")) window.closeEditGroupCallModal();
};

window.saveEditGroupCall = async function() {
  if (!_editGCId) return;
  const title   = document.getElementById("editGcTitle").value.trim();
  const dateVal = document.getElementById("editGcDate").value;
  if (!title)   { showToast("Enter a session title", "error"); return; }
  if (!dateVal) { showToast("Pick a date", "error"); return; }
  const contacts = [...document.querySelectorAll("#editGcContactsList .gcc-form-row")].map(row => ({
    name : row.querySelector(".gcc-name-input")?.value.trim() || "",
    role : row.querySelector(".gcc-role-input")?.value.trim() || "",
    phone: row.querySelector(".gcc-phone-input")?.value.trim() || "",
  })).filter(c => c.name || c.phone);
  const btn = document.getElementById("saveEditGroupCallBtn");
  btn.textContent = "Saving…"; btn.disabled = true;
  try {
    await updateDoc(doc(db, GROUPCALLS_COL, _editGCId), {
      title,
      purpose      : document.getElementById("editGcPurpose").value.trim(),
      scheduledDate: Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      scheduledTime: document.getElementById("editGcTime").value || "",
      contacts,
    });
    showToast("Updated ✓", "success");
    window.closeEditGroupCallModal();
  } catch(e) { showToast("Error: " + e.message, "error"); }
  btn.textContent = "Save Changes"; btn.disabled = false;
};
