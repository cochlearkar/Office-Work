import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Config ─────────────────────────────────────────
const ADMIN = "Dr Basavaraj";

const employeesMap = {
  child: ["Dr Basavaraj","Dr Vanitha B","Mr Madhukar","Miss Sumayya","Miss Manjula"],
  oral:  ["Dr Basavaraj","Dr Harshitha","Nethra"],
  ci:    ["Dr Basavaraj","Dr Vanitha B","Mr Madhukar","Miss Sumayya","Miss Manjula"]
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

// ── DOM ────────────────────────────────────────────
const loginScreen  = document.getElementById("loginScreen");
const appScreen    = document.getElementById("appScreen");
const dashboard    = document.getElementById("dashboard");
const toastEl      = document.getElementById("toast");
const loginNames   = document.getElementById("loginNames");

// ── Boot: show login ────────────────────────────────
buildLoginScreen();

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
  const idx   = allStaff.indexOf(name);
  const color = avatarColors[idx % avatarColors.length];
  const initials = name.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();

  const btn = document.createElement("button");
  btn.className = "login-name-btn" + (admin ? " admin-btn" : "");
  btn.innerHTML = `
    <div class="ln-av" style="background:${color}">${initials}</div>
    <div class="ln-info">
      <div class="ln-name">${name}</div>
      <div class="ln-tag">${admin ? "Admin · All departments" : deptNames[dept]||""}</div>
    </div>`;
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

  loadTasks();
}

window.logout = function() {
  currentUser = null; isAdmin = false;
  appScreen.style.display   = "none";
  loginScreen.style.display = "flex";
};


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

  const pill = (n, lbl, ac, ab) => `<div class="fc-pill" style="background:${n>0?ab:"#f1f5f9"};color:${n>0?ac:"#94a3b8"}">
    <span class="fc-pnum">${n}</span><span class="fc-plbl">${lbl}</span></div>`;

  return `<div class="fc-banner" style="background:${bg};border-bottom:2px solid ${color}30">
    <div class="fc-left"><span class="fc-icon">${icon}</span><div class="fc-mood" style="color:${color}">${mood}</div></div>
    <div class="fc-pills">
      ${pill(overdue.length,"Overdue","#dc2626","#fef2f2")}
      ${pill(today.length,  "Today",  "#ea580c","#fff7ed")}
      ${pill(urgent.length, "Urgent", "#dc2626","#fef2f2")}
    </div>
  </div>`;
}

function buildTop3Urgent() {
  const top3 = allTasks
    .filter(t => t.priority === "p1" && t.status !== "completed")
    .sort((a, b) => safeDate(a.dueDate) - safeDate(b.dueDate))
    .slice(0, 3);
  if (!top3.length) return "";
  const rows = top3.map((t, i) => {
    const diff    = diffDays(t);
    const daysLbl = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Due today" : `Due in ${diff}d`;
    const chipCls = diff < 0 ? "up-chip-over" : diff === 0 ? "up-chip-today" : "up-chip-soon";
    return `<div class="up-row">
      <div class="up-rank">${i+1}</div>
      <div class="up-content">
        <div class="up-title">${t.title}</div>
        <div class="up-meta">
          <span class="up-who">👤 ${t.assignedTo||"—"}</span>
          <span class="up-chip ${chipCls}">${daysLbl}</span>
        </div>
      </div></div>`;
  }).join("");
  return `<div class="up-wrap">
    <div class="up-header">🔴 Top ${top3.length} Urgent</div>
    <div class="up-list">${rows}</div></div>`;
}

// ── Load tasks ─────────────────────────────────────
async function loadTasks(keepView = false) {
  try {
    const snap = await getDocs(collection(db,"tasks"));
    allTasks = snap.docs.map(d => ({id:d.id,...d.data()}));
  } catch(e) {
    console.error(e);
    showToast("Cannot reach database","error");
    allTasks = [];
  }

  if(isAdmin) {
    if(!keepView) {
      populateAssignSelect();
      selectDepartment(currentDept);
    } else {
      populateAssignSelect();
      if(urgentView) renderUrgentView();
      else renderAdminDashboard();
      updateAdminStats();
    }
  } else {
    renderStaffView();
  }
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

// ── STAFF VIEW ─────────────────────────────────────
function renderStaffView() {
  const myTasks = allTasks.filter(t => t.assignedTo === currentUser);
  const pending = myTasks.filter(t => t.status !== "completed");
  const pOver   = pending.filter(t => diffDays(t) < 0);
  const pToday  = pending.filter(t => diffDays(t) === 0);
  const done    = myTasks.filter(t => t.status === "completed");

  // Staff strip stats
  document.getElementById("staffStripInner").innerHTML = `
    <div class="sstrip-pill sp-pending">
      <div class="snum">${pending.length}</div><div class="slbl">Pending</div>
    </div>
    ${pOver.length ? `<div class="sstrip-pill" style="background:var(--red-l)">
      <div class="snum" style="color:var(--red)">${pOver.length}</div>
      <div class="slbl" style="color:#b91c1c">Overdue</div></div>` : ""}
    ${pToday.length ? `<div class="sstrip-pill" style="background:var(--amber-l)">
      <div class="snum" style="color:var(--amber)">${pToday.length}</div>
      <div class="slbl" style="color:#92400e">Due Today</div></div>` : ""}
    <div class="sstrip-pill sp-done">
      <div class="snum">${done.length}</div><div class="slbl">Done</div>
    </div>`;

  // Build HTML: forecast + top3 first
  let html = buildForecastBanner() + buildTop3Urgent();

  if (!pending.length && !done.length) {
    html += `<div class="empty-state">
      <div class="empty-icon">🎉</div><h3>All done!</h3>
      <p>No tasks assigned right now.</p></div>`;
    dashboard.innerHTML = html;
    return;
  }

  // ── "Your Tasks" name header ───────────────────────────
  const color    = avatarColors[allStaff.indexOf(currentUser) % avatarColors.length];
  const initials = currentUser.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
  html += `<div class="my-tasks-hdr">
    <div class="my-tasks-av" style="background:${color}">${initials}</div>
    <div>
      <div class="my-tasks-name">${currentUser}</div>
      <div class="my-tasks-sub">${pending.length} pending · ${done.length} done</div>
    </div>
  </div>`;

  // ── Section definitions ─────────────────────────────────
  const sections = [
    {
      key:"overdue",   icon:"⚠️",  label:"Overdue",
      accent:"#dc2626", bg:"#fff5f5", border:"#fca5a5",
      tasks: sortByPriority(pending.filter(t => diffDays(t) < 0)),
      due: t => `${Math.abs(diffDays(t))}d overdue`,
      dueCls: "tsr-badge-over"
    },
    {
      key:"today",     icon:"📋",  label:"Today's Tasks",
      accent:"#b45309", bg:"#fffbeb", border:"#fcd34d",
      tasks: sortByPriority(pending.filter(t => diffDays(t) === 0)),
      due: () => "Due today", dueCls: "tsr-badge-today"
    },
    {
      key:"tomorrow",  icon:"📅",  label:"Tomorrow's Tasks",
      accent:"#0369a1", bg:"#f0f9ff", border:"#7dd3fc",
      tasks: sortByPriority(pending.filter(t => diffDays(t) === 1)),
      due: () => "Tomorrow", dueCls: "tsr-badge-tmrw"
    },
    {
      key:"upcoming",  icon:"🗓",  label:"Upcoming",
      accent:"#059669", bg:"#f0fdf4", border:"#6ee7b7",
      tasks: sortByPriority(pending.filter(t => diffDays(t) > 1)),
      due: t => { const d=safeDate(t.dueDate); return d.toLocaleDateString("en-IN",{day:"numeric",month:"short"}); },
      dueCls: "tsr-badge-up"
    },
    {
      key:"completed", icon:"✅",  label:"Completed",
      accent:"#64748b", bg:"#f8fafc", border:"#e2e8f0",
      tasks: done,
      due: null, dueCls: ""
    }
  ];

  sections.forEach(sec => {
    if (!sec.tasks.length) return;
    const rows = sec.tasks.map(t => {
      const badge = sec.due ? `<span class="tsr-badge ${sec.dueCls}">${sec.due(t)}</span>` : "";
      const rep   = t.repeat && t.repeat!=="none"
        ? `<span class="tsr-repeat">${repeatText(t.repeat)}</span>` : "";
      const doneCls = t.status==="completed" ? " tsr-row-done" : "";
      return `<div class="tsr-row${doneCls}">
        <div class="tsr-dot" style="background:${sec.accent}"></div>
        <div class="tsr-title">${t.title}</div>
        <div class="tsr-right">${badge}${rep}</div>
      </div>`;
    }).join("");

    html += `<div class="ts-section" style="border:1.5px solid ${sec.border};border-radius:14px;margin:10px 12px 0;overflow:hidden">
      <div class="ts-head" style="background:${sec.bg};border-bottom:1.5px solid ${sec.border}">
        <span class="ts-head-icon">${sec.icon}</span>
        <span class="ts-head-label" style="color:${sec.accent}">${sec.label}</span>
        <span class="ts-head-count" style="background:${sec.border};color:${sec.accent}">${sec.tasks.length}</span>
      </div>
      <div class="ts-body">${rows}</div>
    </div>`;
  });

  html += '<div style="height:20px"></div>';
  dashboard.innerHTML = html;
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
