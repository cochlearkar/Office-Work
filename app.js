import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Departments
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

// Select Department
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

// Highlight selected employee
function highlightEmployee(emp) {
  const buttons = empDiv.querySelectorAll("button");
  buttons.forEach(btn => {
    btn.style.background = btn.innerText === emp ? "lightgreen" : "";
  });
}

// Add / Update Task
window.addTask = async function () {
  const task = document.getElementById("task").value;
  const priority = document.getElementById("priority").value;
  const days = parseInt(document.getElementById("days").value);

  if (!selectedDept || !selectedEmployee || !task || !days) {
    alert("Select department, employee and fill all fields");
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

// Edit Task
window.editTask = function (task) {
  selectedDept = task.department;
  selectedEmployee = task.assignedTo;

  selectDepartment(task.department);

  setTimeout(() => {
    highlightEmployee(task.assignedTo);
  }, 100);

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

// Clear form
function clearForm() {
  document.getElementById("task").value = "";
  document.getElementById("days").value = "";
}

// Load Tasks
async function loadTasks() {
  dashboard.innerHTML = "";
  const snapshot = await getDocs(collection(db, "tasks"));

  snapshot.forEach(docSnap => {
    const task = { id: docSnap.id, ...docSnap.data() };
    if (task.status === "completed") return;

    const card = document.createElement("div");
    card.className = "card";

    const delay = Math.floor(
      (new Date() - task.dueDate.toDate()) / (1000 * 60 * 60 * 24)
    );

    card.innerHTML = `
      <b>${task.department.toUpperCase()}</b> - ${task.assignedTo}<br>
      ${task.title} (${task.priority})<br>
      Delay: ${delay > 0 ? delay + " days" : "On time"}<br>

      <button onclick='editTask(${JSON.stringify(task)})'>Edit</button>
      <button onclick="completeTask('${task.id}')">Done</button>
    `;

    dashboard.appendChild(card);
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
