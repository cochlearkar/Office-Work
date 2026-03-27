import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const employeesMap = {
  child: ["Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"],
  oral: ["Dr Harshitha", "Nethra"],
  ci: ["Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"]
};

let selectedDept = "";
let selectedEmployee = "";
let editMode = false;
let editId = null;

const dashboard = document.getElementById("dashboard");
const empDiv = document.getElementById("employees");
const mainBtn = document.getElementById("mainBtn");

// Department selection
window.selectDepartment = function (dept) {
  selectedDept = dept;
  selectedEmployee = "";

  empDiv.innerHTML = "<b>Select Employee:</b><br>";

  employeesMap[dept].forEach(emp => {
    const btn = document.createElement("button");
    btn.innerText = emp;
    btn.onclick = () => {
      selectedEmployee = emp;
      highlightEmployee(emp);
    };
    empDiv.appendChild(btn);
  });
};

// Highlight
function highlightEmployee(emp) {
  const buttons = empDiv.querySelectorAll("button");
  buttons.forEach(btn => {
    btn.style.background = btn.innerText === emp ? "lightgreen" : "";
  });
}

// Add / Update
window.addTask = async function () {
  const task = document.getElementById("task").value;
  const priority = document.getElementById("priority").value;
  const days = parseInt(document.getElementById("days").value);

  if (!selectedDept || !selectedEmployee || !task || !days) {
    alert("Fill all fields");
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  if (editMode) {
    await updateDoc(doc(db, "tasks", editId), {
      department: selectedDept,
      assignedTo: selectedEmployee,
      title: task,
      priority,
      dueDate
    });

    editMode = false;
    editId = null;
    mainBtn.innerText = "Add Task";

  } else {
    await addDoc(collection(db, "tasks"), {
      department: selectedDept,
      assignedTo: selectedEmployee,
      title: task,
      priority,
      dueDate,
      status: "pending",
      createdAt: new Date()
    });
  }

  clearForm();
  loadTasks();
};

// Edit
window.editTask = function (task) {
  selectedDept = task.department;
  selectedEmployee = task.assignedTo;

  selectDepartment(task.department);

  setTimeout(() => highlightEmployee(task.assignedTo), 100);

  document.getElementById("task").value = task.title;
  document.getElementById("priority").value = task.priority;

  const today = new Date();
  const due = task.dueDate.toDate();
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  document.getElementById("days").value = diff > 0 ? diff : 1;

  editMode = true;
  editId = task.id;
  mainBtn.innerText = "Update Task";
};

// Clear
function clearForm() {
  document.getElementById("task").value = "";
  document.getElementById("days").value = "";
}

// Convert days to label
function getDayLabel(dueDate) {
  const today = new Date();
  const diff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return "In " + diff + " days";
}

// Priority color
function getPriorityColor(priority) {
  if (priority === "high") return "red";
  if (priority === "medium") return "orange";
  return "green";
}

// Load Tasks
async function loadTasks() {
  dashboard.innerHTML = "";
  const snapshot = await getDocs(collection(db, "tasks"));

  let grouped = {};

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (data.status === "completed") return;

    if (!grouped[data.department]) grouped[data.department] = {};
    if (!grouped[data.department][data.assignedTo])
      grouped[data.department][data.assignedTo] = [];

    grouped[data.department][data.assignedTo].push({ id: docSnap.id, ...data });
  });

  Object.keys(grouped).forEach(dept => {

    const deptTitle = document.createElement("div");
    deptTitle.innerHTML = "<b>" + dept.toUpperCase() + "</b><br>";
    dashboard.appendChild(deptTitle);

    Object.keys(grouped[dept]).forEach(emp => {

      const empTitle = document.createElement("div");
      empTitle.innerHTML = "<b>" + emp + "</b>";
      dashboard.appendChild(empTitle);

      grouped[dept][emp].forEach(task => {
        const due = task.dueDate.toDate();
        const dayLabel = getDayLabel(due);
        const color = getPriorityColor(task.priority);

        const row = document.createElement("div");

        row.innerHTML = `
          ${task.title} 
          <span style="color:${color}">(${task.priority})</span> 
          (${dayLabel})
          
          <button onclick='editTask(${JSON.stringify(task)})'>Edit</button>
          <button onclick="completeTask('${task.id}')">Done</button>
        `;

        dashboard.appendChild(row);
      });

      dashboard.appendChild(document.createElement("hr"));
    });
  });
}

// Complete
window.completeTask = async function (id) {
  await updateDoc(doc(db, "tasks", id), {
    status: "completed"
  });
  loadTasks();
};

loadTasks();
