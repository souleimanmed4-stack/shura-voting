// إعداد الاتصال بقاعدة بيانات منصة الشورى
const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";

const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// عناصر الصفحة
const loginPanel = document.getElementById("login-panel");
const dashboard = document.getElementById("dashboard");

const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");

const electionForm = document.getElementById("election-form");
const electionMessage = document.getElementById("election-message");

const electionsList = document.getElementById("elections-list");
const adminEmail = document.getElementById("admin-email");

const signoutButton = document.getElementById("signout");

// عرض الرسائل
function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.className = isError ? "message error" : "message success";
}

// التحقق من صلاحية المشرف
async function checkAdmin() {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData.session) {
    showLogin();
    return;
  }

  const user = sessionData.session.user;

  const { data: admin, error } = await supabase
    .from("admin_access")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !admin ||
      !["super_admin", "committee"].includes(admin.role)) {
    await supabase.auth.signOut();
    showLogin();
    showMessage(
      loginMessage,
      "هذا الحساب غير مصرح له بدخول لوحة الإدارة.",
      true
    );
    return;
  }

  loginPanel.hidden = true;
  dashboard.hidden = false;
  adminEmail.textContent = user.email || "";

  await loadElections();
}

// إظهار صفحة الدخول
function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}

// تسجيل الدخول
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  showMessage(loginMessage, "جارٍ التحقق من البيانات...");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showMessage(
      loginMessage,
      "تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.",
      true
    );
    return;
  }

  await checkAdmin();
});

// تحميل الانتخابات
async function loadElections() {
  electionsList.textContent = "جارٍ تحميل الانتخابات...";

  const { data, error } = await supabase
    .from("elections")
    .select("id, title, description, status, is_published, starts_at, ends_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    electionsList.textContent = "تعذر تحميل الانتخابات.";
    return;
  }

  if (!data || data.length === 0) {
    electionsList.textContent = "لا توجد انتخابات مسجلة حتى الآن.";
    return;
  }

  electionsList.replaceChildren();

  data.forEach((election) => {
    const item = document.createElement("article");
    item.className = "election-item";

    const title = document.createElement("h3");
    title.textContent = election.title;

    const status = document.createElement("p");
    status.textContent = "الحالة: " + election.status;

    const publication = document.createElement("p");
    publication.textContent = election.is_published
      ? "منشورة"
      : "غير منشورة";

    item.append(title, status, publication);
    electionsList.appendChild(item);
  });
}

// إنشاء انتخابات جديدة كمسودة
electionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();

  if (!title) {
    showMessage(electionMessage, "يرجى إدخال عنوان الانتخابات.", true);
    return;
  }

  showMessage(electionMessage, "جارٍ حفظ المسودة...");

  const { error } = await supabase
    .from("elections")
    .insert({
      title,
      description: description || null
    });

  if (error) {
    showMessage(
      electionMessage,
      "تعذر حفظ المسودة: " + error.message,
      true
    );
    return;
  }

  electionForm.reset();

  showMessage(electionMessage, "تم حفظ الانتخابات كمسودة بنجاح.");

  await loadElections();
});

// تسجيل الخروج
signoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

// متابعة حالة الجلسة
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    showLogin();
  }
});

// التحقق عند فتح الصفحة
checkAdmin();
