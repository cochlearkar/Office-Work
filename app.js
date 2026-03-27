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

if (!days || days <= 0) {
  alert("Please enter valid deadline days");
  return;
}

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + parseInt(days));

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
    if (!grouped[data.assignedTo]) grouped[data.assignedTo] = [];
    grouped[data.assignedTo].push({ id: docSnap.id, ...data });
  });

  Object.keys(grouped).forEach(emp => {
    const card = document.createElement("div");
    card.className = "card";

    let content = `<div class="employee">${emp}</div>`;

    grouped[emp].forEach(task => {
      const delay = Math.floor((new Date() - task.dueDate.toDate()) / (1000*60*60*24));

      content += `
        <div class="task ${task.priority}">
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
