import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const dashboard = document.getElementById("dashboard");

window.addTask = async function () {
  const task = document.getElementById("task").value;
  const priority = document.getElementById("priority").value;
  const employee = document.getElementById("employee").value;
  const days = parseInt(document.getElementById("days").value);

  if (!task || !employee || !days || days <= 0) {
    alert("Please fill all fields correctly");
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  await addDoc(collection(db, "tasks"), {
    title: task,
    priority,
    assignedTo: employee,
    dueDate,
    status: "pending",
    createdAt: new Date()
  });

  loadTasks();
};

async function loadTasks() {
  dashboard.innerHTML = "";
  const snapshot = await getDocs(collection(db, "tasks"));

  let grouped = {};

  snapshot.forEach(docSnap => {
    const data = docSnap.data();

    // Only show pending
    if (data.status === "completed") return;

    if (!grouped[data.assignedTo]) grouped[data.assignedTo] = [];
    grouped[data.assignedTo].push({ id: docSnap.id, ...data });
  });

  Object.keys(grouped).forEach(emp => {
    const tasks = grouped[emp];

    let overdue = 0;
    let oldest = 0;

    tasks.forEach(t => {
      if (t.dueDate && t.dueDate.toDate) {
        const delay = Math.floor((new Date() - t.dueDate.toDate()) / (1000*60*60*24));
        if (delay > 0) {
          overdue++;
          if (delay > oldest) oldest = delay;
        }
      }
    });

    // Workload color logic
    let colorClass = "green";
    if (tasks.length > 5) colorClass = "red";
    else if (tasks.length > 2) colorClass = "yellow";

    const card = document.createElement("div");
    card.className = "card " + colorClass;

    let content = `
      <div class="employee">${emp}</div>
      <div class="summary">
        Pending: ${tasks.length} | Overdue: ${overdue} | Oldest: ${oldest} days
      </div>
    `;

    tasks.forEach(task => {
      let delay = 0;
      if (task.dueDate && task.dueDate.toDate) {
        delay = Math.floor((new Date() - task.dueDate.toDate()) / (1000*60*60*24));
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
}

window.completeTask = async function(id) {
  await updateDoc(doc(db, "tasks", id), {
    status: "completed"
  });
  loadTasks();
};

loadTasks();
