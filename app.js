import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const employeesMap = {
  child: ["Dr Basavaraj", "Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"],
  oral: ["Dr Basavaraj", "Dr Harshitha", "Nethra"],
  ci: ["Dr Basavaraj", "Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"]
};

let selectedDept = "";
let selectedEmployee = "";
let selectedPriority = "p4";
let editMode = false;
let editId = null;

const dashboard = document.getElementById("dashboard");
const empDiv = document.getElementById("employees");
const mainBtn = document.getElementById("mainBtn");

// Department
window.selectDepartment = function (dept) {
  selectedDept = dept;
  empDiv.innerHTML = "";

  employeesMap[dept].forEach(emp => {
    const btn = document.createElement("button");
    btn.innerText = emp;
    btn.onclick = () => selectedEmployee = emp;
    empDiv.appendChild(btn);
  });
};

// Priority select
window.selectPriority = function (p) {
  selectedPriority = p;

  document.querySelectorAll(".flag").forEach(f => f.classList.remove("selected"));
  document.getElementById(p).classList.add("selected");
};

// Add / Update
window.addTask = async function () {
  const task = document.getElementById("task").value;
  const repeat = document.getElementById("repeat").value;
  const days = parseInt(document.getElementById("days").value);

  if (!task || !selectedDept || !selectedEmployee) {
    alert("Fill all fields");
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  if (editMode && editId) {
    await updateDoc(doc(db, "tasks", editId), {
      title: task,
      priority: selectedPriority,
      repeat,
      dueDate,
      department: selectedDept,
      assignedTo: selectedEmployee
    });

    editMode = false;
    editId = null;
    mainBtn.innerText = "Add Task";

  } else {
    await addDoc(collection(db, "tasks"), {
      title: task,
      priority: selectedPriority,
      repeat,
      dueDate,
      department: selectedDept,
      assignedTo: selectedEmployee,
      status: "pending"
    });
  }

  document.getElementById("task").value = "";
  loadTasks();
};

// Flag display
function getFlag(p) {
  return {
    p1: "🚩",
    p2: "🟧",
    p3: "🔵",
    p4: "⚪"
  }[p];
}

// Load
async function loadTasks() {
  dashboard.innerHTML = "";
  const snapshot = await getDocs(collection(db, "tasks"));

  let grouped = {};

  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    if (!grouped[d.assignedTo]) grouped[d.assignedTo] = [];
    grouped[d.assignedTo].push({ id: docSnap.id, ...d });
  });

  Object.keys(grouped).forEach(emp => {

    let tasks = grouped[emp];
    let active = tasks.filter(t => t.status !== "completed");

    let color = active.length > 5 ? "red" : active.length > 2 ? "yellow" : "green";

    const card = document.createElement("div");
    card.className = "card " + color;

    let html = `<div class="employee">${emp}</div>`;

    const sections = { overdue: [], today: [], tomorrow: [], upcoming: [] };

    tasks.forEach(t => {
      const diff = Math.ceil((t.dueDate.toDate() - new Date())/(1000*60*60*24));

      if (diff < 0) sections.overdue.push(t);
      else if (diff === 0) sections.today.push(t);
      else if (diff === 1) sections.tomorrow.push(t);
      else sections.upcoming.push(t);
    });

    const order = ["overdue","today","tomorrow","upcoming"];

    order.forEach(sec => {

      if (sections[sec].length === 0) return;

      html += `<div class="section">${sec.toUpperCase()}</div>`;

      sections[sec]
        .sort((a,b)=>{
          const pr = {p1:1,p2:2,p3:3,p4:4};
          return pr[a.priority]-pr[b.priority];
        })
        .forEach((t,i)=>{

          const style = t.status==="completed" ? "text-decoration:line-through;opacity:0.6;" : "";

          html += `
          <span style="${style}" onclick="editTask('${t.id}')">
          ${i+1}.
          <input type="checkbox"
          ${t.status==="completed"?"checked":""}
          onchange="toggleTask('${t.id}',this.checked)">
          ${getFlag(t.priority)}
          ${t.title}
          </span><br>`;
        });
    });

    card.innerHTML = html;
    dashboard.appendChild(card);
  });
}

// Toggle
window.toggleTask = async function(id,checked){

  await updateDoc(doc(db,"tasks",id),{
    status: checked?"completed":"pending"
  });

  loadTasks();

  if(checked){
    setTimeout(async()=>{
      const snapshot = await getDocs(collection(db,"tasks"));
      let t;
      snapshot.forEach(d=>{ if(d.id===id) t={id:d.id,...d.data()}; });

      if(!t || t.status!=="completed") return;

      if(t.repeat!=="none"){
        let next=new Date(t.dueDate.toDate());
        if(t.repeat==="daily") next.setDate(next.getDate()+1);
        else if(t.repeat==="weekly") next.setDate(next.getDate()+7);
        else next.setDate(next.getDate()+parseInt(t.repeat));

        await addDoc(collection(db,"tasks"),{
          ...t,
          dueDate:next,
          status:"pending"
        });
      }

      loadTasks();

    },1500);
  }
};

loadTasks();
