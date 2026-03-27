import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const employeesMap = {
  child: ["Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"],
  oral: ["Dr Harshitha", "Nethra"],
  ci: ["Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"]
};

const dashboard = document.getElementById("dashboard");

let editMode = false;
let editId = null;

// Load employees
document.getElementById("department").addEventListener("change", loadEmployees);

function loadEmployees() {
  const dept = document.getElementById("department").value;
  const empSelect = document.getElementById("employee");

  empSelect.innerHTML = '<option value="">Select Employee</option>';

  if (!dept) return;

  employeesMap[dept].forEach(emp => {
    const option = document.createElement("option");
    option.value = emp;
    option.textContent = emp;
    empSelect.appendChild(option);
  });
}

// Add or Update Task
window.addTask = async function () {
  const department = document.getElementById("department").value;
  const employee = document.getElementById("employee").value;
  const task = document.getElementById("task").value;
  const priority = document.getElementById("priority").value;
  const days = parseInt(document.getElementById("days").value);

  if (!department || !employee || !task || !days) {
    alert("Fill all fields");
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  if (editMode) {
    // UPDATE
    await updateDoc(doc(db, "tasks", editId), {
      department,
      assignedTo: employee,
      title: task,
      priority,
      dueDate
    });

    editMode = false;
    editId = null;
    document.querySelector("button").innerText = "Add Task";

  } else {
    // ADD
    await addDoc(collection(db, "tasks"), {
      department,
      assignedTo: employee,
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

// Fill form for editing
window.editTask = function (task) {
  document.getElementById("department").value = task.department;
  loadEmployees();

  setTimeout(() => {
    document.getElementById("employee").value = task.assignedTo;
  }, 100);

  document.getElementById("task").value = task.title;
  document.getElementById("priority").value = task.priority;

  const today = new Date();
  const due = task.dueDate.toDate();
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  document.getElementById("days").value = diff > 0 ? diff : 1;

  editMode = true;
  editId = task.id;

  document.querySelector("button").innerText = "Update Task";
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
    const deptDiv = document.createElement("div");
    deptDiv.className = "department";
    deptDiv.innerHTML = dept.toUpperCase();
    dashboard.appendChild(deptDiv);

    Object.keys(grouped[dept]).forEach(emp => {
      const tasks = grouped[dept][emp];

      const card = document.createElement("div");
      card.className = "card";

      let content = `<div class="employee">${emp}</div>`;

      tasks.forEach(task => {
        const delay = Math.floor(
          (new Date() - task.dueDate.toDate()) / (1000 * 60 * 60 * 24)
        );

        content += `
          <div class="task">
            ${task.title} (${task.priority})<br>
            Delay: ${delay > 0 ? delay + " days" : "On time"}<br>

            <button onclick='editTask(${JSON.stringify(task)})'>Edit</button>
            <button onclick="completeTask('${task.id}')">Done</button>
          </div>
        `;
      });

      card.innerHTML = content;
      dashboard.appendChild(card);
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
