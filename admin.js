
const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";
const $ = (id) => document.getElementById(id);

let db = null;
let checking = false;

function showMessage(id, message) {
  const element = $(id);
  if (element) element.textContent = message;
}

function showLoginError(message) {
  showMessage("login-message", message);
  if ($("login-panel")) $("login-panel").hidden = false;
  if ($("dashboard")) $("dashboard").hidden = true;
}

// منع تحديث الصفحة عند إرسال نموذج الدخول
const loginForm = $("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = loginForm.querySelector("button");
    if (button) button.disabled = true;

    try {
      if (!db) {
        showLoginError("تعذر تحميل خدمة تسجيل الدخول. تحقق من اتصال الإنترنت.");
        return;
      }

      const email = $("email").value.trim();
      const password = $("password").value;

      showMessage("login-message", "جارٍ التحقق من بيانات الدخول...");

      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        showLoginError("تعذر تسجيل الدخول: " + error.message);
        return;
      }

      await checkSession();

    } catch (error) {
      showLoginError("حدث خطأ: " + (error.message || "خطأ غير معروف"));
    } finally {
      if (button) button.disabled = false;
    }
  });
}

async function checkSession() {
  if (!db || checking) return;
  checking = true;

  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    const session = data.session;

    if (!session) {
      $("login-panel").hidden = false;
      $("dashboard").hidden = true;
      return;
    }

    const { data: admin, error: adminError } = await db
      .from("admin_access")
      .select("user_id, role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (adminError) throw adminError;

    if (!admin || !["super_admin", "committee"].includes(admin.role)) {
      await db.auth.signOut();
      showLoginError("هذا الحساب غير مخوّل لدخول لوحة الإدارة.");
      return;
    }

    $("login-panel").hidden = true;
    $("dashboard").hidden = false;
    $("admin-email").textContent = session.user.email || "";

    await load();

  } catch (error) {
    showLoginError("تعذر التحقق من الصلاحيات: " + error.message);
  } finally {
    checking = false;
  }
}

async function load() {
  const { data, error } = await db
    .from("elections")
    .select("id,title,status,is_published,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    $("elections-list").textContent = error.message;
    return;
  }

  $("item-election").replaceChildren(
    new Option("اختر الانتخابات", "")
  );

  $("elections-list").replaceChildren();

  for (const e of data || []) {
    $("item-election").add(new Option(e.title, e.id));

    const card = document.createElement("article");
    card.className = "entry";

    const heading = document.createElement("h3");
    heading.textContent = e.title + " · " + e.status;
    card.append(heading);

    const { data: items, error: itemError } = await db
      .from("election_items")
      .select("id,title,item_type,is_active")
      .eq("election_id", e.id)
      .order("sort_order");

    if (itemError) {
      card.append(itemError.message);
    } else {
      for (const item of items || []) {
        const p = document.createElement("p");
        p.textContent =
          (item.is_active ? "● " : "○ ") +
          item.title + " (" + item.item_type + ")";
        card.append(p);

        const { data: options } = await db
          .from("election_item_options")
          .select("label")
          .eq("item_id", item.id)
          .order("sort_order");

        const small = document.createElement("small");
        small.textContent = (options || [])
          .map(x => x.label)
          .join(" · ");

        card.append(small);
      }
    }

    $("elections-list").append(card);
  }
}

$("election-form").onsubmit = async (event) => {
  event.preventDefault();

  const { error } = await db.from("elections").insert({
    title: $("title").value.trim(),
    description: $("description").value.trim() || null
  });

  showMessage(
    "election-message",
    error ? error.message : "تم حفظ الانتخابات كمسودة"
  );

  if (!error) {
    event.target.reset();
    await load();
  }
};

$("item-form").onsubmit = async (event) => {
  event.preventDefault();

  const election_id = $("item-election").value;
  const item_type = $("item-type").value;
  const title = $("item-title").value.trim();
  const body = $("item-body").value.trim();

  let labels = $("item-options").value
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  if (!labels.length && item_type !== "person") {
    labels = ["موافق", "غير موافق", "ممتنع"];
  }

  if (!election_id || !title || !labels.length) {
    showMessage("item-message", "اختر الانتخابات والعنوان وأدخل الخيارات.");
    return;
  }

  if (new Set(labels).size !== labels.length) {
    showMessage("item-message", "توجد خيارات مكررة.");
    return;
  }

  const { data: item, error } = await db
    .from("election_items")
    .insert({
      election_id,
      item_type,
      title,
      body: body || null
    })
    .select("id")
    .single();

  if (error) {
    showMessage("item-message", error.message);
    return;
  }

  const { error: optionError } = await db
    .from("election_item_options")
    .insert(
      labels.map((label, sort_order) => ({
        item_id: item.id,
        label,
        sort_order
      }))
    );

  if (optionError) {
    showMessage("item-message", optionError.message);
    return;
  }

  showMessage("item-message", "تم حفظ البند وخياراته.");
  event.target.reset();
  await load();
};

$("signout").onclick = async () => {
  await db.auth.signOut();
  await checkSession();
};

try {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("لم يتم تحميل مكتبة Supabase.");
  }

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") checkSession();
  });

  checkSession();

} catch (error) {
  showLoginError(error.message);
}
