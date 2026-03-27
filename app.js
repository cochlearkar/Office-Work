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

const priMeta = {
  p1:{ icon:"🚩", label:"Urgent" },
  p2:{ icon:"🔶", label:"High"   },
  p3:{ icon:"🔷", label:"Normal" },
  p4:{ icon:"🩶", label:"Low"    }
};

// ── State ──────────────────────────────────────────
let dept          = "child";
let allTasks      = [];
let selectedPri   = "p4";
let editPri       = "p4";
let editId        = null;
let delId         = null;
let currentFilter = "all";
let currentSort   = "priority";
let statsVisible  = false;
let openCards     = new Set(); // track which emp cards are open

// ── DOM ────────────────────────────────────────────
const dashboard = document.getElementById("dashboard");
const toast     = document.getElementById("toast");

// ── Boot ───────────────────────────────────────────
loadTasks();

// ── Department ─────────────────────────────────────
window.selectDepartment = function(d) {
  dept = d;
  document.querySelectorAll(".dept-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.dept === d)
  );
  populateAssignSelect();
  renderDashboard();
  updateStats();
};

function populateAssignSelect() {
  const sel = document.getElementById("assignTo");
  const cur = sel.value;
  sel.innerHTML = `<option value="">— Assign to —</option>`;
  employeesMap[dept].forEach(e => {
    const o = document.createElement("option");
    o.value = o.textContent = e;
    if (e === cur) o.selected = true;
    sel.appendChild(o);
  });
}

// ── Priority ───────────────────────────────────────
window.selectPriority = function(p) {
  selectedPri = p;
  document.querySelectorAll(".pri-chip:not([id^='e'])").forEach(b => b.classList.remove("selected"));
  const el = document.getElementById(p);
  if(el) el.classList.add("selected");
};

window.selectEditPriority = function(p) {
  editPri = p;
  ["ep1","ep2","ep3","ep4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  const el = document.getElementById("e"+p);
  if(el) el.classList.add("selected");
};

// ── Add Task ───────────────────────────────────────
window.addTask = async function() {
  const title  = document.getElementById("task").value.trim();
  const emp    = document.getElementById("assignTo").value;
  const days   = parseInt(document.getElementById("days").value) || 0;
  const repeat = document.getElementById("repeat").value;

  if (!title) { showToast("Enter a task description","error"); return; }
  if (!emp)   { showToast("Select who to assign this to","error"); return; }

  const due = new Date();
  due.setHours(0,0,0,0);
  due.setDate(due.getDate() + days);

  const btn = document.getElementById("mainBtn");
  btn.textContent = "…"; btn.disabled = true;

  try {
    await addDoc(collection(db,"tasks"),{
      title, assignedTo:emp, department:dept,
      dueDate:due, priority:selectedPri, repeat,
      status:"pending", createdAt:new Date()
    });
    document.getElementById("task").value = "";
    openCards.add(emp); // auto-open that employee's card
    showToast("Task added ✓","success");
    await loadTasks(true);
  } catch(e) {
    console.error(e);
    showToast("Error saving task","error");
  }
  btn.textContent = "＋"; btn.disabled = false;
};

// ── Edit (modal) ───────────────────────────────────
window.openEditModal = function(id) {
  const t = allTasks.find(t => t.id === id);
  if(!t) return;
  editId  = id;
  editPri = t.priority || "p4";

  document.getElementById("editTask").value   = t.title;
  document.getElementById("editRepeat").value = t.repeat || "none";

  // set days select closest to remaining days
  const diff = diffDays(t);
  const opts  = [0,1,2,3,5,7];
  const best  = opts.reduce((a,b) => Math.abs(b-diff)<Math.abs(a-diff)?b:a, 0);
  document.getElementById("editDays").value = best < 0 ? 0 : best;

  // set priority chips in modal
  ["ep1","ep2","ep3","ep4"].forEach(id => document.getElementById(id)?.classList.remove("selected"));
  const eEl = document.getElementById("e"+editPri);
  if(eEl) eEl.classList.add("selected");

  document.getElementById("editModal").style.display = "flex";
  setTimeout(()=>document.getElementById("editTask").focus(), 100);
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
  const repeat = document.getElementById("editRepeat").value;

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
    await updateDoc(doc(db,"tasks",id),{ status: checked?"completed":"pending" });
    showToast(checked ? "Done! 🎉" : "Reopened", checked?"success":"");
    await loadTasks(true);

    if(checked){
      setTimeout(async()=>{
        const t = allTasks.find(t=>t.id===id);
        if(!t || !t.repeat || t.repeat==="none") return;
        const next = new Date(safeDate(t.dueDate));
        if(t.repeat==="daily")  next.setDate(next.getDate()+1);
        else if(t.repeat==="weekly") next.setDate(next.getDate()+7);
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

// ── Load Firebase ──────────────────────────────────
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
    selectDepartment(dept);
  } else {
    populateAssignSelect();
    renderDashboard();
    updateStats();
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

function filterTasks(tasks) {
  let r = tasks.filter(t=>t.department===dept);
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

// ── Render Dashboard ───────────────────────────────
function renderDashboard() {
  const filtered = filterTasks(allTasks);
  const emps     = employeesMap[dept];

  if(!emps.length){
    dashboard.innerHTML=`<div class="empty-state"><div class="empty-icon">🏥</div><h3>No staff in this dept</h3></div>`;
    return;
  }

  dashboard.innerHTML = "";

  emps.forEach((emp,ei) => {
    const empFiltered = filtered.filter(t=>t.assignedTo===emp);
    const empAll      = allTasks.filter(t=>t.assignedTo===emp&&t.department===dept);
    const active      = empAll.filter(t=>t.status!=="completed");
    const overdueCnt  = active.filter(t=>diffDays(t)<0).length;
    const done        = empAll.filter(t=>t.status==="completed").length;
    const pct         = empAll.length ? Math.round((done/empAll.length)*100) : 0;

    const wl    = active.length>5?"heavy":active.length>2?"medium":"ok";
    const wlLbl = {heavy:"Heavy load",medium:"Moderate",ok:"Clear"}[wl];
    const color = avatarColors[ei%avatarColors.length];
    const initials = emp.split(" ").filter(w=>w).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const isOpen = openCards.has(emp);

    // bucket tasks
    const buckets = bucket(empFiltered);
    const order   = ["overdue","today","tomorrow","upcoming","completed"];
    const secLabels = {overdue:"Overdue",today:"Today",tomorrow:"Tomorrow",upcoming:"Upcoming",completed:"Done"};

    let bodyHtml = "";
    order.forEach(sec=>{
      const list = sortTasks(buckets[sec]);
      if(!list.length) return;
      bodyHtml += `<div class="sec-label">
        <span class="sec-dot dot-${sec==="completed"?"done":sec}"></span>${secLabels[sec]}
      </div>`;
      list.forEach(t=>{ bodyHtml += renderTaskRow(t); });
    });

    if(!bodyHtml) {
      bodyHtml = `<div class="card-empty">${currentFilter==="all"?"No tasks assigned yet":"No tasks match this filter"}</div>`;
    }

    const safeEmp = emp.replace(/'/g,"\\'");
    const card = document.createElement("div");
    card.className = "emp-card" + (isOpen?" open":"");

    const ovHtml = overdueCnt>0
      ? `<span class="sub-ov">⚠ ${overdueCnt} overdue</span>`
      : `<span>All clear</span>`;

    const progColor = pct>66?"#22c55e":pct>33?"#f59e0b":"#6366f1";

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
            ${overdueCnt>0?`<span>·</span>${ovHtml}`:""}
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

function renderTaskRow(t) {
  const done   = t.status==="completed";
  const diff   = diffDays(t);
  const pm     = priMeta[t.priority] || priMeta.p4;
  const rep    = t.repeat&&t.repeat!=="none" ? `<span class="repeat-chip">↻</span>` : "";

  let dueHtml = "";
  if(!done){
    const dueDate = safeDate(t.dueDate);
    const dd = dueDate.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
    if(diff<0)      dueHtml=`<span class="task-due-chip due-over">⚠ ${Math.abs(diff)}d overdue</span>`;
    else if(diff===0) dueHtml=`<span class="task-due-chip due-today">Today</span>`;
    else if(diff===1) dueHtml=`<span class="task-due-chip due-soon">Tomorrow</span>`;
    else            dueHtml=`<span class="task-due-chip due-ok">${dd}</span>`;
  }

  return `
  <div class="task-row ${done?"done":""}">
    <span class="pri-flag">${pm.icon}</span>
    <input type="checkbox" class="task-cb" ${done?"checked":""}
      onchange="toggleTask('${t.id}',this.checked)" onclick="event.stopPropagation()">
    <div class="task-content">
      <div class="task-text">${t.title}${rep}</div>
      ${dueHtml}
    </div>
    <div class="task-acts">
      <button class="tact-btn" onclick="openEditModal('${t.id}')" title="Edit">✏️</button>
      <button class="tact-btn del" onclick="openDeleteModal('${t.id}')" title="Delete">🗑</button>
    </div>
  </div>`;
}

// ── Collapse toggle ────────────────────────────────
window.toggleCard = function(emp) {
  if(openCards.has(emp)) openCards.delete(emp);
  else openCards.add(emp);
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
  const dt    = allTasks.filter(t=>t.department===dept);
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

// ── Export CSV ─────────────────────────────────────
window.exportTasks = function() {
  const dt = allTasks.filter(t=>t.department===dept);
  if(!dt.length){ showToast("No tasks to export","error"); return; }
  const rows=[["Employee","Task","Priority","Status","Due Date","Repeat"]];
  dt.forEach(t=>{
    rows.push([t.assignedTo,t.title,
      {p1:"Urgent",p2:"High",p3:"Normal",p4:"Low"}[t.priority]||"",
      t.status, safeDate(t.dueDate).toLocaleDateString(), t.repeat||"none"]);
  });
  const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
  const a=document.createElement("a");
  a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
  a.download=`${deptNames[dept].replace(/ /g,"_")}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast("Exported ✓","success");
};

// ── Helpers ────────────────────────────────────────
function bucket(tasks) {
  const s={overdue:[],today:[],tomorrow:[],upcoming:[],completed:[]};
  tasks.forEach(t=>{
    if(t.status==="completed"){s.completed.push(t);return;}
    const d=diffDays(t);
    if(d<0)      s.overdue.push(t);
    else if(d===0) s.today.push(t);
    else if(d===1) s.tomorrow.push(t);
    else           s.upcoming.push(t);
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
  toast.textContent=msg;
  toast.className="toast show "+(type||"");
  setTimeout(()=>toast.className="toast",2800);
}
