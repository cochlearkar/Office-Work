import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Data ───────────────────────────────────────────
const employeesMap = {
  child: ["Dr Basavaraj","Dr Vanitha B","Mr Madhukar","Miss Sumayya","Miss Manjula"],
  oral:  ["Dr Basavaraj","Dr Harshitha","Nethra"],
  ci:    ["Dr Basavaraj","Dr Vanitha B","Mr Madhukar","Miss Sumayya","Miss Manjula"]
};
const deptNames = { child:"Child Health", oral:"Oral Health", ci:"Cochlear Implant" };
const avatarColors = ["#0d9488","#7c3aed","#db2777","#d97706","#2563eb","#059669","#dc2626"];
const priDotClass  = { p1:"u", p2:"h", p3:"n", p4:"l" };
const priLabel     = { p1:"Urgent", p2:"High", p3:"Normal", p4:"Low" };

// ── State ──────────────────────────────────────────
let currentDept   = "child";
let urgentView    = false;           // cross-dept overdue+today view
let allTasks      = [];
let selectedPri   = "p4";
let editPri       = "p4";
let editId        = null;
let delId         = null;
let currentFilter = "all";
let currentSort   = "priority";
let statsVisible  = false;
let openCards     = new Set();

// ── DOM ────────────────────────────────────────────
const dashboard  = document.getElementById("dashboard");
const toastEl    = document.getElementById("toast");
const filterRow  = document.getElementById("filterRow");

// ── Boot ───────────────────────────────────────────
loadTasks();

// ── Urgent View (cross-dept overdue + today) ───────
window.selectUrgentView = function() {
  urgentView = true;
  currentFilter = "all";
  document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active"));
  document.querySelector("[data-dept='urgent-view']").classList.add("active","urgent-tab");
  filterRow.style.display = "none";           // filters don't apply in urgent view
  document.getElementById("addBarWrap").style.display = "none"; // hide add bar
  renderUrgentView();
};

// ── Department ─────────────────────────────────────
window.selectDepartment = function(d) {
  urgentView = false;
  currentDept = d;
  document.querySelectorAll(".dept-tab").forEach(b => b.classList.remove("active","urgent-tab"));
  document.querySelector(`[data-dept='${d}']`).classList.add("active");
  filterRow.style.display = "flex";
  document.getElementById("addBarWrap").style.display = "block";
  populateAssignSelect();
  renderDashboard();
  updateStats();
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

// ── Priority (add form) ────────────────────────────
window.selectPriority = function(p) {
  selectedPri = p;
  ["p1","p2","p3","p4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  document.getElementById(p)?.classList.add("selected");
};

// ── Priority (edit modal) ──────────────────────────
window.selectEditPriority = function(p) {
  editPri = p;
  ["ep1","ep2","ep3","ep4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  document.getElementById("e"+p)?.classList.add("selected");
};

// ── Repeat custom toggle ───────────────────────────
window.onRepeatChange = function(sel) {
  const wrap = document.getElementById("customDaysWrap");
  wrap.style.display = sel.value === "custom" ? "flex" : "none";
};
window.onEditRepeatChange = function(sel) {
  const wrap = document.getElementById("editCustomDaysWrap");
  wrap.style.display = sel.value === "custom" ? "flex" : "none";
};

function getRepeatValue(selectId, customInputId) {
  const val = document.getElementById(selectId).value;
  if(val === "custom") {
    const n = parseInt(document.getElementById(customInputId).value);
    return (!isNaN(n) && n > 0) ? String(n) : "none";
  }
  return val;
}

// ── Add Task ───────────────────────────────────────
window.addTask = async function() {
  const title  = document.getElementById("task").value.trim();
  const emp    = document.getElementById("assignTo").value;
  const days   = parseInt(document.getElementById("days").value) || 0;
  const repeat = getRepeatValue("repeat","customDays");

  if(!title) { showToast("Enter a task description","error"); return; }
  if(!emp)   { showToast("Select who to assign this to","error"); return; }

  const due = new Date();
  due.setHours(0,0,0,0);
  due.setDate(due.getDate() + days);

  const btn = document.getElementById("mainBtn");
  btn.textContent = "…"; btn.disabled = true;

  try {
    await addDoc(collection(db,"tasks"), {
      title, assignedTo:emp, department:currentDept,
      dueDate:due, priority:selectedPri, repeat,
      status:"pending", createdAt:new Date()
    });
    document.getElementById("task").value = "";
    openCards.add(emp);
    showToast("Task added ✓","success");
    await loadTasks(true);
  } catch(e) {
    console.error(e);
    showToast("Error saving task","error");
  }
  btn.textContent = "＋"; btn.disabled = false;
};

// ── Edit modal ─────────────────────────────────────
window.openEditModal = function(id) {
  const t = allTasks.find(t => t.id === id);
  if(!t) return;
  editId  = id;
  editPri = t.priority || "p4";

  document.getElementById("editTask").value = t.title;

  // Due date select — pick closest preset, else default to today
  const diff = diffDays(t);
  const presets = [0,1,2,3,5,7];
  const best = diff >= 0
    ? presets.reduce((a,b) => Math.abs(b-diff)<Math.abs(a-diff)?b:a,0)
    : 0;
  document.getElementById("editDays").value = best;

  // Repeat
  const editRepeatSel  = document.getElementById("editRepeat");
  const editCustWrap   = document.getElementById("editCustomDaysWrap");
  const editCustInput  = document.getElementById("editCustomDays");
  const knownRepeats   = ["none","daily","weekly"];
  if(knownRepeats.includes(t.repeat||"none")) {
    editRepeatSel.value = t.repeat || "none";
    editCustWrap.style.display = "none";
  } else {
    // numeric custom repeat
    editRepeatSel.value = "custom";
    editCustInput.value = t.repeat || "";
    editCustWrap.style.display = "flex";
  }

  // Priority chips
  ["ep1","ep2","ep3","ep4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  document.getElementById("e"+editPri)?.classList.add("selected");

  document.getElementById("editModal").style.display = "flex";
  setTimeout(()=>document.getElementById("editTask").focus(),100);
};

window.closeEditModal = function() {
  document.getElementById("editModal").style.display = "none";
  editId = null;
};
window.closeEditIfOutside = function(e) {
  if(e.target === document.getElementById("editModal")) closeEditModal();
};

window.saveEdit = async function() {
  const title  = document.getElementById("editTask").value.trim();
  const days   = parseInt(document.getElementById("editDays").value) || 0;
  const repeat = getRepeatValue("editRepeat","editCustomDays");

  if(!title) { showToast("Task cannot be empty","error"); return; }

  const due = new Date();
  due.setHours(0,0,0,0);
  due.setDate(due.getDate() + days);

  const btn = document.querySelector(".modal-save");
  btn.textContent = "Saving…"; btn.disabled = true;

  try {
    await updateDoc(doc(db,"tasks",editId),{
      title, dueDate:due, priority:editPri, repeat
    });
    showToast("Updated ✓","success");
    closeEditModal();
    await loadTasks(true);
  } catch(e) {
    console.error(e);
    showToast("Error updating","error");
  }
  btn.textContent = "Save Changes"; btn.disabled = false;
};

// ── Toggle complete ────────────────────────────────
window.toggleTask = async function(id, checked) {
  try {
    await updateDoc(doc(db,"tasks",id),{ status:checked?"completed":"pending" });
    showToast(checked?"Done! 🎉":"Reopened", checked?"success":"");
    await loadTasks(true);

    if(checked) {
      setTimeout(async()=>{
        const t = allTasks.find(t=>t.id===id);
        if(!t || !t.repeat || t.repeat==="none") return;
        const next = new Date(safeDate(t.dueDate));
        const n = parseInt(t.repeat);
        if(t.repeat==="daily")       next.setDate(next.getDate()+1);
        else if(t.repeat==="weekly") next.setDate(next.getDate()+7);
        else if(!isNaN(n))           next.setDate(next.getDate()+n);
        const {id:_,createdAt:__,...rest} = t;
        await addDoc(collection(db,"tasks"),{...rest,dueDate:next,status:"pending",createdAt:new Date()});
        await loadTasks(true);
        showToast("Next recurrence scheduled 🔁","success");
      },1500);
    }
  } catch(e){ showToast("Error","error"); }
};

// ── Delete ─────────────────────────────────────────
window.openDeleteModal = function(id) {
  delId = id;
  document.getElementById("deleteModal").style.display = "flex";
};
window.closeDeleteModal = function() {
  document.getElementById("deleteModal").style.display = "none";
  delId = null;
};
window.confirmDelete = async function() {
  if(!delId) return;
  try {
    await deleteDoc(doc(db,"tasks",delId));
    closeDeleteModal();
    showToast("Deleted","");
    await loadTasks(true);
  } catch(e){ showToast("Error deleting","error"); }
};

// ── Load ───────────────────────────────────────────
async function loadTasks(keepDept=false) {
  try {
    const snap = await getDocs(collection(db,"tasks"));
    allTasks = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e) {
    console.error("Firebase:",e);
    allTasks = [];
    showToast("Cannot reach database","error");
  }
  if(!keepDept) {
    populateAssignSelect();
    if(urgentView) renderUrgentView();
    else selectDepartment(currentDept);
  } else {
    populateAssignSelect();
    if(urgentView) renderUrgentView();
    else { renderDashboard(); updateStats(); }
  }
}

// ── Filter / Sort ──────────────────────────────────
window.setFilter = function(f,btn) {
  currentFilter = f;
  document.querySelectorAll(".fchip").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  renderDashboard();
};
window.setSortMode = function(s){ currentSort=s; renderDashboard(); };

function filterDeptTasks(tasks) {
  let r = tasks.filter(t=>t.department===currentDept);
  if(currentFilter==="pending")   r=r.filter(t=>t.status!=="completed");
  if(currentFilter==="completed") r=r.filter(t=>t.status==="completed");
  if(currentFilter==="overdue")   r=r.filter(t=>t.status!=="completed"&&diffDays(t)<0);
  return r;
}
function sortTasks(tasks) {
  const po={p1:1,p2:2,p3:3,p4:4};
  if(currentSort==="priority") return [...tasks].sort((a,b)=>po[a.priority]-po[b.priority]);
  if(currentSort==="date")     return [...tasks].sort((a,b)=>safeDate(a.dueDate)-safeDate(b.dueDate));
  if(currentSort==="name")     return [...tasks].sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  return tasks;
}

// ── Urgent View — all staff, overdue + today only ──
function renderUrgentView() {
  dashboard.innerHTML = "";

  // Gather all overdue and today tasks across ALL departments
  const urgent = allTasks.filter(t =>
    t.status !== "completed" && diffDays(t) <= 0
  );

  if(!urgent.length) {
    dashboard.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <h3>All clear!</h3>
      <p>No overdue or today's tasks pending.</p>
    </div>`;
    return;
  }

  // Stats banner
  const overdueCnt = urgent.filter(t=>diffDays(t)<0).length;
  const todayCnt   = urgent.filter(t=>diffDays(t)===0).length;
  const banner = document.createElement("div");
  banner.className = "urgent-banner";
  banner.innerHTML = `
    <div class="urgent-banner-icon">🔴</div>
    <div>
      <div class="urgent-banner-text">Urgent Attention Required</div>
      <div class="urgent-banner-sub">${overdueCnt} overdue · ${todayCnt} due today · all departments</div>
    </div>`;
  dashboard.appendChild(banner);

  // Group by employee (across all depts)
  const allEmps = [...new Set(
    Object.values(employeesMap).flat()
  )];

  allEmps.forEach((emp, ei) => {
    const empTasks = urgent.filter(t=>t.assignedTo===emp);
    if(!empTasks.length) return;

    const overdue = empTasks.filter(t=>diffDays(t)<0);
    const today   = empTasks.filter(t=>diffDays(t)===0);

    const color    = avatarColors[ei%avatarColors.length];
    const initials = emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();

    const section = document.createElement("div");
    section.className = "emp-card open";

    const bucketHtml = (list, label, dotClass) => {
      if(!list.length) return "";
      const sorted = sortTasks(list);
      return `<div class="sec-label">
          <span class="sec-dot ${dotClass}"></span>${label} (${list.length})
        </div>` + sorted.map(t=>renderTaskRow(t)).join("");
    };

    section.innerHTML = `
      <div class="emp-card-head" style="cursor:default">
        <div class="emp-av" style="background:${color}">${initials}</div>
        <div class="emp-info">
          <div class="emp-name-row">
            <span class="emp-name">${emp}</span>
            ${overdue.length ? `<span class="emp-badge badge-heavy">⚠ ${overdue.length} overdue</span>` : ""}
          </div>
          <div class="emp-sub">${deptOf(emp)}</div>
        </div>
      </div>
      <div class="emp-body" style="display:block">
        ${bucketHtml(overdue,"Overdue","dot-overdue")}
        ${bucketHtml(today,"Due Today","dot-today")}
      </div>`;
    dashboard.appendChild(section);
  });
}

function deptOf(emp) {
  const depts = [];
  Object.entries(employeesMap).forEach(([d,list])=>{
    if(list.includes(emp)) depts.push(deptNames[d]);
  });
  return [...new Set(depts)].join(" · ");
}

// ── Normal Dept Dashboard ──────────────────────────
function renderDashboard() {
  dashboard.innerHTML = "";
  const emps = employeesMap[currentDept];
  const filtered = filterDeptTasks(allTasks);

  emps.forEach((emp, ei) => {
    const empFiltered = filtered.filter(t=>t.assignedTo===emp);
    const empAll      = allTasks.filter(t=>t.assignedTo===emp&&t.department===currentDept);
    const active      = empAll.filter(t=>t.status!=="completed");
    const overdueCnt  = active.filter(t=>diffDays(t)<0).length;
    const done        = empAll.filter(t=>t.status==="completed").length;
    const pct         = empAll.length?Math.round((done/empAll.length)*100):0;
    const wl          = active.length>5?"heavy":active.length>2?"medium":"ok";
    const wlLbl       = {heavy:"Heavy",medium:"Moderate",ok:"Clear"}[wl];

    const color    = avatarColors[ei%avatarColors.length];
    const initials = emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const isOpen   = openCards.has(emp);

    const buckets = bucket(empFiltered);
    const order   = ["overdue","today","tomorrow","upcoming","completed"];
    const secLabels={overdue:"Overdue",today:"Today",tomorrow:"Tomorrow",upcoming:"Upcoming",completed:"Done"};
    const dotMap  ={overdue:"dot-overdue",today:"dot-today",tomorrow:"dot-tomorrow",upcoming:"dot-upcoming",completed:"dot-done"};

    let bodyHtml = "";
    order.forEach(sec=>{
      const list = sortTasks(buckets[sec]);
      if(!list.length) return;
      bodyHtml += `<div class="sec-label">
        <span class="sec-dot ${dotMap[sec]}"></span>${secLabels[sec]} (${list.length})
      </div>` + list.map(t=>renderTaskRow(t)).join("");
    });
    if(!bodyHtml) bodyHtml = `<div class="card-empty">No tasks ${currentFilter!=="all"?"matching filter":"assigned yet"}</div>`;

    const progColor = pct>66?"#22c55e":pct>33?"#f59e0b":"#6366f1";
    const safeEmp   = emp.replace(/'/g,"\\'");

    const card = document.createElement("div");
    card.className = "emp-card" + (isOpen?" open":"");
    card.innerHTML = `
      <div class="emp-card-head" onclick="toggleCard('${safeEmp}')">
        <div class="emp-av" style="background:${color}">${initials}</div>
        <div class="emp-info">
          <div class="emp-name-row">
            <span class="emp-name">${emp}</span>
            <span class="emp-badge badge-${wl}">${wlLbl}</span>
          </div>
          <div class="emp-sub">
            <span>${active.length} pending</span>
            ${overdueCnt>0?`<span>·</span><span class="sub-ov">⚠ ${overdueCnt} overdue</span>`:""}
          </div>
        </div>
        <div class="emp-right">
          <div class="prog-wrap" title="${pct}% done">
            <div class="prog-fill" style="width:${pct}%;background:${progColor}"></div>
          </div>
          <span class="chevron-ic">▼</span>
        </div>
      </div>
      <div class="emp-body">${bodyHtml}</div>`;
    dashboard.appendChild(card);
  });
}

// ── Task Row HTML ──────────────────────────────────
function renderTaskRow(t) {
  const done   = t.status==="completed";
  const diff   = diffDays(t);
  const dotCls = priDotClass[t.priority||"p4"];

  let dueHtml = "";
  if(!done){
    const dd = safeDate(t.dueDate).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
    if(diff<0)       dueHtml=`<span class="task-due-chip due-over">⚠ ${Math.abs(diff)}d overdue</span>`;
    else if(diff===0) dueHtml=`<span class="task-due-chip due-today">Due Today</span>`;
    else if(diff===1) dueHtml=`<span class="task-due-chip due-soon">Tomorrow</span>`;
    else             dueHtml=`<span class="task-due-chip due-ok">${dd}</span>`;
  }

  const repeatLabel = t.repeat&&t.repeat!=="none"
    ? `<span class="repeat-chip">${t.repeat==="daily"?"Daily":t.repeat==="weekly"?"Weekly":"Every "+t.repeat+" days"}</span>`
    : "";

  return `
  <div class="task-row ${done?"done":""}">
    <div class="pri-dot ${dotCls}"></div>
    <input type="checkbox" class="task-cb" ${done?"checked":""}
      onchange="toggleTask('${t.id}',this.checked)" onclick="event.stopPropagation()">
    <div class="task-content">
      <div class="task-text">${t.title}${repeatLabel}</div>
      ${dueHtml}
    </div>
    <div class="task-acts">
      <button class="tact-btn" onclick="openEditModal('${t.id}')" title="Edit">✏️</button>
      <button class="tact-btn del" onclick="openDeleteModal('${t.id}')" title="Delete">🗑</button>
    </div>
  </div>`;
}

// ── Toggle card open/close ─────────────────────────
window.toggleCard = function(emp) {
  openCards.has(emp)?openCards.delete(emp):openCards.add(emp);
  renderDashboard();
};

// ── Stats ──────────────────────────────────────────
window.toggleStats = function() {
  statsVisible = !statsVisible;
  document.getElementById("statsStrip").style.display = statsVisible?"flex":"none";
  if(statsVisible) updateStats();
};
function updateStats() {
  if(!statsVisible) return;
  const dt    = urgentView ? allTasks : allTasks.filter(t=>t.department===currentDept);
  const total = dt.length;
  const done  = dt.filter(t=>t.status==="completed").length;
  const ov    = dt.filter(t=>t.status!=="completed"&&diffDays(t)<0).length;
  const urg   = dt.filter(t=>t.priority==="p1"&&t.status!=="completed").length;
  const pct   = total?Math.round((done/total)*100):0;
  document.getElementById("statsStrip").innerHTML = `
    <div class="stat-pill"><div class="snum">${total}</div><div class="slbl">Total</div></div>
    <div class="stat-pill green"><div class="snum">${done}</div><div class="slbl">Done</div></div>
    <div class="stat-pill red"><div class="snum">${ov}</div><div class="slbl">Overdue</div></div>
    <div class="stat-pill amber"><div class="snum">${urg}</div><div class="slbl">Urgent</div></div>
    <div class="stat-pill"><div class="snum">${pct}%</div><div class="slbl">Rate</div></div>`;
}

// ── Export ─────────────────────────────────────────
window.exportTasks = function() {
  const dt = urgentView ? allTasks : allTasks.filter(t=>t.department===currentDept);
  if(!dt.length){ showToast("No tasks to export","error"); return; }
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
    if(d<0) s.overdue.push(t);
    else if(d===0) s.today.push(t);
    else if(d===1) s.tomorrow.push(t);
    else s.upcoming.push(t);
  });
  return s;
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
function showToast(msg,type=""){
  toastEl.textContent=msg;
  toastEl.className="toast show "+(type||"");
  setTimeout(()=>toastEl.className="toast",2800);
}
