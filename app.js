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

// Highlight employee
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
  const repeat = document.getElementById("repeat").value;
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
      repeat,
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
      repeat,
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

  setTimeout(() => highlightEmployee(task.assignedTo), 100);

  document.getElementById("task").value = task.title;
  document.getElementById("priority").value = task.priority;
  document.getElementById("repeat").value = task.repeat || "none";

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

  let grouped = {};

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (data.status === "completed") return;

    if (!grouped[data.assignedTo]) grouped[data.assignedTo] = {};
    if (!grouped[data.assignedTo][data.department])
      grouped[data.assignedTo][data.department] = [];

    grouped[data.assignedTo][data.department].push({ id: docSnap.id, ...data });
  });

  Object.keys(grouped).forEach(emp => {

    let allTasks = Object.values(grouped[emp]).flat();

    // Workload color
    let color = "green";
    if (allTasks.length > 5) color = "red";
    else if (allTasks.length > 2) color = "yellow";

    const card = document.createElement("div");
    card.className = "card " + color;

    let content = `<div class="employee">${emp}</div>`;

    Object.keys(grouped[emp]).forEach(dept => {

      content += `<b>${dept.toUpperCase()}</b><br>`;

      let count = 1;

      grouped[emp][dept].forEach(task => {

        const due = task.dueDate.toDate();
        const diff = Math.ceil((due - new Date()) / (1000*60*60*24));

        let label = "Today";
        if (diff === 1) label = "Tomorrow";
        else if (diff > 1) label = "In " + diff + " days";

        let colorText = task.priority === "high" ? "red" :
                        task.priority === "medium" ? "orange" : "green";

        content += `
          ${count}. 
          <input type="checkbox" onchange="completeTask('${task.id}')">

          ${task.title}
          <span style="color:${colorText}">(${task.priority})</span>
          (${label})

          <span style="cursor:pointer;" onclick='editTask(${JSON.stringify(task)})'>✏️</span>
          <br>
        `;

        count++;
      });
    });

    card.innerHTML = content;
    dashboard.appendChild(card);
  });
}

// Complete Task
window.completeTask = async function (id) {

  const snapshot = await getDocs(collection(db, "tasks"));
  let currentTask;

  snapshot.forEach(d => {
    if (d.id === id) currentTask = { id: d.id, ...d.data() };
  });

  await updateDoc(doc(db, "tasks", id), {
    status: "completed"
  });

  // Recurring
  if (currentTask.repeat && currentTask.repeat !== "none") {

    let nextDate = new Date(currentTask.dueDate.toDate());

    if (currentTask.repeat === "daily") nextDate.setDate(nextDate.getDate() + 1);
    else if (currentTask.repeat === "weekly") nextDate.setDate(nextDate.getDate() + 7);
    else nextDate.setDate(nextDate.getDate() + parseInt(currentTask.repeat));

    await addDoc(collection(db, "tasks"), {
      ...currentTask,
      dueDate: nextDate,
      status: "pending",
      createdAt: new Date()
    });
  }

  loadTasks();
};

loadTasks();
