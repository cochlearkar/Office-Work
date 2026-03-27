import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── State ────────────────────────────────────────────
const employeesMap = {
  child: ["Dr Basavaraj", "Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"],
  oral: ["Dr Basavaraj", "Dr Harshitha", "Nethra"],
  ci: ["Dr Basavaraj", "Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"]
};

const deptNames = { child: "Child Health", oral: "Oral Health", ci: "Cochlear Implant" };
const avatarColors = ["#6366f1","#ec4899","#14b8a6","#f59e0b","#8b5cf6","#ef4444","#0ea5e9"];

let selectedDept = "child";
let selectedEmployee = "";
let selectedPriority = "p4";
let editMode = false;
let editId = null;
let allTasks = [];
let currentFilter = "all";
let currentSort = "priority";
let currentSearch = "";
let listView = false;
let deleteTargetId = null;
let statsVisible = false;
let collapsedCards = new Set();

// ─── DOM refs ────────────────────────────────────────
const dashboard = document.getElementById("dashboard");
const empDiv = document.getElementById("employees");
const mainBtn = document.getElementById("mainBtn");
const cancelBtn = document.getElementById("cancelBtn");
const pageTitle = document.getElementById("pageTitle");
const breadcrumb = document.getElementById("breadcrumb");
const sidebarStats = document.getElementById("sidebarStats");
const statsBar = document.getElementById("statsBar");
const toast = document.getElementById("toast");

// ─── Init ─────────────────────────────────────────────
selectDepartment("child");
loadTasks();

// ─── Department ───────────────────────────────────────
window.selectDepartment = function (dept) {
  selectedDept = dept;
  selectedEmployee = "";

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.dept === dept));
  pageTitle.textContent = deptNames[dept];
  breadcrumb.textContent = "Select an employee to assign tasks";

  empDiv.innerHTML = "";
  employeesMap[dept].forEach((emp, i) => {
    const btn = document.createElement("button");
    btn.className = "emp-tab";
    btn.dataset.emp = emp;
    const taskCount = allTasks.filter(t => t.assignedTo === emp && t.status !== "completed").length;
    btn.innerHTML = `${emp} <span class="task-count">${taskCount}</span>`;
    btn.onclick = () => {
      selectedEmployee = emp;
      document.querySelectorAll(".emp-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      breadcrumb.textContent = `Assigning to: ${emp}`;
    };
    empDiv.appendChild(btn);
  });

  renderDashboard();
};

// ─── Priority ─────────────────────────────────────────
window.selectPriority = function (p) {
  selectedPriority = p;
  document.querySelectorAll(".pri-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById(p).classList.add("selected");
};

// ─── Add / Update Task ────────────────────────────────
window.addTask = async function () {
  const task = document.getElementById("task").value.trim();
  const repeat = document.getElementById("repeat").value;
  const days = parseInt(document.getElementById("days").value);
  const category = document.getElementById("category").value;
  const notes = document.getElementById("notes").value.trim();

  if (!task) { showToast("Please enter a task description", "error"); return; }
  if (!selectedDept) { showToast("Please select a department", "error"); return; }
  if (!selectedEmployee) { showToast("Please select an employee", "error"); return; }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  mainBtn.textContent = editMode ? "Updating…" : "Adding…";
  mainBtn.disabled = true;

  try {
    if (editMode && editId) {
      await updateDoc(doc(db, "tasks", editId), {
        title: task, priority: selectedPriority, repeat,
        dueDate, department: selectedDept, assignedTo: selectedEmployee,
        category, notes
      });
      showToast("Task updated ✓", "success");
      cancelEdit();
    } else {
      await addDoc(collection(db, "tasks"), {
        title: task, priority: selectedPriority, repeat,
        dueDate, department: selectedDept, assignedTo: selectedEmployee,
        status: "pending", category, notes,
        createdAt: new Date()
      });
      showToast("Task added ✓", "success");
      document.getElementById("task").value = "";
      document.getElementById("notes").value = "";
    }
    await loadTasks();
  } catch (e) {
    showToast("Error saving task", "error");
  }

  mainBtn.textContent = editMode ? "Update Task" : "+ Add Task";
  mainBtn.disabled = false;
};

// ─── Edit ─────────────────────────────────────────────
window.editTask = function (id) {
  const t = allTasks.find(t => t.id === id);
  if (!t) return;

  editMode = true;
  editId = id;
  selectedEmployee = t.assignedTo;
  selectedDept = t.department;
  selectedPriority = t.priority;

  document.getElementById("task").value = t.title;
  document.getElementById("notes").value = t.notes || "";
  document.getElementById("repeat").value = t.repeat || "none";
  document.getElementById("category").value = t.category || "general";

  selectPriority(t.priority);
  mainBtn.textContent = "Update Task";
  cancelBtn.style.display = "inline-block";

  document.querySelector(".task-form-card").scrollIntoView({ behavior: "smooth" });
  document.getElementById("task").focus();
};

window.cancelEdit = function () {
  editMode = false; editId = null;
  document.getElementById("task").value = "";
  document.getElementById("notes").value = "";
  mainBtn.textContent = "+ Add Task";
  cancelBtn.style.display = "none";
};

// ─── Toggle Complete ──────────────────────────────────
window.toggleTask = async function (id, checked) {
  await updateDoc(doc(db, "tasks", id), { status: checked ? "completed" : "pending" });
  showToast(checked ? "Task completed 🎉" : "Task reopened", checked ? "success" : "");

  await loadTasks();

  if (checked) {
    setTimeout(async () => {
      const t = allTasks.find(t => t.id === id);
      if (!t || t.status !== "completed" || t.repeat === "none") return;

      let next = new Date(t.dueDate.toDate());
      if (t.repeat === "daily") next.setDate(next.getDate() + 1);
      else if (t.repeat === "weekly") next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + parseInt(t.repeat));

      await addDoc(collection(db, "tasks"), {
        ...t, id: undefined, dueDate: next, status: "pending", createdAt: new Date()
      });
      await loadTasks();
      showToast("Recurring task scheduled", "success");
    }, 1500);
  }
};

// ─── Delete ───────────────────────────────────────────
window.confirmDeleteTask = function (id) {
  deleteTargetId = id;
  document.getElementById("deleteModal").style.display = "grid";
};
window.closeDeleteModal = function () {
  document.getElementById("deleteModal").style.display = "none";
  deleteTargetId = null;
};
window.confirmDelete = async function () {
  if (!deleteTargetId) return;
  await deleteDoc(doc(db, "tasks", deleteTargetId));
  closeDeleteModal();
  showToast("Task deleted", "");
  await loadTasks();
};

// ─── Load ─────────────────────────────────────────────
async function loadTasks() {
  const snapshot = await getDocs(collection(db, "tasks"));
  allTasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  updateEmployeeTabs();
  updateSidebarStats();
  renderDashboard();
}

// ─── Filter / Sort / Search ───────────────────────────
window.setFilter = function (f, btn) {
  currentFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderDashboard();
};
window.setSortMode = function (s) { currentSort = s; renderDashboard(); };
window.filterTasks = function () {
  currentSearch = document.getElementById("searchInput").value.toLowerCase();
  renderDashboard();
};

function applyFilters(tasks) {
  let result = tasks.filter(t => t.department === selectedDept);

  if (currentSearch) {
    result = result.filter(t =>
      t.title.toLowerCase().includes(currentSearch) ||
      (t.notes || "").toLowerCase().includes(currentSearch)
    );
  }

  if (currentFilter === "pending") result = result.filter(t => t.status !== "completed");
  if (currentFilter === "completed") result = result.filter(t => t.status === "completed");
  if (currentFilter === "overdue") {
    result = result.filter(t => t.status !== "completed" && diffDays(t) < 0);
  }
  return result;
}

function sortTasks(tasks) {
  const priOrder = { p1: 1, p2: 2, p3: 3, p4: 4 };
  if (currentSort === "priority") return [...tasks].sort((a, b) => priOrder[a.priority] - priOrder[b.priority]);
  if (currentSort === "date") return [...tasks].sort((a, b) => a.dueDate.toDate() - b.dueDate.toDate());
  if (currentSort === "title") return [...tasks].sort((a, b) => a.title.localeCompare(b.title));
  return tasks;
}

// ─── Render Dashboard ─────────────────────────────────
function renderDashboard() {
  dashboard.innerHTML = "";
  dashboard.className = "dashboard" + (listView ? " list-view" : "");

  const deptTasks = applyFilters(allTasks);

  if (deptTasks.length === 0) {
    dashboard.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <h3>No tasks found</h3>
      <p>Add a task above or change filters.</p>
    </div>`;
    return;
  }

  const employees = [...new Set(deptTasks.map(t => t.assignedTo))];

  employees.forEach((emp, ei) => {
    const tasks = deptTasks.filter(t => t.assignedTo === emp);
    const active = tasks.filter(t => t.status !== "completed");
    const overdueCnt = tasks.filter(t => t.status !== "completed" && diffDays(t) < 0).length;

    const pct = Math.round((tasks.filter(t => t.status === "completed").length / tasks.length) * 100);
    const wl = active.length > 5 ? "red" : active.length > 2 ? "yellow" : "green";
    const wlLabel = { red: "Overloaded", yellow: "Moderate", green: "Light" }[wl];

    const color = avatarColors[ei % avatarColors.length];
    const initials = emp.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

    const section = document.createElement("div");
    section.className = "emp-section" + (collapsedCards.has(emp) ? " collapsed" : "");
    section.id = "emp-" + emp.replace(/\s/g, "_");

    const sections = bucketTasks(tasks);

    let bodyHtml = "";
    const order = ["overdue", "today", "tomorrow", "upcoming", "completed"];
    order.forEach(sec => {
      const list = sortTasks(sections[sec]);
      if (list.length === 0) return;
      const labels = { overdue: "Overdue", today: "Due Today", tomorrow: "Due Tomorrow", upcoming: "Upcoming", completed: "Completed" };
      bodyHtml += `<div class="task-section">
        <div class="task-section-label">
          <span class="section-dot dot-${sec}"></span>${labels[sec]} (${list.length})
        </div>`;
      list.forEach((t, i) => { bodyHtml += renderTask(t, i); });
      bodyHtml += `</div>`;
    });

    section.innerHTML = `
      <div class="emp-header" onclick="toggleCard('${emp.replace(/'/g, "\\'")}')">
        <div class="emp-header-left">
          <div class="emp-avatar" style="background:${color}">${initials}</div>
          <div>
            <div class="emp-name">${emp}</div>
            <div class="emp-meta">${active.length} pending · ${overdueCnt > 0 ? `⚠ ${overdueCnt} overdue` : "no overdue"}</div>
          </div>
        </div>
        <div class="emp-header-right">
          <div class="progress-bar-wrap">
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

function renderTask(t, i) {
  const done = t.status === "completed";
  const diff = diffDays(t);
  const dueTxt = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Due today" : `In ${diff}d`;
  const dueClass = diff < 0 && !done ? "overdue" : "";
  const priClass = { p1: "pri-p1", p2: "pri-p2", p3: "pri-p3", p4: "pri-p4" }[t.priority];
  const cat = t.category || "general";
  const catLabel = { patient: "Patient", admin: "Admin", followup: "Follow-up", report: "Report", meeting: "Meeting", general: "" }[cat];
  const repeat = t.repeat && t.repeat !== "none" ? "🔁" : "";

  return `
  <div class="task-row ${done ? "done" : ""}">
    <div class="pri-dot ${priClass}"></div>
    <input type="checkbox" class="task-cb" ${done ? "checked" : ""}
      onchange="toggleTask('${t.id}', this.checked)" onclick="event.stopPropagation()">
    <div class="task-body">
      <div class="task-title" onclick="editTask('${t.id}')">${t.title}</div>
      <div class="task-meta">
        ${catLabel ? `<span class="task-tag tag-${cat}">${catLabel}</span>` : ""}
        <span class="task-due ${dueClass}">📅 ${dueTxt}</span>
        ${repeat}
        ${t.notes ? `<span class="task-tag" title="${t.notes}">📝</span>` : ""}
      </div>
    </div>
    <div class="task-actions">
      <button class="task-act-btn" onclick="editTask('${t.id}')" title="Edit">✏️</button>
      <button class="task-act-btn del" onclick="confirmDeleteTask('${t.id}')" title="Delete">🗑</button>
    </div>
  </div>`;
}

// ─── Bucket by due date ───────────────────────────────
function bucketTasks(tasks) {
  const sections = { overdue: [], today: [], tomorrow: [], upcoming: [], completed: [] };
  tasks.forEach(t => {
    if (t.status === "completed") { sections.completed.push(t); return; }
    const diff = diffDays(t);
    if (diff < 0) sections.overdue.push(t);
    else if (diff === 0) sections.today.push(t);
    else if (diff === 1) sections.tomorrow.push(t);
    else sections.upcoming.push(t);
  });
  return sections;
}

function diffDays(t) {
  const due = t.dueDate?.toDate?.() ?? new Date(t.dueDate);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

// ─── Collapse / Expand cards ──────────────────────────
window.toggleCard = function (emp) {
  if (collapsedCards.has(emp)) collapsedCards.delete(emp);
  else collapsedCards.add(emp);
  renderDashboard();
};

// ─── Update employee tabs with counts ─────────────────
function updateEmployeeTabs() {
  document.querySelectorAll(".emp-tab").forEach(btn => {
    const emp = btn.dataset.emp;
    const cnt = allTasks.filter(t => t.assignedTo === emp && t.status !== "completed").length;
    const countEl = btn.querySelector(".task-count");
    if (countEl) countEl.textContent = cnt;
  });
}

// ─── Sidebar stats ────────────────────────────────────
function updateSidebarStats() {
  const deptTasks = allTasks.filter(t => t.department === selectedDept);
  const pending = deptTasks.filter(t => t.status !== "completed").length;
  const overdue = deptTasks.filter(t => t.status !== "completed" && diffDays(t) < 0).length;
  sidebarStats.textContent = `${pending} pending · ${overdue} overdue`;
}

// ─── Stats Panel ──────────────────────────────────────
window.toggleStats = function () {
  statsVisible = !statsVisible;
  if (!statsVisible) { statsBar.style.display = "none"; return; }

  const deptTasks = allTasks.filter(t => t.department === selectedDept);
  const total = deptTasks.length;
  const done = deptTasks.filter(t => t.status === "completed").length;
  const overdue = deptTasks.filter(t => t.status !== "completed" && diffDays(t) < 0).length;
  const urgent = deptTasks.filter(t => t.priority === "p1" && t.status !== "completed").length;

  statsBar.style.display = "flex";
  statsBar.innerHTML = `
    <div class="stat-card blue"><div class="stat-num">${total}</div><div class="stat-lbl">Total Tasks</div></div>
    <div class="stat-card green"><div class="stat-num">${done}</div><div class="stat-lbl">Completed</div></div>
    <div class="stat-card red"><div class="stat-num">${overdue}</div><div class="stat-lbl">Overdue</div></div>
    <div class="stat-card orange"><div class="stat-num">${urgent}</div><div class="stat-lbl">Urgent</div></div>
    <div class="stat-card"><div class="stat-num">${total ? Math.round((done/total)*100) : 0}%</div><div class="stat-lbl">Completion Rate</div></div>
  `;
};

// ─── View Toggle ──────────────────────────────────────
window.toggleView = function () {
  listView = !listView;
  document.getElementById("viewToggleBtn").textContent = listView ? "📦 Card View" : "📋 List View";
  renderDashboard();
};

// ─── Export CSV ───────────────────────────────────────
window.exportTasks = function () {
  const deptTasks = allTasks.filter(t => t.department === selectedDept);
  if (!deptTasks.length) { showToast("No tasks to export", "error"); return; }

  const rows = [["Employee", "Task", "Category", "Priority", "Status", "Due Date", "Repeat", "Notes"]];
  deptTasks.forEach(t => {
    const due = t.dueDate?.toDate?.() ?? new Date(t.dueDate);
    rows.push([
      t.assignedTo, t.title, t.category || "general",
      { p1: "Urgent", p2: "High", p3: "Normal", p4: "Low" }[t.priority],
      t.status, due.toLocaleDateString(), t.repeat || "none", t.notes || ""
    ]);
  });

  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = `${selectedDept}_tasks_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast("Exported ✓", "success");
};

// ─── Toast ────────────────────────────────────────────
function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  setTimeout(() => toast.className = "toast", 2800);
}
