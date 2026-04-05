import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Config ─────────────────────────────────────────
const ADMIN = "Dr Basavaraj";

const employeesMap = {
  child: ["Dr Basavaraj","Dr Vanitha B","Mr Madhukar","Miss Manjula"],
  oral:  ["Dr Basavaraj","Dr Harshitha","Nethra"],
  ci:    ["Dr Basavaraj","Dr Vanitha B","Mr Madhukar","Miss Manjula"]
};
const deptNames = { child:"Child Health", oral:"Oral Health", ci:"Cochlear Implant" };
const avatarColors = ["#0d9488","#7c3aed","#db2777","#d97706","#2563eb","#059669","#dc2626"];

// All unique staff (preserving order, admin first)
const allStaff = [
  "Dr Basavaraj",
  ...Object.values(employeesMap).flat()
    .filter((v,i,a) => v !== ADMIN && a.indexOf(v) === i)
];

const priDotClass = { p1:"u", p2:"h", p3:"n", p4:"l" };
const priLabel    = { p1:"Urgent", p2:"High", p3:"Normal", p4:"Low" };
const priText     = { p1:"U", p2:"H", p3:"N", p4:"L" };

// ── Session state ──────────────────────────────────
let currentUser  = null;   // name string
let isAdmin      = false;

// ── App state ──────────────────────────────────────
let allTasks     = [];
let selectedPri  = "p4";
let editPri      = "p4";
let editId       = null;
let delId        = null;
let currentDept  = "child";
let urgentView   = false;
let messageCounts = {};     // taskId -> count (for badges)
let activeChatUnsub = null;
let messageCountUnsubs = [];
let taskListUnsub = null;   // onSnapshot listener for tasks

// ── DOM ────────────────────────────────────────────
const loginScreen  = document.getElementById("loginScreen");
const appScreen    = document.getElementById("appScreen");
const dashboard    = document.getElementById("dashboard");
const homeCalPanel = document.getElementById("homeCalendarPanel");
const toastEl      = document.getElementById("toast");
const loginNames   = document.getElementById("loginNames");

// ── Boot: show login ────────────────────────────────
buildLoginScreen();
loadTasksForLoginBadges();  // fetch tasks so name buttons show workload counts

async function loadTasksForLoginBadges() {
  // Pre-fetch just to show workload badges on the login screen.
  // This does NOT affect the post-login data flow.
  try {
    const snap = await getDocs(collection(db,"tasks"));
    allTasks = snap.docs.map(d => ({id:d.id,...d.data()}));
    buildLoginScreen();  // re-render name buttons with counts
  } catch(e) { console.warn("Badge preload:", e.message); }
}

function buildLoginScreen() {
  loginNames.innerHTML = "";

  // Admin button
  const adminDiv = createNameBtn(ADMIN, true);
  loginNames.appendChild(adminDiv);

  // Staff by dept — CI shares staff with Child, show once
  const shownStaff = new Set();
  Object.entries(employeesMap).forEach(([dept, emps]) => {
    if (dept === "ci") return;
    const label = document.createElement("div");
    label.className = "login-dept-label";
    label.textContent = dept === "child" ? "Child Health & Cochlear Implant" : deptNames[dept];
    loginNames.appendChild(label);
    emps.filter(e => e !== ADMIN && !shownStaff.has(e)).forEach(emp => {
      shownStaff.add(emp);
      loginNames.appendChild(createNameBtn(emp, false, dept));
    });
  });
}

function createNameBtn(name, admin, dept) {
  const idx      = allStaff.indexOf(name);
  const color    = avatarColors[idx % avatarColors.length];
  const initials = name.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();

  // Workload badges — urgent (red), overdue (amber), today (orange)
  let badgesHTML = "";
  if (!admin && allTasks.length > 0) {
    const mine    = allTasks.filter(t => t.assignedTo === name && t.status !== "completed");
    const urgent  = mine.filter(t => t.priority === "p1").length;
    const overdue = mine.filter(t => diffDays(t) < 0).length;
    const today   = mine.filter(t => diffDays(t) === 0).length;
    const b = (n, bg, fg, tip) =>
      n > 0 ? `<div class="ln-badge" style="background:${bg};color:${fg}" title="${tip}">${n}</div>` : "";
    badgesHTML = `<div class="ln-badges">
      ${b(urgent,  "#fef2f2", "#dc2626", "Urgent")}
      ${b(overdue, "#fff7ed", "#d97706", "Overdue")}
      ${b(today,   "#fffbeb", "#b45309", "Today")}
    </div>`;
  }

  const btn = document.createElement("button");
  btn.className = "login-name-btn" + (admin ? " admin-btn" : "");
  btn.innerHTML = `
    <div class="ln-av" style="background:${color}">${initials}</div>
    <div class="ln-info">
      <div class="ln-name">${name}</div>
      <div class="ln-tag">${admin ? "Admin · All departments" : deptNames[dept]||""}</div>
    </div>
    ${badgesHTML}`;
  btn.onclick = admin ? () => promptAdminPin() : () => loginAs(name);
  return btn;
}

// ── Admin PIN ──────────────────────────────────────
const ADMIN_PIN = "1234";  // ← change to your preferred PIN

function promptAdminPin() {
  document.getElementById("pinOverlay").style.display = "flex";
  document.getElementById("pinInput").value = "";
  document.getElementById("pinError").style.display = "none";
  setTimeout(() => document.getElementById("pinInput").focus(), 100);
}
window.submitAdminPin = function() {
  if (document.getElementById("pinInput").value.trim() === ADMIN_PIN) {
    document.getElementById("pinOverlay").style.display = "none";
    loginAs(ADMIN);
  } else {
    document.getElementById("pinError").style.display = "block";
    document.getElementById("pinInput").value = "";
    document.getElementById("pinInput").focus();
  }
};
window.cancelAdminPin = function() {
  document.getElementById("pinOverlay").style.display = "none";
};

function loginAs(name) {
  currentUser = name;
  isAdmin     = (name === ADMIN);

  // Show app, hide login
  loginScreen.style.display = "none";
  appScreen.style.display   = "block";

  // Header
  const idx     = allStaff.indexOf(name);
  const color   = avatarColors[idx % avatarColors.length];
  const initials= name.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
  document.getElementById("headerAvatar").style.background = color;
  document.getElementById("headerAvatar").textContent = initials;
  document.getElementById("headerName").textContent = name;
  document.getElementById("headerRole").textContent = isAdmin ? "Admin · All departments" : "Staff";

  // Show/hide admin controls
  document.getElementById("adminControls").style.display = isAdmin ? "block" : "none";
  document.getElementById("staffStrip").style.display    = isAdmin ? "none"  : "block";
  document.getElementById("exportBtn").style.display     = isAdmin ? "grid"  : "none";
  setHomeCalendarVisibility(true);

  // Show bottom nav + FAB for everyone
  const bNav = document.getElementById("bottomNav");
  if (bNav) bNav.style.display = "flex";
  const fab = document.getElementById("fabAddBtn");
  if (fab) fab.style.display = "grid";
  // Reset bottom nav state
  document.getElementById("bnavHome")?.classList.add("active");
  document.getElementById("bnavCalendar")?.classList.remove("active");

  // Show spinner immediately
  dashboard.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading tasks…</p></div>`;
  if (isAdmin) { populateAssignSelect(); }
  renderHomeCalendarPanel();

  // ── Immediate fetch: renders tasks as fast as possible ───────────────────
  getDocs(collection(db, "tasks"))
    .then(snap => {
      allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCurrentView();
      loadMessageCounts();
    })
    .catch(err => {
      // Silently ignore — live onSnapshot listener will still load data
      console.warn("Initial fetch failed:", err.message);
    });

  // ── Live listener: keeps data fresh after the initial render ─────────────
  if (taskListUnsub) { taskListUnsub(); taskListUnsub = null; }
  taskListUnsub = onSnapshot(
    collection(db, "tasks"),
    snap => {
      allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCurrentView();
    },
    err => { console.error("Live listener error:", err.message); }
  );
}

window.logout = function() {
  if (taskListUnsub)  { taskListUnsub();  taskListUnsub  = null; }
  if (activeChatUnsub){ activeChatUnsub(); activeChatUnsub = null; }
  messageCountUnsubs.forEach(fn => fn());
  messageCountUnsubs = [];
  messageCounts = {};
  currentUser = null; isAdmin = false;
  calView = false;
  // Hide bottom nav and FAB
  const bNav = document.getElementById("bottomNav");
  if (bNav) bNav.style.display = "none";
  const fab = document.getElementById("fabAddBtn");
  if (fab) fab.style.display = "none";
  appScreen.style.display   = "none";
  loginScreen.style.display = "flex";
};

// ── Home calendar panel functions ─────────────────────────────────────────
function setHomeCalendarVisibility(visible) {
  if (homeCalPanel) homeCalPanel.style.display = visible ? "block" : "none";
}

async function renderHomeCalendarPanel() {
  if (!homeCalPanel) return;
  homeCalPanel.innerHTML = '<div class="cal-state" style="padding:14px 0"><div class="spinner" style="width:22px;height:22px;border-width:2px;margin-bottom:6px"></div><p style="font-size:12px">Loading calendar...</p></div>';
  try {
    const text   = await fetchICS();
    const events = parseICS(text);
    _buildHomeCalStrip(events);
  } catch(e) {
    homeCalPanel.innerHTML = '<div style="padding:10px 14px;font-size:11px;color:#94a3b8;font-weight:600;text-align:center">Calendar unavailable</div>';
  }
}

function _buildHomeCalStrip(events) {
  if (!homeCalPanel) return;
  const now      = new Date(); now.setHours(0,0,0,0);
  const upcoming = events.filter(e => e.start >= now).slice(0, 5);
  if (!upcoming.length) {
    homeCalPanel.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:#94a3b8;font-weight:600;text-align:center">No upcoming events</div>';
    return;
  }
  const todayKey = now.toISOString().slice(0,10);
  const tmrwKey  = new Date(now.getTime()+86400000).toISOString().slice(0,10);
  const rows = upcoming.map(ev => {
    const key  = ev.start.toISOString().slice(0,10);
    const when = key===todayKey?'Today':key===tmrwKey?'Tomorrow':ev.start.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
    const allDay = ev.start.getHours()===0 && ev.start.getMinutes()===0;
    const time   = allDay?'All day':ev.start.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    return '<div class="hcal-row"><div class="hcal-when'+(key===todayKey?' hcal-today':'')+'">'+when+'</div><div class="hcal-info"><div class="hcal-title">'+(ev.title||'(No title)')+'</div><div class="hcal-time">'+time+(ev.location?' - '+ev.location:'')+'</div></div></div>';
  }).join('');
  homeCalPanel.innerHTML = '<div class="hcal-header"><span>Upcoming</span><button class="hcal-more" onclick="switchToCalendarTab()">View all</button></div>'+rows;
}


// ── Forecast banner + Top 3 Urgent ────────────────
function buildForecastBanner() {
  const active  = allTasks.filter(t => t.status !== "completed");
  const overdue = active.filter(t => diffDays(t) < 0);
  const today   = active.filter(t => diffDays(t) === 0);
  const urgent  = active.filter(t => t.priority === "p1");
  const score   = overdue.length * 3 + urgent.length * 2 + today.length;
  let icon, mood, color, bg;
  if      (score === 0)  { icon="☀️";  mood="Clear Day";         color="#059669"; bg="#ecfdf5"; }
  else if (score <= 3)   { icon="🌤️"; mood="Light Load";        color="#0d9488"; bg="#f0fdfa"; }
  else if (score <= 7)   { icon="⛅";  mood="Moderate Pressure"; color="#d97706"; bg="#fffbeb"; }
  else if (score <= 12)  { icon="🌧️"; mood="Heavy Load";        color="#ea580c"; bg="#fff7ed"; }
  else                   { icon="⛈️"; mood="Storm — Critical";  color="#dc2626"; bg="#fef2f2"; }
  const pill = (n, lbl, ac, ab, onclick) => `<div class="fc-pill${n>0?' fc-pill-click':''}" style="background:${n>0?ab:"#f1f5f9"};color:${n>0?ac:"#94a3b8"}"
    ${n>0&&onclick?`onclick="${onclick}" title="Tap to view"`:''}${n>0?'style="cursor:pointer;background:'+ab+';color:'+ac+'"':''}>
    <span class="fc-pnum">${n}</span><span class="fc-plbl">${lbl}</span></div>`;
  return `<div class="fc-banner" style="background:${bg};border-bottom:2px solid ${color}30">
    <div class="fc-left"><span class="fc-icon">${icon}</span><div class="fc-mood" style="color:${color}">${mood}</div></div>
    <div class="fc-pills">
      ${pill(overdue.length,"Overdue","#dc2626","#fef2f2","showOfficeUrgent('overdue')")}
      ${pill(today.length,  "Today",  "#ea580c","#fff7ed","showOfficeUrgent('today')")}
      ${pill(urgent.length, "Urgent", "#dc2626","#fef2f2","showOfficeUrgent('urgent')")}
    </div>
  </div>`;
}

function buildTop3Urgent() {
  const top3 = allTasks
    .filter(t => t.priority === "p1" && t.status !== "completed")
    .sort((a, b) => safeDate(a.dueDate) - safeDate(b.dueDate))
    .slice(0, 3);
  if (!top3.length) return "";

  const rows = top3.map(t => {
    const diff    = diffDays(t);
    const emp     = t.assignedTo || "—";
    const idx     = allStaff.indexOf(emp);
    const color   = avatarColors[idx >= 0 ? idx % avatarColors.length : 0];
    const initials= emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();

    // Right-side bubble: overdue days (red), due today (amber), upcoming (grey)
    let bubble = "";
    if (diff < 0) {
      bubble = `<div class="up-bubble up-bubble-over">${Math.abs(diff)}d</div>`;
    } else if (diff === 0) {
      bubble = `<div class="up-bubble up-bubble-today">Today</div>`;
    } else {
      bubble = `<div class="up-bubble up-bubble-soon">${diff}d</div>`;
    }

    return `<div class="up-row">
      <div class="up-av" style="background:${color}">${initials}</div>
      <div class="up-content">
        <div class="up-name">${emp}</div>
        <div class="up-task">${t.title}</div>
      </div>
      ${bubble}
    </div>`;
  }).join("");

  return `<div class="up-wrap">
    <div class="up-header">🔴 Urgent — needs attention</div>
    <div class="up-list">${rows}</div>
  </div>`;
}

// ── renderCurrentView: single entry point for all dashboard renders ──────────
function renderCurrentView() {
  // Don't clobber the calendar while it's showing
  if (calView) return;
  if (isAdmin) {
    populateAssignSelect();
    if (urgentView) renderUrgentView();
    else            renderAdminDashboard();
    updateAdminStats();
  } else {
    renderStaffView();
  }
}

// ── loadTasks: fetch fresh data and re-render (called after mutations) ───────
async function loadTasks(keepView = false) {
  try {
    const snap = await getDocs(collection(db,"tasks"));
    allTasks = snap.docs.map(d => ({id:d.id,...d.data()}));
  } catch(e) {
    console.error(e);
    showToast("Cannot reach database","error");
    return;
  }
  loadMessageCounts();
  renderCurrentView();
}

// ── ADMIN ──────────────────────────────────────────
window.selectDepartment = function(d) {
  urgentView  = false;
  currentDept = d;
  document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
  document.querySelector(`[data-dept='${d}']`)?.classList.add("active");
  populateAssignSelect();
  renderAdminDashboard();
  updateAdminStats();
};

window.selectUrgentView = function() {
  urgentView = true;
  document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
  document.querySelector("[data-dept='urgent-view']")?.classList.add("active");
  renderUrgentView();
  updateAdminStats();
};

function populateAssignSelect() {
  const sel = document.getElementById("assignTo");
  const cur = sel.value;
  sel.innerHTML = `<option value="">— Assign to —</option>`;
  employeesMap[currentDept].forEach(e => {
    const o = document.createElement("option");
    o.value = o.textContent = e;
    if(e === cur) o.selected = true;
    sel.appendChild(o);
  });
}

function updateAdminStats() {
  const tasks = urgentView ? allTasks : allTasks.filter(t=>t.department===currentDept);
  const total = tasks.length;
  const done  = tasks.filter(t=>t.status==="completed").length;
  const ov    = tasks.filter(t=>t.status!=="completed"&&diffDays(t)<0).length;
  const urg   = tasks.filter(t=>t.priority==="p1"&&t.status!=="completed").length;
  document.getElementById("statsStrip").innerHTML = `
    <div class="stat-pill sp-total"><div class="snum">${total}</div><div class="slbl">Total</div></div>
    <div class="stat-pill sp-done"><div class="snum">${done}</div><div class="slbl">Done</div></div>
    <div class="stat-pill sp-over"><div class="snum">${ov}</div><div class="slbl">Overdue</div></div>
    <div class="stat-pill sp-urg"><div class="snum">${urg}</div><div class="slbl">Urgent</div></div>`;
}

// ── Admin: normal dept view ────────────────────────
function renderAdminDashboard() {
  dashboard.innerHTML = buildForecastBanner() + buildTop3Urgent();
  const emps    = employeesMap[currentDept];
  const deptAll = allTasks.filter(t=>t.department===currentDept);

  emps.forEach((emp, ei) => {
    const empTasks  = deptAll.filter(t=>t.assignedTo===emp);
    const active    = empTasks.filter(t=>t.status!=="completed");
    const overdueCnt= active.filter(t=>diffDays(t)<0).length;

    const color    = avatarColors[allStaff.indexOf(emp) % avatarColors.length];
    const initials = emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();

    // Section header
    const head = document.createElement("div");
    head.className = "admin-emp-head";
    head.innerHTML = `
      <div class="admin-emp-av" style="background:${color}">${initials}</div>
      <div class="admin-emp-name">${emp}</div>
      <div class="admin-emp-count">${active.length} pending${overdueCnt?" · ⚠"+overdueCnt+" overdue":""}</div>`;
    dashboard.appendChild(head);

    const buckets = bucket(empTasks);
    const order   = ["overdue","today","tomorrow","upcoming","completed"];
    const secMeta = {
      overdue:{label:"Overdue",dot:"dot-overdue"},
      today:{label:"Today",dot:"dot-today"},
      tomorrow:{label:"Tomorrow",dot:"dot-tomorrow"},
      upcoming:{label:"Upcoming",dot:"dot-upcoming"},
      completed:{label:"Done",dot:"dot-done"}
    };

    let anyTask = false;
    order.forEach(sec => {
      const list = sortByPriority(buckets[sec]);
      if(!list.length) return;
      anyTask = true;
      const lbl = document.createElement("div");
      lbl.className = "sec-label";
      lbl.innerHTML = `<span class="sec-dot ${secMeta[sec].dot}"></span>${secMeta[sec].label} (${list.length})`;
      dashboard.appendChild(lbl);
      list.forEach(t => {
        const row = buildAdminTaskRow(t);
        dashboard.appendChild(row);
      });
    });

    if(!anyTask) {
      const em = document.createElement("div");
      em.style.cssText = "font-size:12px;color:var(--text3);padding:4px 0 8px;font-weight:600;";
      em.textContent = "No tasks assigned";
      dashboard.appendChild(em);
    }
  });
}

function buildAdminTaskRow(t) {
  const done    = t.status==="completed";
  const diff    = diffDays(t);
  const dotCls  = priDotClass[t.priority||"p4"];
  const dueInfo = dueChip(diff, done);
  const repeat  = repeatLabel(t.repeat);

  const row = document.createElement("div");
  row.className = `task-row ${cardClass(diff,done)}${done?" done":""}`;
  row.innerHTML = `
    <div class="pri-dot ${dotCls}"></div>
    <input type="checkbox" class="task-cb" ${done?"checked":""}
      onchange="toggleTask('${t.id}',this.checked)" onclick="event.stopPropagation()">
    <div class="task-text" title="${t.title}">${t.title}${repeat}</div>
    <div class="task-due-chip ${dueInfo.cls}">${dueInfo.txt}</div>
    <div class="task-acts">
      <button class="tact-btn chat-btn" onclick="openChat('${t.id}')" title="Messages">
        💬<span class="chat-badge" id="cb-${t.id}" style="display:none"></span>
      </button>
      <button class="tact-btn"     onclick="openEditModal('${t.id}')"   title="Edit">✏️</button>
      <button class="tact-btn del" onclick="openDeleteModal('${t.id}')" title="Delete">🗑</button>
    </div>`;
  return row;
}

// ── Admin: Urgent view (cross-dept overdue + today) ─
function renderUrgentView() {
  dashboard.innerHTML = buildForecastBanner();
  const urgent = allTasks.filter(t=>t.status!=="completed"&&diffDays(t)<=0);

  if(!urgent.length) {
    dashboard.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <h3>All clear!</h3><p>No overdue or today's tasks across all departments.</p>
    </div>`;
    return;
  }

  const ov  = urgent.filter(t=>diffDays(t)<0).length;
  const tod = urgent.filter(t=>diffDays(t)===0).length;
  const banner = document.createElement("div");
  banner.className = "urgent-banner";
  banner.innerHTML = `
    <div class="urgent-banner-icon">🔴</div>
    <div>
      <div class="urgent-banner-text">Urgent Attention Required</div>
      <div class="urgent-banner-sub">${ov} overdue · ${tod} due today · all departments</div>
    </div>`;
  dashboard.appendChild(banner);

  allStaff.forEach((emp, ei) => {
    const empTasks = urgent.filter(t=>t.assignedTo===emp);
    if(!empTasks.length) return;

    const color    = avatarColors[ei%avatarColors.length];
    const initials = emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const overdue  = empTasks.filter(t=>diffDays(t)<0);
    const today    = empTasks.filter(t=>diffDays(t)===0);

    const head = document.createElement("div");
    head.className = "admin-emp-head";
    head.innerHTML = `
      <div class="admin-emp-av" style="background:${color}">${initials}</div>
      <div class="admin-emp-name">${emp}</div>
      <div class="admin-emp-count">${overdue.length?" ⚠"+overdue.length+" overdue":""} ${today.length?today.length+" today":""}</div>`;
    dashboard.appendChild(head);

    [[overdue,"Overdue","dot-overdue"],[today,"Today","dot-today"]].forEach(([list,lbl,dot])=>{
      if(!list.length) return;
      const sl = document.createElement("div");
      sl.className="sec-label";
      sl.innerHTML=`<span class="sec-dot ${dot}"></span>${lbl}`;
      dashboard.appendChild(sl);
      sortByPriority(list).forEach(t=>{
        dashboard.appendChild(buildAdminTaskRow(t));
      });
    });
  });
}

// ── Staff: today's appointment banner ────────────────
function buildMyAppointments() {
  const mySlotted = allTasks.filter(t =>
    t.assignedTo === currentUser && t.slot && t.status !== 'completed' &&
    diffDays(t) === 0
  ).sort((a, b) => a.slot.localeCompare(b.slot));

  if (!mySlotted.length) return '';

  const rows = mySlotted.map(t => {
    const priColors = {p1:'#ef4444',p2:'#f97316',p3:'#3b82f6',p4:'#94a3b8'};
    const dot = priColors[t.priority||'p4'];
    return `<div class="appt-row">
      <div class="appt-dot" style="background:${dot}"></div>
      <div class="appt-time">${_fmt12(t.slot)}</div>
      <div class="appt-task">${t.title}</div>
    </div>`;
  }).join('');

  return `<div class="appt-banner">
    <div class="appt-banner-head">
      <span class="appt-banner-icon">🗓</span>
      <span class="appt-banner-title">Your Schedule Today</span>
      <span class="appt-banner-count">${mySlotted.length} task${mySlotted.length>1?'s':''}</span>
    </div>
    <div class="appt-rows">${rows}</div>
  </div>`;
}

// Also expose _fmt12 for staff banner (defined later in calendar section but needed here)
function _fmt12(slot) {
  if (!slot) return '';
  const [h, m] = slot.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ── STAFF VIEW ─────────────────────────────────────
function renderStaffView() {
  dashboard.innerHTML = buildForecastBanner() + buildTop3Urgent() + buildMyAppointments();

  const myTasks = allTasks.filter(t => t.assignedTo === currentUser);
  const pending = myTasks.filter(t => t.status !== "completed");
  const overdue = pending.filter(t => diffDays(t) < 0);
  const todayT  = pending.filter(t => diffDays(t) === 0);
  const done    = myTasks.filter(t => t.status === "completed");

  document.getElementById("staffStripInner").innerHTML = `
    <div class="sstrip-pill sp-pending">
      <div class="snum">${pending.length}</div><div class="slbl">Pending</div>
    </div>
    ${overdue.length ? `<div class="sstrip-pill" style="background:var(--red-l)">
      <div class="snum" style="color:var(--red)">${overdue.length}</div>
      <div class="slbl" style="color:#b91c1c">Overdue</div></div>` : ""}
    ${todayT.length ? `<div class="sstrip-pill" style="background:var(--amber-l)">
      <div class="snum" style="color:var(--amber)">${todayT.length}</div>
      <div class="slbl" style="color:#92400e">Due Today</div></div>` : ""}
    <div class="sstrip-pill sp-done">
      <div class="snum">${done.length}</div><div class="slbl">Done</div>
    </div>`;

  if (!pending.length && !done.length) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = `<div class="empty-icon">🎉</div><h3>All done!</h3><p>No tasks assigned right now.</p>`;
    dashboard.appendChild(el);
    return;
  }

  // Stats shown in staffStrip above — no duplicate name card needed


  const priChip = (t) => {
    const colors = {p1:"var(--c-u)", p2:"var(--c-h)", p3:"var(--c-n)", p4:"var(--c-l)"};
    return `<span class="mts-pri-dot" style="background:${colors[t.priority||'p4']}"></span>`;
  };
  const sections = [
    { key:"overdue",   icon:"⚠️",  label:"Overdue",          accent:"#dc2626", bg:"#fef2f2", border:"#fecaca",
      tasks: [...pending.filter(t=>diffDays(t)<0)].sort((a,b)=>{if(a.slot&&b.slot)return a.slot.localeCompare(b.slot);if(a.slot)return -1;if(b.slot)return 1;return({p1:1,p2:2,p3:3,p4:4}[a.priority||'p4'])-({p1:1,p2:2,p3:3,p4:4}[b.priority||'p4']);}),
      rowFn: t => `<div class="mts-row mts-row-over">${priChip(t)}<div class="mts-title">${t.title}${t.slot?'<br><span class="mts-time-chip">&#128336; '+_fmt12(t.slot)+'</span>':''}</div><div class="mts-overdue-bubble">${Math.abs(diffDays(t))}d</div><button class="mts-chat-btn" onclick="openChat('${t.id}')">💬<span class="chat-badge" id="cb-${t.id}" style="display:none"></span></button></div>` },
    { key:"today",     icon:"📋",  label:"Today's Tasks",    accent:"#d97706", bg:"#fffbeb", border:"#fde68a",
      tasks: [...pending.filter(t=>diffDays(t)===0)].sort((a,b)=>{if(a.slot&&b.slot)return a.slot.localeCompare(b.slot);if(a.slot)return -1;if(b.slot)return 1;return({p1:1,p2:2,p3:3,p4:4}[a.priority||'p4'])-({p1:1,p2:2,p3:3,p4:4}[b.priority||'p4']);}),
      rowFn: t => `<div class="mts-row mts-row-today">${priChip(t)}<div class="mts-title">${t.title}${t.slot?'<br><span class="mts-time-chip">&#128336; '+_fmt12(t.slot)+'</span>':''}</div><button class="mts-chat-btn" onclick="openChat('${t.id}')">💬<span class="chat-badge" id="cb-${t.id}" style="display:none"></span></button></div>` },
    { key:"tomorrow",  icon:"📅",  label:"Tomorrow's Tasks", accent:"#0ea5e9", bg:"#f0f9ff", border:"#bae6fd",
      tasks: [...pending.filter(t=>diffDays(t)===1)].sort((a,b)=>{if(a.slot&&b.slot)return a.slot.localeCompare(b.slot);if(a.slot)return -1;if(b.slot)return 1;return({p1:1,p2:2,p3:3,p4:4}[a.priority||'p4'])-({p1:1,p2:2,p3:3,p4:4}[b.priority||'p4']);}),
      rowFn: t => `<div class="mts-row mts-row-tmrw">${priChip(t)}<div class="mts-title">${t.title}${t.slot?'<br><span class="mts-time-chip">&#128336; '+_fmt12(t.slot)+'</span>':''}</div><button class="mts-chat-btn" onclick="openChat('${t.id}')">💬<span class="chat-badge" id="cb-${t.id}" style="display:none"></span></button></div>` },
    { key:"upcoming",  icon:"🗓",  label:"Upcoming",         accent:"#059669", bg:"#f0fdf4", border:"#bbf7d0",
      tasks: sortByPriority(pending.filter(t => diffDays(t) > 1)),
      rowFn: t => `<div class="mts-row mts-row-up">${priChip(t)}<div class="mts-title">${t.title}</div><div class="mts-badge mts-badge-up">${safeDate(t.dueDate).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div><button class="mts-chat-btn" onclick="openChat('${t.id}')">💬<span class="chat-badge" id="cb-${t.id}" style="display:none"></span></button></div>` },
    { key:"completed", icon:"✅",  label:"Completed",        accent:"#94a3b8", bg:"#f8fafc", border:"#e2e8f0",
      tasks: done,
      rowFn: t => `<div class="mts-row mts-row-done"><div class="mts-title mts-done-title">${t.title}</div><div class="mts-badge mts-badge-done">✓ Done</div></div>` }
  ];

  sections.forEach(sec => {
    if (!sec.tasks.length) return;
    const card = document.createElement("div");
    card.className = `mts-card mts-card-${sec.key}`;
    const hdr = document.createElement("div");
    hdr.className = "mts-sec-header";
    hdr.style.cssText = `background:${sec.bg};`;
    hdr.innerHTML = `<span class="mts-sec-icon">${sec.icon}</span>
      <span class="mts-sec-label" style="color:${sec.accent}">${sec.label}</span>
      <span class="mts-sec-count" style="background:${sec.accent}20;color:${sec.accent}">${sec.tasks.length}</span>`;
    card.appendChild(hdr);
    const block = document.createElement("div");
    block.className = "mts-block";

    block.innerHTML = sec.tasks.map(sec.rowFn).join("");
    card.appendChild(block);
    dashboard.appendChild(card);
  });
}

function buildStaffCard(t) {
  const done = t.status === "completed";
  const diff = diffDays(t);
  const dueInfo = dueChip(diff, done);
  const card = document.createElement("div");
  card.className = `staff-task-card ${cardClass(diff,done)}`;
  card.innerHTML = `<div class="stc-body">
    <div class="stc-pri ${priDotClass[t.priority||"p4"]}">${priText[t.priority||"p4"]}</div>
    <div class="stc-main"><div class="stc-title">${t.title}</div>
      <div style="margin-top:4px"><span class="stc-due ${dueInfo.cls}">${dueInfo.txt}</span></div>
    </div></div>`;
  return card;
}


// ── Admin actions ──────────────────────────────────
window.selectPriority = function(p) {
  selectedPri = p;
  ["p1","p2","p3","p4"].forEach(id=>document.getElementById(id)?.classList.remove("selected"));
  document.getElementById(p)?.classList.add("selected");
};
window.selectEditPriority = function(p) {
  editPri = p;
  ["ep1","ep2","ep3","ep4"].forEach(id=>document.getElementById(id)?.classList.remove("selected"));
  document.getElementById("e"+p)?.classList.add("selected");
};

window.onRepeatChange = function(sel) {
  document.getElementById("customDaysWrap").style.display = sel.value==="custom"?"flex":"none";
};
window.onEditRepeatChange = function(sel) {
  document.getElementById("editCustomDaysWrap").style.display = sel.value==="custom"?"flex":"none";
};

function getRepeatValue(selId, custId) {
  const v = document.getElementById(selId).value;
  if(v==="custom"){
    const n = parseInt(document.getElementById(custId).value);
    return (!isNaN(n)&&n>0) ? String(n) : "none";
  }
  return v;
}


// ── Show office-wide urgent/overdue tasks (staff view — read only) ──────────
window.showOfficeUrgent = function(mode) {
  const existing = document.getElementById("officeUrgentOverlay");
  if (existing) existing.remove();

  let tasks;
  let title, sub;
  if (mode === "overdue") {
    tasks = allTasks.filter(t => t.status !== "completed" && diffDays(t) < 0);
    title = "⚠ Overdue Tasks — All Staff";
    sub   = "Tap to see · Help where you can";
  } else if (mode === "today") {
    tasks = allTasks.filter(t => t.status !== "completed" && diffDays(t) === 0);
    title = "📋 Today's Tasks — All Staff";
    sub   = "Everything due today across the office";
  } else {
    tasks = allTasks.filter(t => t.status !== "completed" && t.priority === "p1");
    title = "🔴 Urgent Tasks — All Staff";
    sub   = "All urgent tasks across the office";
  }

  const ov = document.createElement("div");
  ov.id = "officeUrgentOverlay";
  ov.style.cssText = "position:fixed;inset:0;background:#f1f5f9;z-index:300;overflow-y:auto;";

  const priLabels = {p1:"🔴 Urgent", p2:"🟠 High", p3:"🔵 Normal", p4:"⚪ Low"};
  const priCls    = {p1:"mts-p1", p2:"mts-p2", p3:"mts-p3", p4:"mts-p4"};

  // Group by employee
  const grouped = {};
  tasks.forEach(t => {
    if (!grouped[t.assignedTo]) grouped[t.assignedTo] = [];
    grouped[t.assignedTo].push(t);
  });

  const rows = Object.entries(grouped).sort((a,b) => b[1].length - a[1].length).map(([emp, empTasks]) => {
    const idx   = allStaff.indexOf(emp);
    const color = avatarColors[idx % avatarColors.length];
    const init  = emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const taskRows = empTasks.sort((a,b) => {
      const po = {p1:1,p2:2,p3:3,p4:4};
      return po[a.priority]-po[b.priority];
    }).map(t => {
      const d = diffDays(t);
      const dueStr = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "Due today" : `Due in ${d}d`;
      const dueCls = d < 0 ? "mts-badge-over" : d === 0 ? "mts-badge-today" : "mts-badge-tmrw";
      return `<div class="mts-row" style="padding:10px 16px">
        <span class="mts-pri-chip ${priCls[t.priority||'p4']}">${priLabels[t.priority||'p4']}</span>
        <div class="mts-title">${t.title}</div>
        <div class="mts-badge ${dueCls}">${dueStr}</div>
      </div>`;
    }).join("");
    return `<div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;background:#fff;border-bottom:1px solid #e2e8f0">
        <div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${init}</div>
        <div style="font-size:13px;font-weight:800;color:#0f172a;flex:1">${emp}</div>
        <div style="font-size:11px;font-weight:700;color:#475569">${empTasks.length} task${empTasks.length!==1?"s":""}</div>
      </div>
      <div style="background:#fff;border-bottom:2px solid #e2e8f0">${taskRows}</div>
    </div>`;
  }).join("");

  ov.innerHTML = `
    <div style="background:linear-gradient(135deg,#991b1b,#dc2626);padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10">
      <button onclick="document.getElementById('officeUrgentOverlay').remove()"
        style="width:34px;height:34px;border:none;border-radius:9px;background:rgba(255,255,255,.2);color:#fff;font-size:18px;cursor:pointer;display:grid;place-items:center;flex-shrink:0">←</button>
      <div>
        <div style="color:#fff;font-size:15px;font-weight:800">${title}</div>
        <div style="color:rgba(255,255,255,.75);font-size:11px;font-weight:600">${tasks.length} task${tasks.length!==1?"s":""} · ${sub}</div>
      </div>
    </div>
    <div style="padding:12px 0">${rows || '<div style="padding:48px 16px;text-align:center;color:#94a3b8;font-size:14px;font-weight:600">All clear — nothing here!</div>'}</div>`;

  document.body.appendChild(ov);
};

window.addTask = async function() {
  if(!isAdmin) return;
  const title  = document.getElementById("task").value.trim();
  const emp    = document.getElementById("assignTo").value;
  const days   = parseInt(document.getElementById("days").value)||0;
  const repeat = getRepeatValue("repeat","customDays");

  if(!title){ showToast("Enter a task","error"); return; }
  if(!emp)  { showToast("Select who to assign","error"); return; }

  const due = new Date(); due.setHours(0,0,0,0);
  due.setDate(due.getDate()+days);

  const btn=document.getElementById("mainBtn");
  btn.textContent="…"; btn.disabled=true;
  try {
    await addDoc(collection(db,"tasks"),{
      title,assignedTo:emp,department:currentDept,
      dueDate:due,priority:selectedPri,repeat,
      status:"pending",createdAt:new Date()
    });
    document.getElementById("task").value="";
    showToast("Task added ✓","success");
    await loadTasks(true);
  } catch(e){ showToast("Error saving","error"); }
  btn.textContent="＋"; btn.disabled=false;
};

window.toggleTask = async function(id, checked) {
  if(!isAdmin) return;
  try {
    await updateDoc(doc(db,"tasks",id),{status:checked?"completed":"pending"});
    showToast(checked?"Done! 🎉":"Reopened",checked?"success":"");
    await loadTasks(true);

    if(checked){
      setTimeout(async()=>{
        const t=allTasks.find(t=>t.id===id);
        if(!t||!t.repeat||t.repeat==="none") return;
        const next=new Date(safeDate(t.dueDate));
        const n=parseInt(t.repeat);
        if(t.repeat==="daily")       next.setDate(next.getDate()+1);
        else if(t.repeat==="weekly") next.setDate(next.getDate()+7);
        else if(!isNaN(n))           next.setDate(next.getDate()+n);
        const{id:_,createdAt:__,...rest}=t;
        await addDoc(collection(db,"tasks"),{...rest,dueDate:next,status:"pending",createdAt:new Date()});
        await loadTasks(true);
        showToast("Next recurrence scheduled 🔁","success");
      },1500);
    }
  } catch(e){ showToast("Error","error"); }
};

window.openEditModal = function(id) {
  if(!isAdmin) return;
  const t=allTasks.find(t=>t.id===id); if(!t) return;
  editId=id; editPri=t.priority||"p4";
  document.getElementById("editTask").value=t.title;
  const reSel = document.getElementById("editAssignTo");
  if (reSel) {
    const staff = employeesMap[t.department] || allStaff;
    reSel.innerHTML = staff.map(e =>
      `<option value="${e}" ${e===t.assignedTo?"selected":""}>${e}</option>`
    ).join("");
  }
  const diff=diffDays(t);
  const presets=[0,1,2,3,5,7];
  const best=diff>=0?presets.reduce((a,b)=>Math.abs(b-diff)<Math.abs(a-diff)?b:a,0):0;
  document.getElementById("editDays").value=best;

  const knownRepeats=["none","daily","weekly"];
  const erSel=document.getElementById("editRepeat");
  const ecWrap=document.getElementById("editCustomDaysWrap");
  if(knownRepeats.includes(t.repeat||"none")){
    erSel.value=t.repeat||"none"; ecWrap.style.display="none";
  } else {
    erSel.value="custom";
    document.getElementById("editCustomDays").value=t.repeat||"";
    ecWrap.style.display="flex";
  }

  ["ep1","ep2","ep3","ep4"].forEach(id=>document.getElementById(id)?.classList.remove("selected"));
  document.getElementById("e"+editPri)?.classList.add("selected");
  document.getElementById("editModal").style.display="flex";
  setTimeout(()=>document.getElementById("editTask").focus(),100);
};
window.closeEditModal=function(){
  document.getElementById("editModal").style.display="none"; editId=null;
};
window.closeEditIfOutside=function(e){
  if(e.target===document.getElementById("editModal")) closeEditModal();
};
window.saveEdit=async function(){
  if(!isAdmin) return;
  const title=document.getElementById("editTask").value.trim();
  const days=parseInt(document.getElementById("editDays").value)||0;
  const repeat=getRepeatValue("editRepeat","editCustomDays");
  if(!title){showToast("Empty task","error");return;}
  const due=new Date(); due.setHours(0,0,0,0); due.setDate(due.getDate()+days);
  const btn=document.querySelector(".modal-save");
  btn.textContent="Saving…"; btn.disabled=true;
  const newAssignee = document.getElementById("editAssignTo")?.value;
  try{
    const payload = {title, dueDate:due, priority:editPri, repeat};
    if (newAssignee) payload.assignedTo = newAssignee;
    await updateDoc(doc(db,"tasks",editId), payload);
    showToast("Updated ✓","success");
    closeEditModal();
    await loadTasks(true);
  }catch(e){showToast("Error","error");}
  btn.textContent="Save Changes"; btn.disabled=false;
};

window.openDeleteModal=function(id){
  if(!isAdmin) return;
  delId=id; document.getElementById("deleteModal").style.display="flex";
};
window.closeDeleteModal=function(){
  document.getElementById("deleteModal").style.display="none"; delId=null;
};
window.confirmDelete=async function(){
  if(!isAdmin||!delId) return;
  try{
    await deleteDoc(doc(db,"tasks",delId));
    closeDeleteModal(); showToast("Deleted","");
    await loadTasks(true);
  }catch(e){showToast("Error","error");}
};

window.exportTasks=function(){
  if(!isAdmin) return;
  const dt=urgentView?allTasks:allTasks.filter(t=>t.department===currentDept);
  if(!dt.length){showToast("No tasks","error");return;}
  const rows=[["Employee","Dept","Task","Priority","Status","Due","Repeat"]];
  dt.forEach(t=>{
    rows.push([t.assignedTo,t.department||"",t.title,
      priLabel[t.priority]||"",t.status,
      safeDate(t.dueDate).toLocaleDateString(),t.repeat||"none"]);
  });
  const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
  const a=document.createElement("a");
  a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
  a.download=`TaskFlow_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast("Exported ✓","success");
};

// ── Helpers ────────────────────────────────────────
function bucket(tasks){
  const s={overdue:[],today:[],tomorrow:[],upcoming:[],completed:[]};
  tasks.forEach(t=>{
    if(t.status==="completed"){s.completed.push(t);return;}
    const d=diffDays(t);
    if(d<0)s.overdue.push(t);
    else if(d===0)s.today.push(t);
    else if(d===1)s.tomorrow.push(t);
    else s.upcoming.push(t);
  });
  return s;
}
function sortByPriority(tasks){
  const po={p1:1,p2:2,p3:3,p4:4};
  return [...tasks].sort((a,b)=>po[a.priority]-po[b.priority]);
}
function safeDate(v){
  if(!v) return new Date();
  if(typeof v.toDate==="function") return v.toDate();
  return new Date(v);
}
function diffDays(t){
  const due=safeDate(t.dueDate);
  const now=new Date(); now.setHours(0,0,0,0);
  return Math.ceil((due-now)/86400000);
}
function cardClass(diff,done){
  if(done) return "card-done";
  if(diff<0) return "card-overdue";
  if(diff===0) return "card-today";
  if(diff===1) return "card-tomorrow";
  return "card-upcoming";
}
function dueChip(diff,done){
  if(done) return {cls:"due-done",txt:"✓ Done"};
  if(diff<0) return {cls:"due-over", txt:`⚠ ${Math.abs(diff)}d overdue`};
  if(diff===0) return {cls:"due-today",txt:"Due Today"};
  if(diff===1) return {cls:"due-soon", txt:"Tomorrow"};
  const d=new Date(); d.setDate(d.getDate()+diff);
  return {cls:"due-ok",txt:d.toLocaleDateString("en-IN",{day:"numeric",month:"short"})};
}
function repeatText(r){
  if(r==="daily")  return "↻ Daily";
  if(r==="weekly") return "↻ Weekly";
  const n=parseInt(r); if(!isNaN(n)) return `↻ Every ${n} days`;
  return "";
}
function repeatLabel(r){
  const t=repeatText(r);
  return t?`<span class="stc-repeat">${t}</span>`:"";
}
function showToast(msg,type=""){
  toastEl.textContent=msg;
  toastEl.className="toast show "+(type||"");
  setTimeout(()=>toastEl.className="toast",2800);
}

// ── FAB: Add Task (all staff) ──────────────────────────────────────────────
let fabPri = "p4";

window.openFabModal = function() {
  fabPri = "p4";
  ["fp1","fp2","fp3","fp4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  document.getElementById("fp4")?.classList.add("selected");
  document.getElementById("fabTaskTitle").value = "";
  document.getElementById("fabDays").value = "0";
  document.getElementById("fabRepeat") && (document.getElementById("fabRepeat").value = "none");
  document.getElementById("fabCustomDaysWrap") && (document.getElementById("fabCustomDaysWrap").style.display = "none");

  // Admin sees assign-to + repeat; staff sees their own name only
  const adminExtra = document.getElementById("fabAdminExtra");
  if (isAdmin) {
    adminExtra.style.display = "block";
    const sel = document.getElementById("fabAdminAssign");
    sel.innerHTML = allStaff.map(e => `<option value="${e}">${e}</option>`).join("");
  } else {
    adminExtra.style.display = "none";
  }

  document.getElementById("staffAddModal").style.display = "flex";
  setTimeout(() => document.getElementById("fabTaskTitle").focus(), 100);
};

window.closeFabModal = function() {
  document.getElementById("staffAddModal").style.display = "none";
};

window.closeFabIfOutside = function(e) {
  if (e.target === document.getElementById("staffAddModal")) closeFabModal();
};

window.setFabPri = function(p) {
  fabPri = p;
  ["fp1","fp2","fp3","fp4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  document.getElementById("f"+p)?.classList.add("selected");
};

window.onFabRepeatChange = function(sel) {
  document.getElementById("fabCustomDaysWrap").style.display = sel.value === "custom" ? "flex" : "none";
};

window.submitFabTask = async function() {
  const title = document.getElementById("fabTaskTitle").value.trim();
  if (!title) { showToast("Enter a task", "error"); return; }

  const days = parseInt(document.getElementById("fabDays").value) || 0;
  const due  = new Date(); due.setHours(0,0,0,0); due.setDate(due.getDate() + days);

  let assignedTo, department, repeat = "none";
  if (isAdmin) {
    assignedTo = document.getElementById("fabAdminAssign").value;
    // derive dept from current tab
    department = urgentView ? "child" : currentDept;
    const repeatSel = document.getElementById("fabRepeat").value;
    if (repeatSel === "custom") {
      repeat = document.getElementById("fabCustomDays").value || "none";
    } else {
      repeat = repeatSel;
    }
  } else {
    assignedTo = currentUser;
    // pick first dept this user belongs to
    department = Object.entries(employeesMap).find(([,arr]) => arr.includes(currentUser))?.[0] || "child";
  }

  const btn = document.getElementById("fabSaveBtn");
  btn.textContent = "…"; btn.disabled = true;
  try {
    await addDoc(collection(db,"tasks"), {
      title, assignedTo, department,
      dueDate: due, priority: fabPri,
      repeat, status: "pending", createdAt: new Date()
    });
    closeFabModal();
    showToast("Task added ✓", "success");
    await loadTasks(true);
  } catch(e) { showToast("Error saving", "error"); }
  btn.textContent = "Add Task"; btn.disabled = false;
};

// ══════════════════════════════════════════════════════════════════════════════
// TASK CHAT SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

// ── Live message-count listeners ──────────────────────────────────────────
function loadMessageCounts() {
  messageCountUnsubs.forEach(fn => fn());
  messageCountUnsubs = [];
  allTasks.forEach(task => {
    const unsub = onSnapshot(
      collection(db, "tasks", task.id, "messages"),
      snap => {
        const unread = snap.docs.filter(d => d.data().sender !== currentUser).length;
        messageCounts[task.id] = unread;
        updateBadge(task.id, unread);
      },
      () => {}
    );
    messageCountUnsubs.push(unsub);
  });
}

function updateAllChatBadges() {
  Object.entries(messageCounts).forEach(([id, count]) => updateBadge(id, count));
}
function updateBadge(taskId, count) {
  document.querySelectorAll("[id='cb-" + taskId + "']").forEach(badge => {
    if (count > 0) { badge.textContent = count > 9 ? "9+" : count; badge.style.display = "flex"; }
    else { badge.style.display = "none"; }
  });
}

// ── Open chat overlay for a task ──────────────────────────────────────────
window.openChat = function(taskId) {
  // Look up task details from allTasks
  const task = allTasks.find(t => t.id === taskId) || {};
  const taskTitle  = task.title    || "Task";
  const assignedTo = task.assignedTo || "";

  // Clean up any previous listener
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }

  const overlay = document.getElementById("chatOverlay");
  document.getElementById("chatTaskTitle").textContent = taskTitle;
  document.getElementById("chatAssignedTo").textContent = assignedTo ? "Assigned to: " + assignedTo : "";
  document.getElementById("chatMessages").innerHTML = `<div class="chat-loading">Loading…</div>`;
  document.getElementById("chatInput").value = "";
  document.getElementById("chatSendBtn").dataset.taskId = taskId;
  overlay.style.display = "flex";
  overlay.dataset.taskId = taskId;

  // Real-time listener
  const msgsRef = query(
    collection(db, "tasks", taskId, "messages"),
    orderBy("createdAt", "asc")
  );

  activeChatUnsub = onSnapshot(msgsRef, snap => {
    const msgs = snap.docs.map(d => ({id: d.id, ...d.data()}));
    renderChatMessages(msgs);
    // update badge count
    messageCounts[taskId] = msgs.length;
    const badge = document.getElementById("cb-" + taskId);
    if (badge) {
      badge.textContent = msgs.length > 9 ? "9+" : msgs.length;
      badge.style.display = msgs.length > 0 ? "flex" : "none";
    }
  }, err => {
    console.error("Chat listener:", err);
  });

  setTimeout(() => document.getElementById("chatInput").focus(), 200);
};

function renderChatMessages(msgs) {
  const container = document.getElementById("chatMessages");
  if (!msgs.length) {
    container.innerHTML = `<div class="chat-empty">
      <div class="chat-empty-icon">💬</div>
      <div class="chat-empty-text">No messages yet.<br>Start the conversation!</div>
    </div>`;
    return;
  }

  let lastDate = "";
  container.innerHTML = msgs.map(m => {
    const isMine = m.sender === currentUser;
    const ts     = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
    const dateStr = ts.toLocaleDateString("en-IN", {day:"numeric", month:"short"});
    const timeStr = ts.toLocaleTimeString("en-IN", {hour:"2-digit", minute:"2-digit", hour12:true});
    const isAdmin = m.sender === ADMIN;

    let dateDivider = "";
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      dateDivider = `<div class="chat-date-divider"><span>${dateStr}</span></div>`;
    }

    const initials = m.sender.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const idx      = allStaff.indexOf(m.sender);
    const color    = avatarColors[idx >= 0 ? idx % avatarColors.length : 0];

    return `${dateDivider}
    <div class="chat-msg ${isMine ? "chat-mine" : "chat-theirs"}">
      ${!isMine ? `<div class="chat-av" style="background:${color}">${initials}</div>` : ""}
      <div class="chat-bubble-wrap">
        ${!isMine ? `<div class="chat-sender${isAdmin ? " chat-sender-admin" : ""}">${m.sender}${isAdmin ? " 👑" : ""}</div>` : ""}
        <div class="chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}">
          ${escHtml(m.text)}
        </div>
        <div class="chat-time ${isMine ? "chat-time-mine" : ""}">${timeStr}</div>
      </div>
    </div>`;
  }).join("");

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function escHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
}

window.closeChat = function() {
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
  document.getElementById("chatOverlay").style.display = "none";
};

window.closeChatIfOutside = function(e) {
  if (e.target === document.getElementById("chatOverlay")) closeChat();
};

window.sendChatMessage = async function() {
  const input  = document.getElementById("chatInput");
  const text   = input.value.trim();
  const taskId = document.getElementById("chatSendBtn").dataset.taskId;
  if (!text || !taskId) return;

  const btn = document.getElementById("chatSendBtn");
  btn.disabled = true;
  input.value = "";

  try {
    await addDoc(collection(db, "tasks", taskId, "messages"), {
      text,
      sender:    currentUser,
      createdAt: new Date()
    });
    // listener will auto-update UI
  } catch(e) {
    showToast("Could not send message", "error");
    input.value = text; // restore on failure
  }
  btn.disabled = false;
  input.focus();
};

// Send on Enter (Shift+Enter = newline)
window.chatKeydown = function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR TAB — shown only when 📅 Calendar tab is selected
// Employee tabs (Child / Oral / CI / Urgent) are completely unchanged
// ══════════════════════════════════════════════════════════════════════════════

const CAL_ICS_URL = "https://calendar.google.com/calendar/ical/ddchkar%40gmail.com/private-19359ce714835865f9f0c05ffeaf3339/basic.ics";

// Fetch ICS through a CORS proxy; tries multiple proxies in order
async function fetchICS() {
  const proxies = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  let lastErr;
  for (const proxyFn of proxies) {
    try {
      const res = await fetch(proxyFn(CAL_ICS_URL));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Not a valid ICS response");
      return text;
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error("All proxies failed");
}

let calView = false;  // true when calendar tab is active

window.selectCalendarView = function() {
  // Mark tab active (admin dept tabs)
  document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
  document.querySelector("[data-dept='calendar']")?.classList.add("active");

  _showCalendarUI();
};

// Shared helper: show calendar UI for both admin and staff
// Calendar renders INLINE — stats strip, add-bar, and dept tabs all stay visible.
// Only the task list (dashboard) is swapped out for the calendar panel.
function _showCalendarUI() {
  // Swap dashboard out, keep everything else (stats, add-bar, tabs, staff strip)
  document.getElementById("dashboard").style.display     = "none";
  document.getElementById("calendarPanel").style.display = "block";
  // Hide FAB — calendar has its own schedule button
  const fab1 = document.getElementById("fabAddBtn");
  if (fab1) fab1.style.display = "none";

  // Update bottom nav
  document.getElementById("bnavHome")?.classList.remove("active");
  document.getElementById("bnavCalendar")?.classList.add("active");

  calView = true;
  renderCalendarPanel();
}

// Universal tab switchers for bottom nav
window.switchToCalendarTab = function() {
  if (isAdmin) {
    // Use existing admin tab logic
    document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
    document.querySelector("[data-dept='calendar']")?.classList.add("active");
  }
  _showCalendarUI();
};

window.switchToHomeTab = function() {
  _hideCalendar();
  // Update bottom nav
  document.getElementById("bnavHome")?.classList.add("active");
  document.getElementById("bnavCalendar")?.classList.remove("active");
  // For admin: re-show the right tab
  if (isAdmin) {
    document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
    if (urgentView) {
      document.querySelector("[data-dept='urgent-view']")?.classList.add("active");
    } else {
      document.querySelector(`[data-dept='${currentDept}']`)?.classList.add("active");
    }
  }
};

// Hook existing dept-switching functions to hide calendar panel & restore dashboard
const _origSelectDept   = window.selectDepartment;
const _origSelectUrgent = window.selectUrgentView;

window.selectDepartment = function(d) {
  _hideCalendar();
  _origSelectDept(d);
};
window.selectUrgentView = function() {
  _hideCalendar();
  _origSelectUrgent();
};

function _hideCalendar() {
  calView = false;
  document.getElementById("calendarPanel").style.display = "none";
  document.getElementById("dashboard").style.display     = "";
  // Restore FAB
  const fab2 = document.getElementById("fabAddBtn");
  if (fab2) fab2.style.display = "grid";
  // Bottom nav state
  document.getElementById("bnavHome")?.classList.add("active");
  document.getElementById("bnavCalendar")?.classList.remove("active");
}

// ── Current calendar sub-tab: 'plan' or 'events' ─────
let calSubTab = 'plan';   // default to Plan Day for admin, Events for staff

window.renderCalendarPanel = async function() {
  const panel = document.getElementById("calendarPanel");
  // Staff see Today's Plan first; admin defaults to plan
  if (!isAdmin) calSubTab = 'plan';
  _renderCalTabs(panel);
  if (calSubTab === 'plan') {
    if (isAdmin) { renderPlanDay(panel); } else { renderStaffPlanDay(panel); }
  } else {
    panel.querySelector('#calEventsPane').innerHTML =
      `<div class="cal-state"><div class="spinner"></div><p>Loading…</p></div>`;
    try {
      const text = await fetchICS();
      buildCalendarHTML(panel.querySelector('#calEventsPane'), parseICS(text));
    } catch(e) {
      panel.querySelector('#calEventsPane').innerHTML =
        `<div class="cal-state cal-error">
          <div style="font-size:30px;margin-bottom:8px">⚠️</div>
          <div style="font-weight:800;margin-bottom:4px">Could not load calendar</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:14px">${e.message}</div>
          <button onclick="renderCalendarPanel()" style="padding:9px 20px;background:#0d9488;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">↻ Retry</button>
        </div>`;
    }
  }
};

function _renderCalTabs(panel) {
  panel.innerHTML = `
    <div class="cal-subtabs">
      <button class="cal-subtab${calSubTab==='plan'?' active':''}" onclick="switchCalSubTab('plan')">📋 Plan Day</button>
      <button class="cal-subtab${calSubTab==='events'?' active':''}" onclick="switchCalSubTab('events')">📅 Events</button>
    </div>
    <div id="calPlanPane"   style="display:${calSubTab==='plan'?'block':'none'}"></div>
    <div id="calEventsPane" style="display:${calSubTab==='events'?'block':'none'}"></div>`;
}

window.switchCalSubTab = function(tab) {
  calSubTab = tab;
  renderCalendarPanel();
};

// ── PLAN DAY ─────────────────────────────────────────────────────────────────
// Shows overdue + urgent + today tasks grouped by employee.
// Admin can assign a time slot to each task (saved to Firestore as task.slot).

const SLOTS = [];
for (let h = 8; h <= 18; h++) {
  SLOTS.push(`${String(h).padStart(2,'0')}:00`);
  if (h < 18) SLOTS.push(`${String(h).padStart(2,'0')}:30`);
}

async function renderPlanDay(panel) {
  const pane = panel.querySelector('#calPlanPane');
  if (!pane) return;

  // If tasks haven't loaded yet, wait and retry
  if (!allTasks.length) {
    pane.innerHTML = `<div class="cal-state"><div class="spinner"></div><p>Loading tasks…</p></div>`;
    try {
      const snap = await getDocs(collection(db, 'tasks'));
      allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
      pane.innerHTML = `<div class="cal-state cal-error"><p>Could not load tasks.<br><button onclick="renderCalendarPanel()" style="margin-top:10px;padding:8px 18px;background:#0d9488;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Retry</button></p></div>`;
      return;
    }
  }

  const now = new Date(); now.setHours(0,0,0,0);

  // ALL pending tasks (not completed) — admin needs full picture
  const pending = allTasks.filter(t => t.status !== 'completed');

  // Priority buckets for summary
  const totalOverdue = pending.filter(t => diffDays(t) < 0).length;
  const totalToday   = pending.filter(t => diffDays(t) === 0).length;
  const totalUrgent  = pending.filter(t => t.priority === 'p1').length;
  const slotted      = pending.filter(t => t.slot).length;

  // Build per-employee map using allStaff order (guarantees all employees show)
  const byEmp = {};
  allStaff.forEach(e => { byEmp[e] = []; });
  pending.forEach(t => {
    const emp = t.assignedTo;
    if (emp && byEmp[emp] !== undefined) byEmp[emp].push(t);
  });

  const slotOpts = SLOTS.map(s => `<option value="${s}">${_fmt12(s)}</option>`).join('');

  let html = `
    <div class="plan-header">
      <div class="plan-title">📋 Daily Briefing</div>
      <div class="plan-date">${now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</div>
    </div>
    <div class="plan-summary-row">
      <div class="plan-pill plan-pill-over"><span>${totalOverdue}</span>Overdue</div>
      <div class="plan-pill plan-pill-today"><span>${totalToday}</span>Today</div>
      <div class="plan-pill plan-pill-urg"><span>${totalUrgent}</span>Urgent</div>
      <div class="plan-pill plan-pill-slot"><span>${slotted}</span>Slotted</div>
    </div>`;

  // ── Timeline: already-slotted tasks ────────────────
  const slottedTasks = pending.filter(t => t.slot).sort((a,b) => a.slot.localeCompare(b.slot));
  if (slottedTasks.length) {
    html += `<div class="plan-section-lbl">🕐 Today's Schedule</div><div class="plan-timeline">`;
    slottedTasks.forEach(t => {
      const emp   = t.assignedTo || '—';
      const idx   = allStaff.indexOf(emp);
      const color = avatarColors[idx >= 0 ? idx % avatarColors.length : 0];
      const init  = emp.split(' ').filter(w=>w).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      const priColors = {p1:'#ef4444',p2:'#f97316',p3:'#3b82f6',p4:'#94a3b8'};
      html += `<div class="plan-tl-row">
        <div class="plan-tl-time">${_fmt12(t.slot)}</div>
        <div class="plan-tl-bar" style="border-left-color:${priColors[t.priority||'p4']}">
          <div class="plan-tl-av" style="background:${color}">${init}</div>
          <div class="plan-tl-info">
            <div class="plan-tl-task">${t.title}</div>
            <div class="plan-tl-emp">${emp}</div>
          </div>
          <button class="plan-tl-clear" onclick="clearSlot('${t.id}')" title="Remove slot">✕</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── Per-employee cards ──────────────────────────────
  html += `<div class="plan-section-lbl">👥 Assign Time Slots</div>`;

  // Show employees that have tasks first, then empty ones collapsed
  const withTasks    = Object.entries(byEmp).filter(([,t]) => t.length > 0);
  const withoutTasks = Object.entries(byEmp).filter(([,t]) => t.length === 0);

  const renderEmpCard = ([emp, tasks]) => {
    const idx   = allStaff.indexOf(emp);
    const color = avatarColors[idx >= 0 ? idx % avatarColors.length : 0];
    const init  = emp.split(' ').filter(w=>w).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const overdue = tasks.filter(t => diffDays(t) < 0).length;
    const urgent  = tasks.filter(t => t.priority === 'p1').length;
    const todayN  = tasks.filter(t => diffDays(t) === 0).length;

    let rows = '';
    // Sort: slotted by time first, then by urgency
    const sorted = [...tasks].sort((a,b)=>{
      if(a.slot&&b.slot) return a.slot.localeCompare(b.slot);
      if(a.slot) return -1; if(b.slot) return 1;
      const sA=(diffDays(a)<0?0:diffDays(a)===0?1:2)*10+({p1:0,p2:1,p3:2,p4:3}[a.priority]||3);
      const sB=(diffDays(b)<0?0:diffDays(b)===0?1:2)*10+({p1:0,p2:1,p3:2,p4:3}[b.priority]||3);
      return sA-sB;
    });

    sorted.forEach(t => {
      const d = diffDays(t);
      const dueStr = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d}d`;
      const dueCls = d < 0 ? 'over' : d === 0 ? 'today' : 'soon';
      const priDot = {p1:'#ef4444',p2:'#f97316',p3:'#3b82f6',p4:'#94a3b8'}[t.priority||'p4'];
      const hasSlot = !!t.slot;
      rows += `<div class="plan-task-row${hasSlot?' plan-task-slotted':''}">
        <div class="plan-task-pri" style="background:${priDot}"></div>
        <div class="plan-task-info">
          <div class="plan-task-title">${t.title}</div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:2px">
            <span class="plan-task-due plan-due-${dueCls}">${dueStr}</span>
            ${hasSlot ? `<span class="plan-slot-chip">&#128336; ${_fmt12(t.slot)}</span>` : ''}
          </div>
        </div>
        <div class="plan-task-slot-wrap">
          <select class="plan-slot-sel" onchange="assignSlot('${t.id}',this.value)">
            <option value="">${hasSlot ? '✓ '+_fmt12(t.slot) : '+ Time'}</option>
            ${slotOpts}
          </select>
        </div>
      </div>`;
    });

    if (!tasks.length) {
      rows = `<div class="plan-task-row" style="color:#94a3b8;font-size:12px;font-weight:600;justify-content:center">✅ No pending tasks</div>`;
    }

    return `<div class="plan-emp-card">
      <div class="plan-emp-head">
        <div class="plan-emp-av" style="background:${color}">${init}</div>
        <div class="plan-emp-name">${emp}</div>
        <div class="plan-emp-tags">
          ${overdue ? `<span class="plan-tag plan-tag-over">${overdue} overdue</span>` : ''}
          ${todayN  ? `<span class="plan-tag plan-tag-today">${todayN} today</span>`   : ''}
          ${urgent  ? `<span class="plan-tag plan-tag-urg">${urgent} urgent</span>`    : ''}
          ${!tasks.length ? `<span class="plan-tag" style="background:#f0fdf4;color:#059669">All clear</span>` : ''}
        </div>
      </div>
      ${rows}
    </div>`;
  };

  withTasks.forEach(e => { html += renderEmpCard(e); });

  if (withoutTasks.length) {
    html += `<details class="plan-clear-section">
      <summary>✅ No pending tasks (${withoutTasks.length} staff)</summary>`;
    withoutTasks.forEach(e => { html += renderEmpCard(e); });
    html += `</details>`;
  }

  pane.innerHTML = html;
}

// ── Staff: admin's planned schedule for today ─────────────────────────────────
function renderStaffPlanDay(panel) {
  const pane = panel.querySelector('#calPlanPane');
  if (!pane) return;
  const now = new Date(); now.setHours(0,0,0,0);
  const myTasks = allTasks.filter(t => t.assignedTo === currentUser && t.status !== 'completed');
  const slotted   = myTasks.filter(t => t.slot).sort((a,b) => a.slot.localeCompare(b.slot));
  const unslotted = myTasks.filter(t => !t.slot).sort((a,b) => {
    const sA=(diffDays(a)<0?0:diffDays(a)===0?1:2)*10+({p1:0,p2:1,p3:2,p4:3}[a.priority]||3);
    const sB=(diffDays(b)<0?0:diffDays(b)===0?1:2)*10+({p1:0,p2:1,p3:2,p4:3}[b.priority]||3);
    return sA-sB;
  });
  const priColors={p1:'#ef4444',p2:'#f97316',p3:'#3b82f6',p4:'#94a3b8'};
  const priLabels={p1:'Urgent',p2:'High',p3:'Normal',p4:'Low'};
  let html=`<div class="plan-header"><div class="plan-title">Your Plan for Today</div><div class="plan-date">${now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</div></div>`;
  if (slotted.length) {
    html+='<div class="plan-section-lbl">Scheduled by Admin — follow this order</div><div class="plan-timeline">';
    slotted.forEach(t=>{
      const d=diffDays(t);
      const dueStr=d<0?Math.abs(d)+'d overdue':d===0?'Today':'In '+d+'d';
      const dueCl=d<0?'#ef4444':d===0?'#f59e0b':'#94a3b8';
      const priCol=priColors[t.priority||'p4'];
      html+=`<div class="plan-tl-row"><div class="plan-tl-time">${_fmt12(t.slot)}</div><div class="plan-tl-bar" style="border-left-color:${priCol}"><div class="plan-tl-info" style="flex:1"><div class="plan-tl-task">${t.title}</div><div style="display:flex;gap:6px;margin-top:3px;align-items:center"><span style="font-size:9px;font-weight:800;background:${priCol}20;color:${priCol};padding:1px 6px;border-radius:8px">${priLabels[t.priority||'p4']}</span><span style="font-size:10px;color:${dueCl};font-weight:700">${dueStr}</span></div></div></div></div>`;
    });
    html+='</div>';
  } else {
    html+='<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;font-weight:700;color:#92400e;margin-bottom:14px">Admin has not scheduled any tasks yet. Check back later.</div>';
  }
  if (unslotted.length) {
    html+='<div class="plan-section-lbl">Other pending tasks (no time assigned yet)</div>';
    unslotted.forEach(t=>{
      const d=diffDays(t);
      const dueStr=d<0?Math.abs(d)+'d overdue':d===0?'Today':d===1?'Tomorrow':'In '+d+'d';
      const dueCls=d<0?'over':d===0?'today':'soon';
      const priCol=priColors[t.priority||'p4'];
      html+=`<div class="plan-task-row"><div class="plan-task-pri" style="background:${priCol}"></div><div class="plan-task-info"><div class="plan-task-title">${t.title}</div><span class="plan-task-due plan-due-${dueCls}">${dueStr}</span></div></div>`;
    });
  }
  if (!slotted.length && !unslotted.length) {
    html+='<div class="empty-state"><div class="empty-icon">&#127881;</div><h3>All done!</h3><p>No tasks assigned right now.</p></div>';
  }
  pane.innerHTML=html;
}


window.assignSlot = async function(taskId, slot) {
  if (!slot) return;
  try {
    await updateDoc(doc(db, 'tasks', taskId), { slot });
    showToast(`Slot set: ${_fmt12(slot)} ✓`, 'success');
    renderPlanDay(document.getElementById('calendarPanel'));
  } catch(e) { showToast('Could not save slot', 'error'); }
};

window.clearSlot = async function(taskId) {
  try {
    await updateDoc(doc(db, 'tasks', taskId), { slot: '' });
    showToast('Slot cleared', '');
    renderPlanDay(document.getElementById('calendarPanel'));
  } catch(e) { showToast('Error', 'error'); }
};

// ── EVENTS TAB ────────────────────────────────────────────────────────────────
function buildCalendarHTML(pane, events) {
  const now      = new Date(); now.setHours(0,0,0,0);
  const upcoming = events.filter(e => e.start >= now);
  const past     = events.filter(e => e.start <  now).reverse().slice(0, 15);

  const todayKey = _dateKey(now);
  const tmrw     = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
  const tmrwKey  = _dateKey(tmrw);

  const groups = {};
  upcoming.forEach(e => {
    const k = _dateKey(e.start);
    if (!groups[k]) groups[k] = { label: _dateLabel(e.start), evs: [], date: e.start };
    groups[k].evs.push(e);
  });

  const todayCount = (groups[todayKey]?.evs || []).length;

  let html = `
    <div class="cal-today-banner" style="margin-bottom:14px">
      <span class="cal-today-icon">📌</span>
      <span>${todayCount ? todayCount + ' event' + (todayCount>1?'s':'') + ' today' : 'Nothing scheduled today'}</span>
    </div>`;

  if (!upcoming.length) {
    html += `<div class="cal-empty">🎉 No upcoming events</div>`;
  } else {
    Object.entries(groups).forEach(([key, g]) => {
      const isToday = key === todayKey;
      const isTmrw  = key === tmrwKey;
      const daysAhead = Math.round((g.date - now) / 86400000);
      html += `<div class="cal-day${isToday?' cal-day-today':''}">
        <div class="cal-day-lbl" style="display:flex;align-items:center;justify-content:space-between">
          <span>${isToday?'📍 Today — ':isTmrw?'⏭ Tomorrow — ':''}${g.label}</span>
          <button class="cal-add-day-btn" onclick="openFabModalForDate(${daysAhead})">＋ Task</button>
        </div>`;
      g.evs.forEach(ev => { html += _eventCard(ev); });
      html += `</div>`;
    });
  }

  if (past.length) {
    html += `<details class="cal-past"><summary>🕘 Recent past events (${past.length})</summary>`;
    past.forEach(ev => { html += _eventCard(ev, true); });
    html += `</details>`;
  }

  pane.innerHTML = html;
}

// Open FAB modal with a specific due-date pre-selected
window.openFabModalForDate = function(daysAhead) {
  openFabModal();
  const presets = [0, 1, 2, 3, 5, 7];
  const best = presets.reduce((a, b) => Math.abs(b - daysAhead) < Math.abs(a - daysAhead) ? b : a, 0);
  const fabDays = document.getElementById("fabDays");
  if (fabDays) fabDays.value = String(best);
};

function _eventCard(ev, isPast = false) {
  const allDay = ev.start.getHours() === 0 && ev.start.getMinutes() === 0 &&
                 (!ev.end || (ev.end.getHours() === 0 && ev.end.getMinutes() === 0));
  const time   = allDay ? "All day"
    : ev.start.toLocaleTimeString("en-IN", {hour:"2-digit", minute:"2-digit", hour12:true})
      + (ev.end ? " – " + ev.end.toLocaleTimeString("en-IN", {hour:"2-digit", minute:"2-digit", hour12:true}) : "");
  return `<div class="cal-event${isPast ? " cal-event-past" : ""}">
    <div class="cal-event-time">${time}</div>
    <div class="cal-event-title">${ev.title || "(No title)"}</div>
    ${ev.location ? `<div class="cal-event-loc">📍 ${ev.location}</div>` : ""}
  </div>`;
}

function _dateKey(d)   { return d.toISOString().slice(0, 10); }
function _dateLabel(d) {
  return d.toLocaleDateString("en-IN", {weekday:"long", day:"numeric", month:"long", year:"numeric"});
}

// ── ICS parser ────────────────────────────────────
function parseICS(text) {
  const events = [];
  const lines  = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let ev = null;
  lines.forEach(line => {
    if (line === "BEGIN:VEVENT") { ev = {}; return; }
    if (line === "END:VEVENT")   { if (ev) events.push(ev); ev = null; return; }
    if (!ev) return;
    const col = line.indexOf(":");
    if (col === -1) return;
    const semi   = line.indexOf(";");
    const rawKey = (semi !== -1 && semi < col) ? line.slice(0, semi) : line.slice(0, col);
    const val    = line.slice(col + 1).trim();
    const key    = rawKey.toUpperCase();
    if (key === "SUMMARY")  ev.title    = val.replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";");
    if (key === "DTSTART")  ev.start    = _parseDate(val);
    if (key === "DTEND")    ev.end      = _parseDate(val);
    if (key === "LOCATION") ev.location = val.replace(/\\,/g,",");
  });
  return events.filter(e => e.start).sort((a, b) => a.start - b.start);
}

function _parseDate(v) {
  v = v.replace("Z", "");
  if (v.length === 8)
    return new Date(+v.slice(0,4), +v.slice(4,6)-1, +v.slice(6,8));
  return new Date(+v.slice(0,4), +v.slice(4,6)-1, +v.slice(6,8),
                  +v.slice(9,11), +v.slice(11,13), +v.slice(13,15));
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN CALENDAR PREVIEW (read-only, no task scheduling)
// ══════════════════════════════════════════════════════════════════════════════
window.showLoginCalendar = async function(e) {
  e.preventDefault();
  const overlay = document.getElementById("loginCalOverlay");
  const panel   = document.getElementById("loginCalPanel");
  overlay.style.display = "block";
  panel.innerHTML = `<div class="cal-state"><div class="spinner"></div><p>Loading calendar…</p></div>`;

  try {
    const text = await fetchICS();
    const events = parseICS(text);
    _buildLoginCalHTML(panel, events);
  } catch(err) {
    panel.innerHTML = `<div class="cal-state cal-error">
      <div style="font-size:30px;margin-bottom:8px">⚠️</div>
      <div style="font-weight:800;margin-bottom:4px">Could not load calendar</div>
      <div style="font-size:12px;color:#64748b">${err.message}</div>
    </div>`;
  }
};

function _buildLoginCalHTML(panel, events) {
  const now      = new Date(); now.setHours(0,0,0,0);
  const upcoming = events.filter(e => e.start >= now);
  const todayKey = _dateKey(now);
  const tmrw     = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
  const tmrwKey  = _dateKey(tmrw);

  const groups = {};
  upcoming.forEach(e => {
    const k = _dateKey(e.start);
    if (!groups[k]) groups[k] = { label: _dateLabel(e.start), evs: [] };
    groups[k].evs.push(e);
  });

  const todayCount = (groups[todayKey]?.evs || []).length;

  let html = `
    <div class="cal-today-banner" style="margin-bottom:14px">
      <span class="cal-today-icon">📌</span>
      <span>${todayCount ? todayCount + " event" + (todayCount > 1 ? "s" : "") + " today" : "Nothing scheduled today"}</span>
    </div>
    <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:700;color:#92400e;margin-bottom:14px;text-align:center">
      🔒 Sign in to schedule tasks on calendar dates
    </div>`;

  if (!upcoming.length) {
    html += `<div class="cal-empty">🎉 No upcoming events</div>`;
  } else {
    Object.entries(groups).forEach(([key, g]) => {
      const isToday = key === todayKey;
      const isTmrw  = key === tmrwKey;
      html += `<div class="cal-day${isToday ? " cal-day-today" : ""}">
        <div class="cal-day-lbl">${isToday ? "📍 Today — " : isTmrw ? "⏭ Tomorrow — " : ""}${g.label}</div>`;
      g.evs.forEach(ev => { html += _eventCard(ev); });
      html += `</div>`;
    });
  }
  panel.innerHTML = html;
}
// ══════════════════════════════════════════════════════════════════════════════
// ADD THESE FUNCTIONS TO THE END OF app.js
// ══════════════════════════════════════════════════════════════════════════════

// ── Documents tab ─────────────────────────────────────────────────────────────
window.switchToDocsTab = function () {
  // Hide other panels
  _hideCalendar();
  document.getElementById("dashboard").style.display    = "none";
  document.getElementById("homeCalendarPanel").style.display = "none";

  // Show docs panel
  document.getElementById("docsPanel").style.display    = "block";

  // Hide FAB (not needed in docs view)
  const fab = document.getElementById("fabAddBtn");
  if (fab) fab.style.display = "none";

  // Update bottom nav
  document.getElementById("bnavHome")?.classList.remove("active");
  document.getElementById("bnavCalendar")?.classList.remove("active");
  document.getElementById("bnavDocs")?.classList.add("active");

  // Admin dept tabs — deselect all
  if (isAdmin) {
    document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
  }

  // Init Drive (first time) and render
  if (window._initDrive) window._initDrive();
  if (window._renderDocsPanel) window._renderDocsPanel();
};

// ── Override switchToHomeTab to also hide docs panel ─────────────────────────
const _origSwitchHome = window.switchToHomeTab;
window.switchToHomeTab = function () {
  // Hide docs panel
  const docsPanel = document.getElementById("docsPanel");
  if (docsPanel) docsPanel.style.display = "none";

  // Show home calendar panel
  const hcp = document.getElementById("homeCalendarPanel");
  if (hcp) hcp.style.display = "block";

  // Update bottom nav
  document.getElementById("bnavDocs")?.classList.remove("active");
  document.getElementById("bnavCalendar")?.classList.remove("active");
  document.getElementById("bnavHome")?.classList.add("active");

  // Show FAB
  const fab = document.getElementById("fabAddBtn");
  if (fab) fab.style.display = "grid";

  // Restore dashboard and tasks
  if (typeof _origSwitchHome === "function") {
    _origSwitchHome();
  } else {
    calView = false;
    document.getElementById("calendarPanel").style.display = "none";
    document.getElementById("dashboard").style.display     = "";
    if (isAdmin) {
      document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
      if (urgentView) {
        document.querySelector("[data-dept='urgent-view']")?.classList.add("active");
      } else {
        document.querySelector(`[data-dept='${currentDept}']`)?.classList.add("active");
      }
    }
  }
};

// ── Override switchToCalendarTab to hide docs panel ───────────────────────────
const _origSwitchCal = window.switchToCalendarTab;
window.switchToCalendarTab = function () {
  const docsPanel = document.getElementById("docsPanel");
  if (docsPanel) docsPanel.style.display = "none";
  document.getElementById("bnavDocs")?.classList.remove("active");
  if (typeof _origSwitchCal === "function") _origSwitchCal();
};
