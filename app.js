import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── State ────────────────────────────────────────────
const employeesMap = {
  child: ["Dr Basavaraj", "Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"],
  oral:  ["Dr Basavaraj", "Dr Harshitha", "Nethra"],
  ci:    ["Dr Basavaraj", "Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"]
};

const deptNames   = { child:"Child Health", oral:"Oral Health", ci:"Cochlear Implant" };
const avatarColors = ["#6366f1","#ec4899","#14b8a6","#f59e0b","#8b5cf6","#ef4444","#0ea5e9"];

// Priority visuals – soft SVG-style flag icons via CSS+text
const priMeta = {
  p1: { label:"Urgent",  color:"#f87171", bg:"#fff1f1", icon:"🚩" },
  p2: { label:"High",    color:"#fb923c", bg:"#fff7ed", icon:"🔶" },
  p3: { label:"Normal",  color:"#60a5fa", bg:"#eff6ff", icon:"🔷" },
  p4: { label:"Low",     color:"#94a3b8", bg:"#f8fafc", icon:"⬜" }
};

let selectedDept     = "child";
let selectedEmployee = "";
let selectedPriority = "p4";
let editMode         = false;
let editId           = null;
let allTasks         = [];
let currentFilter    = "all";
let currentSort      = "priority";
let currentSearch    = "";
let listView         = false;
let deleteTargetId   = null;
let statsVisible     = false;
let collapsedCards   = new Set();

// ─── DOM refs ────────────────────────────────────────
const dashboard   = document.getElementById("dashboard");
const empDiv      = document.getElementById("employees");
const mainBtn     = document.getElementById("mainBtn");
const cancelBtn   = document.getElementById("cancelBtn");
const pageTitle   = document.getElementById("pageTitle");
const breadcrumb  = document.getElementById("breadcrumb");
const sidebarStat = document.getElementById("sidebarStats");
const statsBar    = document.getElementById("statsBar");
const toastEl     = document.getElementById("toast");

// ─── Boot: load Firebase data first, then render ──────
loadTasks();

// ─── Department ───────────────────────────────────────
window.selectDepartment = function(dept) {
  selectedDept    = dept;
  selectedEmployee = "";

  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.dept === dept)
  );
  pageTitle.textContent  = deptNames[dept];
  breadcrumb.textContent = "Select an employee to assign a task";

  renderEmpTabs();
  updateSidebarStats();
  renderDashboard();
};

function renderEmpTabs() {
  empDiv.innerHTML = "";
  employeesMap[selectedDept].forEach((emp, i) => {
    const cnt = allTasks.filter(t => t.assignedTo === emp && t.status !== "completed").length;
    const btn = document.createElement("button");
    btn.className    = "emp-tab";
    btn.dataset.emp  = emp;
    btn.innerHTML    = `${emp} <span class="task-count">${cnt}</span>`;
    btn.onclick = () => {
      selectedEmployee = emp;
      document.querySelectorAll(".emp-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      breadcrumb.textContent = `Assigning to: ${emp}`;
    };
    empDiv.appendChild(btn);
  });
}

function updateEmployeeTabs() {
  document.querySelectorAll(".emp-tab").forEach(btn => {
    const emp  = btn.dataset.emp;
    const cnt  = allTasks.filter(t => t.assignedTo === emp && t.status !== "completed").length;
    const el   = btn.querySelector(".task-count");
    if (el) el.textContent = cnt;
  });
}

// ─── Priority ─────────────────────────────────────────
window.selectPriority = function(p) {
  selectedPriority = p;
  document.querySelectorAll(".pri-btn").forEach(b => b.classList.remove("selected"));
  const el = document.getElementById(p);
  if (el) el.classList.add("selected");
};

// ─── Add / Update Task ────────────────────────────────
window.addTask = async function() {
  const task     = document.getElementById("task").value.trim();
  const repeat   = document.getElementById("repeat").value;
  const days     = parseInt(document.getElementById("days").value);
  const category = document.getElementById("category").value;
  const notes    = document.getElementById("notes").value.trim();

  if (!task)             { showToast("Please enter a task description", "error"); return; }
  if (!selectedEmployee) { showToast("Please select an employee first", "error"); return; }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  mainBtn.textContent = editMode ? "Updating…" : "Adding…";
  mainBtn.disabled    = true;

  try {
    if (editMode && editId) {
      await updateDoc(doc(db, "tasks", editId), {
        title:task, priority:selectedPriority, repeat,
        dueDate, department:selectedDept, assignedTo:selectedEmployee,
        category, notes
      });
      showToast("Task updated ✓", "success");
      cancelEdit();
    } else {
      await addDoc(collection(db, "tasks"), {
        title:task, priority:selectedPriority, repeat,
        dueDate, department:selectedDept, assignedTo:selectedEmployee,
        status:"pending", category, notes, createdAt:new Date()
      });
      showToast("Task added ✓", "success");
      document.getElementById("task").value  = "";
      document.getElementById("notes").value = "";
    }
    await loadTasks(true);
  } catch(e) {
    console.error(e);
    showToast("Error saving task", "error");
  }

  mainBtn.textContent = editMode ? "Update Task" : "＋ Add Task";
  mainBtn.disabled    = false;
};

// ─── Edit ─────────────────────────────────────────────
window.editTask = function(id) {
  const t = allTasks.find(t => t.id === id);
  if (!t) return;

  editMode = true; editId = id;
  selectedEmployee = t.assignedTo;
  selectedDept     = t.department;
  selectedPriority = t.priority;

  document.getElementById("task").value     = t.title;
  document.getElementById("notes").value    = t.notes    || "";
  document.getElementById("repeat").value   = t.repeat   || "none";
  document.getElementById("category").value = t.category || "general";

  selectPriority(t.priority);
  mainBtn.textContent      = "Update Task";
  cancelBtn.style.display  = "inline-block";

  // highlight employee tab
  document.querySelectorAll(".emp-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.emp === t.assignedTo);
  });
  breadcrumb.textContent = `Editing task for: ${t.assignedTo}`;

  document.querySelector(".task-form-card").scrollIntoView({ behavior:"smooth" });
  document.getElementById("task").focus();
};

window.cancelEdit = function() {
  editMode = false; editId = null;
  document.getElementById("task").value  = "";
  document.getElementById("notes").value = "";
  mainBtn.textContent     = "＋ Add Task";
  cancelBtn.style.display = "none";
};

// ─── Toggle Complete ──────────────────────────────────
window.toggleTask = async function(id, checked) {
  try {
    await updateDoc(doc(db,"tasks",id), { status: checked ? "completed" : "pending" });
    showToast(checked ? "Task completed 🎉" : "Task reopened", checked ? "success" : "");
    await loadTasks(true);

    if (checked) {
      setTimeout(async() => {
        const t = allTasks.find(t => t.id === id);
        if (!t || !t.repeat || t.repeat === "none") return;
        const next = new Date(safeDate(t.dueDate));
        if (t.repeat === "daily")  next.setDate(next.getDate() + 1);
        else if (t.repeat === "weekly") next.setDate(next.getDate() + 7);
        else next.setDate(next.getDate() + parseInt(t.repeat));
        const { id: _id, ...rest } = t;
        await addDoc(collection(db,"tasks"), { ...rest, dueDate:next, status:"pending", createdAt:new Date() });
        await loadTasks(true);
        showToast("Recurring task scheduled 🔁", "success");
      }, 1500);
    }
  } catch(e) { console.error(e); showToast("Error updating task","error"); }
};

// ─── Delete ───────────────────────────────────────────
window.confirmDeleteTask = function(id) {
  deleteTargetId = id;
  document.getElementById("deleteModal").style.display = "grid";
};
window.closeDeleteModal = function() {
  document.getElementById("deleteModal").style.display = "none";
  deleteTargetId = null;
};
window.confirmDelete = async function() {
  if (!deleteTargetId) return;
  try {
    await deleteDoc(doc(db,"tasks", deleteTargetId));
    closeDeleteModal();
    showToast("Task deleted","");
    await loadTasks(true);
  } catch(e) { showToast("Error deleting task","error"); }
};

// ─── Load from Firebase ───────────────────────────────
async function loadTasks(keepDept = false) {
  try {
    const snapshot = await getDocs(collection(db,"tasks"));
    allTasks = snapshot.docs.map(d => ({ id:d.id, ...d.data() }));
  } catch(e) {
    console.error("Firebase error:", e);
    allTasks = [];
    showToast("Could not reach database","error");
  }
  if (!keepDept) {
    selectDepartment(selectedDept);   // full re-render from scratch
  } else {
    updateEmployeeTabs();
    updateSidebarStats();
    renderDashboard();
  }
}

// ─── Filter / Sort / Search ───────────────────────────
window.setFilter = function(f, btn) {
  currentFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderDashboard();
};
window.setSortMode = function(s) { currentSort = s; renderDashboard(); };
window.filterTasks = function() {
  currentSearch = document.getElementById("searchInput").value.toLowerCase();
  renderDashboard();
};

function applyFilters(tasks) {
  // Only show tasks for current department
  let r = tasks.filter(t => t.department === selectedDept);

  if (currentSearch) {
    r = r.filter(t =>
      (t.title||"").toLowerCase().includes(currentSearch) ||
      (t.notes||"").toLowerCase().includes(currentSearch)
    );
  }
  if (currentFilter === "pending")   r = r.filter(t => t.status !== "completed");
  if (currentFilter === "completed") r = r.filter(t => t.status === "completed");
  if (currentFilter === "overdue")   r = r.filter(t => t.status !== "completed" && diffDays(t) < 0);
  return r;
}

function sortTasks(tasks) {
  const po = { p1:1,p2:2,p3:3,p4:4 };
  if (currentSort === "priority") return [...tasks].sort((a,b) => po[a.priority]-po[b.priority]);
  if (currentSort === "date")     return [...tasks].sort((a,b) => safeDate(a.dueDate)-safeDate(b.dueDate));
  if (currentSort === "title")    return [...tasks].sort((a,b) => (a.title||"").localeCompare(b.title||""));
  return tasks;
}

// ─── Render Dashboard ─────────────────────────────────
function renderDashboard() {
  dashboard.innerHTML = "";
  dashboard.className = "dashboard" + (listView ? " list-view" : "");

  // Show ALL employees for the department, even those with 0 tasks
  const allEmps    = employeesMap[selectedDept];
  const filtTasks  = applyFilters(allTasks);

  // If search/filter yields nothing
  if (currentSearch && filtTasks.length === 0) {
    dashboard.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>No tasks match your search</h3>
      <p>Try different keywords or clear the filter.</p>
    </div>`;
    return;
  }

  allEmps.forEach((emp, ei) => {
    const empTasks  = filtTasks.filter(t => t.assignedTo === emp);
    const allEmpT   = allTasks.filter(t => t.assignedTo === emp && t.department === selectedDept);
    const active    = allEmpT.filter(t => t.status !== "completed");
    const overdueCnt = allEmpT.filter(t => t.status !== "completed" && diffDays(t) < 0).length;

    const total = allEmpT.length;
    const done  = allEmpT.filter(t => t.status === "completed").length;
    const pct   = total ? Math.round((done/total)*100) : 0;
    const wl    = active.length > 5 ? "red" : active.length > 2 ? "yellow" : "green";
    const wlLabel = { red:"Overloaded", yellow:"Moderate", green:"Light" }[wl];

    const color   = avatarColors[ei % avatarColors.length];
    const initials = emp.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();

    const section = document.createElement("div");
    section.className = "emp-section" + (collapsedCards.has(emp) ? " collapsed" : "");

    const buckets = bucketTasks(empTasks);
    const order   = ["overdue","today","tomorrow","upcoming","completed"];
    const labels  = { overdue:"Overdue", today:"Due Today", tomorrow:"Due Tomorrow", upcoming:"Upcoming", completed:"Completed" };

    let bodyHtml = "";
    order.forEach(sec => {
      const list = sortTasks(buckets[sec]);
      if (!list.length) return;
      bodyHtml += `<div class="task-section">
        <div class="task-section-label">
          <span class="section-dot dot-${sec}"></span>${labels[sec]} <span class="sec-count">${list.length}</span>
        </div>`;
      list.forEach(t => { bodyHtml += renderTask(t); });
      bodyHtml += `</div>`;
    });

    if (!bodyHtml) {
      bodyHtml = `<div class="no-task-msg">No tasks ${currentFilter !== "all" ? "matching filter" : "assigned yet"}</div>`;
    }

    const safeEmp = emp.replace(/'/g, "\\'");
    section.innerHTML = `
      <div class="emp-header" onclick="toggleCard('${safeEmp}')">
        <div class="emp-header-left">
          <div class="emp-avatar" style="background:${color}">${initials}</div>
          <div>
            <div class="emp-name">${emp}</div>
            <div class="emp-meta">${active.length} pending · ${overdueCnt > 0 ? `<span class="ov-warn">⚠ ${overdueCnt} overdue</span>` : "all clear"}</div>
          </div>
        </div>
        <div class="emp-header-right">
          <div class="progress-bar-wrap" title="${pct}% done">
            <div class="progress-bar-fill" style="width:${pct}%;background:${pct>66?"#22c55e":pct>33?"#f59e0b":"#6366f1"}"></div>
          </div>
          <span class="workload-badge badge-${wl}">${wlLabel}</span>
          <span class="chevron">▼</span>
        </div>
      </div>
      <div class="emp-body">${bodyHtml}</div>`;

    dashboard.appendChild(section);
  });
}

// ─── Render single task row ───────────────────────────
function renderTask(t) {
  const done     = t.status === "completed";
  const diff     = diffDays(t);
  const dueTxt   = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Due today" : `In ${diff}d`;
  const dueClass = diff < 0 && !done ? "overdue" : "";
  const pm       = priMeta[t.priority] || priMeta.p4;
  const cat      = t.category || "general";
  const catLabels = { patient:"Patient", admin:"Admin", followup:"Follow-up", report:"Report", meeting:"Meeting", general:"" };
  const catLabel  = catLabels[cat] || "";
  const repeat    = t.repeat && t.repeat !== "none" ? `<span class="task-tag repeat-tag">🔁 Repeat</span>` : "";

  return `
  <div class="task-row ${done ? "done" : ""}">
    <div class="pri-flag" style="background:${pm.bg};color:${pm.color}" title="${pm.label}">${pm.icon}</div>
    <input type="checkbox" class="task-cb" ${done?"checked":""} 
      onchange="toggleTask('${t.id}',this.checked)" onclick="event.stopPropagation()">
    <div class="task-body">
      <div class="task-title" onclick="editTask('${t.id}')">${t.title}</div>
      <div class="task-meta">
        ${catLabel ? `<span class="task-tag tag-${cat}">${catLabel}</span>` : ""}
        <span class="task-due ${dueClass}">📅 ${dueTxt}</span>
        ${repeat}
        ${t.notes ? `<span class="task-tag notes-tag" title="${t.notes}">📝 Note</span>` : ""}
      </div>
    </div>
    <div class="task-actions">
      <button class="task-act-btn" onclick="editTask('${t.id}')" title="Edit">✏️</button>
      <button class="task-act-btn del" onclick="confirmDeleteTask('${t.id}')" title="Delete">🗑</button>
    </div>
  </div>`;
}

// ─── Helpers ──────────────────────────────────────────
function bucketTasks(tasks) {
  const s = { overdue:[], today:[], tomorrow:[], upcoming:[], completed:[] };
  tasks.forEach(t => {
    if (t.status === "completed") { s.completed.push(t); return; }
    const d = diffDays(t);
    if (d < 0) s.overdue.push(t);
    else if (d === 0) s.today.push(t);
    else if (d === 1) s.tomorrow.push(t);
    else s.upcoming.push(t);
  });
  return s;
}

function safeDate(v) {
  if (!v) return new Date();
  if (typeof v.toDate === "function") return v.toDate();
  return new Date(v);
}

function diffDays(t) {
  const due = safeDate(t.dueDate);
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.ceil((due - now) / 86400000);
}

// ─── Collapse / Expand ────────────────────────────────
window.toggleCard = function(emp) {
  collapsedCards.has(emp) ? collapsedCards.delete(emp) : collapsedCards.add(emp);
  renderDashboard();
};

// ─── Sidebar stats ────────────────────────────────────
function updateSidebarStats() {
  const dt = allTasks.filter(t => t.department === selectedDept);
  const pending = dt.filter(t => t.status !== "completed").length;
  const overdue = dt.filter(t => t.status !== "completed" && diffDays(t) < 0).length;
  sidebarStat.textContent = `${pending} pending · ${overdue} overdue`;
}

// ─── Stats Panel ──────────────────────────────────────
window.toggleStats = function() {
  statsVisible = !statsVisible;
  if (!statsVisible) { statsBar.style.display = "none"; return; }
  const dt    = allTasks.filter(t => t.department === selectedDept);
  const total = dt.length;
  const done  = dt.filter(t => t.status === "completed").length;
  const ov    = dt.filter(t => t.status !== "completed" && diffDays(t) < 0).length;
  const urg   = dt.filter(t => t.priority === "p1" && t.status !== "completed").length;
  statsBar.style.display = "flex";
  statsBar.innerHTML = `
    <div class="stat-card blue"><div class="stat-num">${total}</div><div class="stat-lbl">Total</div></div>
    <div class="stat-card green"><div class="stat-num">${done}</div><div class="stat-lbl">Completed</div></div>
    <div class="stat-card red"><div class="stat-num">${ov}</div><div class="stat-lbl">Overdue</div></div>
    <div class="stat-card orange"><div class="stat-num">${urg}</div><div class="stat-lbl">Urgent</div></div>
    <div class="stat-card"><div class="stat-num">${total?Math.round((done/total)*100):0}%</div><div class="stat-lbl">Done rate</div></div>`;
};

// ─── View Toggle ──────────────────────────────────────
window.toggleView = function() {
  listView = !listView;
  document.getElementById("viewToggleBtn").textContent = listView ? "📦 Card View" : "📋 List View";
  renderDashboard();
};

// ─── Export CSV ───────────────────────────────────────
window.exportTasks = function() {
  const dt = allTasks.filter(t => t.department === selectedDept);
  if (!dt.length) { showToast("No tasks to export","error"); return; }
  const rows = [["Employee","Task","Category","Priority","Status","Due Date","Repeat","Notes"]];
  dt.forEach(t => {
    rows.push([
      t.assignedTo, t.title, t.category||"general",
      {p1:"Urgent",p2:"High",p3:"Normal",p4:"Low"}[t.priority]||"",
      t.status, safeDate(t.dueDate).toLocaleDateString(),
      t.repeat||"none", t.notes||""
    ]);
  });
  const csv = rows.map(r => r.map(c=>`"${c}"`).join(",")).join("\n");
  const a   = document.createElement("a");
  a.href    = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = `${deptNames[selectedDept].replace(/ /g,"_")}_tasks_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast("Exported ✓","success");
};

// ─── Toast ────────────────────────────────────────────
function showToast(msg, type="") {
  toastEl.textContent = msg;
  toastEl.className   = "toast show " + type;
  setTimeout(() => toastEl.className = "toast", 2800);
}
