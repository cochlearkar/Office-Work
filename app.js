import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const taskList = document.getElementById("taskList");

window.addTask = async function () {
  const task = document.getElementById("task").value;
  const priority = document.getElementById("priority").value;
  const employee = document.getElementById("employee").value;
  const days = document.getElementById("days").value;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + parseInt(days));

  await addDoc(collection(db, "tasks"), {
    title: task,
    priority: priority,
    assignedTo: employee,
    dueDate: dueDate,
    status: "pending",
    createdAt: new Date()
  });

  alert("Task Added");
  loadTasks();
};

async function loadTasks() {
  taskList.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "tasks"));

  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();

    const li = document.createElement("li");

    const delay = Math.floor(
      (new Date() - data.dueDate.toDate()) / (1000 * 60 * 60 * 24)
    );

    li.innerHTML = `
      <b>${data.title}</b> 
      (${data.priority}) 
      - ${data.assignedTo}
      - Delay: ${delay > 0 ? delay + " days" : "On time"}
      <button onclick="completeTask('${docSnap.id}')">Done</button>
    `;

    taskList.appendChild(li);
  });
}

window.completeTask = async function (id) {
  const ref = doc(db, "tasks", id);
  await updateDoc(ref, {
    status: "completed",
    completedAt: new Date()
  });
  loadTasks();
};

loadTasks();
