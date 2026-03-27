import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Department → Employees mapping
const employeesMap = {
  child: ["Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"],
  oral: ["Dr Harshitha", "Nethra"],
  ci: ["Dr Vanitha B", "Mr Madhukar", "Miss Sumayya", "Miss Manjula"]
};

const dashboard = document.getElementById("dashboard");

// ✅ Attach event listener properly (fix for your error)
document.getElementById("department").addEventListener("change", loadEmployees);

// Load employees based on department
function loadEmployees() {
  const dept = document.getElementById("department").value;
  const empSelect = document.getElementById("employee");

  empSelect.innerHTML = '<option value="">Select Employee</option>';

  if (!dept) return;

  const list = employeesMap[dept] || [];

  list.forEach(emp => {
    const option = document.createElement("option");
    option.value = emp;
    option.textContent = emp;
    empSelect.appendChild(option);
  });
}

// Add Task
window.addTask = async function () {
  const department = document.getElementById("department").value;
  const employee = document.getElementById("employee").value;
  const task = document.getElementById("task").value;
  const priority = document.getElementById("priority").value;
  const days = parseInt(document.getElementById("days").value);

  if (!department || !employee || !task || !days || days <= 0) {
    alert("Please fill all fields correctly");
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  await addDoc(collection(db, "tasks"), {
    department,
    assignedTo: employee,
    title: task,
    priority,
    dueDate,
    status: "pending",
    createdAt: new Date()
  });

  loadTasks();
};

// Load Tasks (Department → Employee grouping)
async function loadTasks() {
  dashboard.innerHTML = "";
  const snapshot = await getDocs(collection(db, "tasks"));

  let grouped = {};

  snapshot.forEach(docSnap => {
    const data = docSnap.data();

    // Only show pending
    if (data.status === "completed") return;

    if (!grouped[data.department]) grouped[data.department] = {};
    if (!grouped[data.department][data.assignedTo])
      grouped[data.department][data.assignedTo] = [];

    grouped[data.department][data.assignedTo].push({ id: docSnap.id, ...data });
  });

  Object.keys(grouped).forEach(dept => {
    // Department title
    const deptDiv = document.createElement("div");
    deptDiv.className = "department";
    deptDiv.innerHTML = dept.toUpperCase();
    dashboard.appendChild(deptDiv);

    Object.keys(grouped[dept]).forEach(emp => {
      const tasks = grouped[dept][emp];

      let overdue = 0;
      let oldest = 0;

      tasks.forEach(t => {
        if (t.dueDate && t.dueDate.toDate) {
          const delay = Math.floor(
            (new Date() - t.dueDate.toDate()) / (1000 * 60 * 60 * 24)
          );
          if (delay > 0) {
            overdue++;
            if (delay > oldest) oldest = delay;
          }
        }
      });

      // Workload color logic
      let color = "green";
      if (tasks.length > 5) color = "red";
      else if (tasks.length > 2) color = "yellow";

      const card = document.createElement("div");
      card.className = "card " + color;

      let content = `
        <div class="employee">${emp}</div>
        <div class="summary">
          Pending: ${tasks.length} | Overdue: ${overdue} | Oldest: ${oldest} days
        </div>
      `;

      tasks.forEach(task => {
        let delay = 0;

        if (task.dueDate && task.dueDate.toDate) {
          delay = Math.floor(
            (new Date() - task.dueDate.toDate()) / (1000 * 60 * 60 * 24)
          );
        }

        content += `
          <div class="task">
            ${task.title} (${task.priority})<br>
            Delay: ${delay > 0 ? delay + " days" : "On time"}<br>
            <button onclick="completeTask('${task.id}')">Done</button>
          </div>
        `;
      });

      card.innerHTML = content;
      dashboard.appendChild(card);
    });
  });
}

// Complete Task
window.completeTask = async function (id) {
  await updateDoc(doc(db, "tasks", id), {
    status: "completed"
  });
  loadTasks();
};

// Initial load
loadTasks();
