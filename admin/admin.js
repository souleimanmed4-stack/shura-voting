
// إعداد الاتصال بقاعدة بيانات منصة الشورى
const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

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

function showMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.className = isError ? "message error" : "message success";
}

function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}

// تهيئة الاتصال
let supabaseClient = null;

try {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("لم يتم تحميل مكتبة Supabase. تحقق من اتصال الإنترنت.");
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
} catch (error) {
  console.error(error);
}

// التحقق من صلاحية المشرف
async function checkAdmin() {
  if (!supabaseClient) return;

  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    showLogin();
    return;
  }

  const user = sessionData.session.user;

  const { data: admin, error } = await supabaseClient
    .from("admin_access")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !admin ||
      !["super_admin", "committee"].includes(admin.role)) {
    await supabaseClient.auth.signOut();
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

// تسجيل الدخول
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!supabaseClient) {
    showMessage(
      loginMessage,
      "تعذر الاتصال بمكتبة قاعدة البيانات. أعد تحميل الصفحة أو جرّب شبكة أخرى.",
      true
    );
    return;
  }

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  showMessage(loginMessage, "جارٍ التحقق من البيانات...");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showMessage(loginMessage, "فشل تسجيل الدخول: " + error.message, true);
      return;
    }

    await checkAdmin();
  } catch (error) {
    showMessage(loginMessage, "حدث خطأ أثناء الاتصال: " + error.message, true);
  }
});

// تحميل الانتخابات
async function loadElections() {
  electionsList.textContent = "جارٍ تحميل الانتخابات...";

  const { data, error } = await supabaseClient
    .from("elections")
    .select("id, title, description, status, is_published, starts_at, ends_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    electionsList.textContent = "تعذر تحميل الانتخابات: " + error.message;
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
    publication.textContent = election.is_published ? "منشورة" : "غير منشورة";

    item.append(title, status, publication);
    electionsList.appendChild(item);
  });
}

// إنشاء انتخابات جديدة
electionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = document.getElementById("title").value.trim();
  const description = document.getElementById("description").value.trim();

  if (!title) {
    showMessage(electionMessage, "يرجى إدخال عنوان الانتخابات.", true);
    return;
  }

  showMessage(electionMessage, "جارٍ حفظ المسودة...");

  const { error } = await supabaseClient
    .from("elections")
    .insert({
      title,
      description: description || null
    });

  if (error) {
    showMessage(electionMessage, "تعذر حفظ المسودة: " + error.message, true);
    return;
  }

  electionForm.reset();
  showMessage(electionMessage, "تم حفظ الانتخابات كمسودة بنجاح.");

  await loadElections();
});

// تسجيل الخروج
signoutButton.addEventListener("click", async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  showLogin();
});

// متابعة الجلسة
if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      showLogin();
    }
  });

  checkAdmin();
} else {
  showLogin();
  showMessage(
    loginMessage,
    "تعذر تحميل مكتبة الاتصال. تحقق من الإنترنت ثم أعد تحميل الصفحة.",
    true
  );
}
