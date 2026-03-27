import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlfhXKGJyVJ5NiolhEJQ8aIfp27xScewM",
  authDomain: "task-manager-app-86f59.firebaseapp.com",
  projectId: "task-manager-app-86f59",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
