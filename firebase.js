// Firebaseの基本機能をインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebaseの設定
const firebaseConfig = {
  apiKey: "AIzaSyA57yXg46NjGVue3WUK-jbZ68hwQwdLA-g",
  authDomain: "tibiz-a395e.firebaseapp.com",
  projectId: "tibiz-a395e",
  storageBucket: "tibiz-a395e.firebasestorage.app",
  messagingSenderId: "347209039114",
  appId: "1:347209039114:web:0d3ff0477e7bb812210ef3"
};

// Firebaseの初期化
const app = initializeApp(firebaseConfig);

// データベース(Firestore)の準備をして、他のファイルでも使えるように export する
export const db = getFirestore(app);