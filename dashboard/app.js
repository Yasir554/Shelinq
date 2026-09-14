const API_BASE = "https://your-worker-name.yourname.workers.dev";

let authToken = sessionStorage.getItem("shelinq_token") || null;

const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const passwordInput = document.getElementById("password-input");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const togglePasswordBtn = document.getElementById("toggle-password");
const eyeOpen = document.getElementById("eye-open");
const eyeClosed = document.getElementById("eye-closed");

const titleInput = document.getElementById("title-input");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const uploadStatus = document.getElementById("upload-status");
const booksList = document.getElementById("books-list");

const editModal = document.getElementById("edit-modal");
const editTitleInput = document.getElementById("edit-title-input");
const editFileInput = document.getElementById("edit-file-input");
const editCancelBtn = document.getElementById("edit-cancel-btn");
const editSaveBtn = document.getElementById("edit-save-btn");

const confirmModal = document.getElementById("confirm-modal");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmOkBtn = document.getElementById("confirm-ok-btn");

let editingSlug = null;
let confirmCallback = null;

// ---------- INIT ----------

if (authToken) {
  showDashboard();
}

// ---------- LOGIN ----------

loginBtn.addEventListener("click", handleLogin);
passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});

togglePasswordBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  eyeOpen.classList.toggle("hidden", isPassword);
  eyeClosed.classList.toggle("hidden", !isPassword);
});

async function handleLogin() {
  const password = passwordInput.value.trim();
  if (!password) return;

  loginError.textContent = "";
  loginBtn.textContent = "Logging in...";

  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = "Incorrect password.";
      loginBtn.textContent = "Log In";
      return;
    }

    authToken = data.token;
    sessionStorage.setItem("shelinq_token", authToken);
    passwordInput.value = "";
    showDashboard();
  } catch (err) {
    loginError.textContent = "Something went wrong. Try again.";
  }

  loginBtn.textContent = "Log In";
}

function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
  loadBooks();
}

logoutBtn.addEventListener("click", () => {
  authToken = null;
  sessionStorage.removeItem("shelinq_token");
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
});

// ---------- UPLOAD ----------

uploadBtn.addEventListener("click", async () => {
  const title = titleInput.value.trim();
  const file = fileInput.files[0];

  if (!title || !file) {
    uploadStatus.textContent = "Please add a title and choose a PDF.";
    return;
  }

  uploadStatus.textContent = "Uploading...";
  uploadBtn.disabled = true;

  const formData = new FormData();
  formData.append("title", title);
  formData.append("file", file);

  try {
    const res = await fetch(`${API_BASE}/api/books/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData
    });

    if (res.status === 401) {
      handleSessionExpired();
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      uploadStatus.textContent = data.error || "Upload failed.";
      showToast(data.error || "Upload failed.", true);
    } else {
      uploadStatus.textContent = "Uploaded!";
      titleInput.value = "";
      fileInput.value = "";
      showToast("Book uploaded successfully.");
      loadBooks();
    }
  } catch (err) {
    uploadStatus.textContent = "Something went wrong.";
    showToast("Something went wrong.", true);
  }

  uploadBtn.disabled = false;
});

// ---------- LOAD BOOKS ----------

async function loadBooks() {
  try {
    const res = await fetch(`${API_BASE}/api/books`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (res.status === 401) {
      handleSessionExpired();
      return;
    }

    const books = await res.json();
    renderBooks(books);
  } catch (err) {
    booksList.innerHTML = `<tr class="empty-row"><td colspan="5">Couldn't load books.</td></tr>`;
  }
}

function renderBooks(books) {
  if (!books.length) {
    booksList.innerHTML = `<tr class="empty-row"><td colspan="5">No books yet. Upload your first one above.</td></tr>`;
    return;
  }

  booksList.innerHTML = "";

  books.forEach((book) => {
    const redirectUrl = `${API_BASE}/b/${book.slug}`;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="book-title">${escapeHtml(book.title)}</td>
      <td>${new Date(book.created_at).toLocaleDateString()}</td>
      <td class="qr-cell"><div id="qr-${book.slug}"></div></td>
      <td>
        <div class="link-cell">
          <span class="link-text">${redirectUrl}</span>
          <button class="secondary" data-action="copy" data-slug="${book.slug}">Copy</button>
        </div>
      </td>
      <td class="actions-cell">
        <button class="secondary" data-action="download" data-slug="${book.slug}">QR</button>
        <button class="secondary" data-action="edit" data-slug="${book.slug}" data-title="${escapeHtml(book.title)}">Edit</button>
        <button class="danger" data-action="delete" data-slug="${book.slug}">Delete</button>
      </td>
    `;

    booksList.appendChild(row);

    new QRCode(document.getElementById(`qr-${book.slug}`), {
      text: redirectUrl,
      width: 100,
      height: 100
    });
  });

  attachRowListeners();
}

function attachRowListeners() {
  document.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => openDeleteConfirm(btn.dataset.slug));
  });

  document.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.slug, btn.dataset.title));
  });

  document.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener("click", () => downloadQR(btn.dataset.slug));
  });

  document.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    btn.addEventListener("click", () => copyLink(btn.dataset.slug, btn));
  });
}

// ---------- COPY LINK ----------

function copyLink(slug, btn) {
  const link = `${API_BASE}/b/${slug}`;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link).then(() => flashCopied(btn));
  } else {
    const temp = document.createElement("textarea");
    temp.value = link;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
    flashCopied(btn);
  }
}

function flashCopied(btn) {
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = original), 1500);
}

// ---------- DELETE (via modal) ----------

function openDeleteConfirm(slug) {
  confirmTitle.textContent = "Delete this book?";
  confirmMessage.textContent = "The QR code will stop working immediately. This can't be undone from the dashboard.";
  confirmModal.classList.remove("hidden");

  confirmCallback = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/books/${slug}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (res.status === 401) {
        handleSessionExpired();
        return;
      }

      showToast("Book deleted.");
      loadBooks();
    } catch (err) {
      showToast("Couldn't delete book.", true);
    }
  };
}

confirmOkBtn.addEventListener("click", () => {
  confirmModal.classList.add("hidden");
  if (confirmCallback) confirmCallback();
});

confirmCancelBtn.addEventListener("click", () => {
  confirmModal.classList.add("hidden");
  confirmCallback = null;
});

// ---------- EDIT (via modal) ----------

function openEditModal(slug, currentTitle) {
  editingSlug = slug;
  editTitleInput.value = currentTitle || "";
  editFileInput.value = "";
  editModal.classList.remove("hidden");
}

editCancelBtn.addEventListener("click", () => {
  editModal.classList.add("hidden");
  editingSlug = null;
});

editSaveBtn.addEventListener("click", async () => {
  const newTitle = editTitleInput.value.trim();
  const newFile = editFileInput.files[0];

  if (!newTitle && !newFile) {
    showToast("Nothing to update.", true);
    return;
  }

  editSaveBtn.disabled = true;
  editSaveBtn.textContent = "Saving...";

  const formData = new FormData();
  if (newTitle) formData.append("title", newTitle);
  if (newFile) formData.append("file", newFile);

  try {
    const res = await fetch(`${API_BASE}/api/books/${editingSlug}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData
    });

    if (res.status === 401) {
      handleSessionExpired();
      return;
    }

    if (!res.ok) {
      showToast("Couldn't update book.", true);
    } else {
      showToast("Book updated.");
      editModal.classList.add("hidden");
      loadBooks();
    }
  } catch (err) {
    showToast("Something went wrong.", true);
  }

  editSaveBtn.disabled = false;
  editSaveBtn.textContent = "Save Changes";
});

// ---------- DOWNLOAD QR ----------

function downloadQR(slug) {
  const qrDiv = document.getElementById(`qr-${slug}`);
  const qrCanvas = qrDiv.querySelector("canvas");
  const qrImg = qrDiv.querySelector("img");

  if (qrCanvas) {
    const link = document.createElement("a");
    link.download = `${slug}-qr.png`;
    link.href = qrCanvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else if (qrImg) {
    fetch(qrImg.src)
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${slug}-qr.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
  } else {
    showToast("QR code not ready yet.", true);
  }
}

// ---------- TOASTS ----------

function showToast(message, isError = false) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast" + (isError ? " error" : "");
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ---------- HELPERS ----------

function handleSessionExpired() {
  authToken = null;
  sessionStorage.removeItem("shelinq_token");
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginError.textContent = "Session expired. Please log in again.";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}