
const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

const $ = (id) => document.getElementById(id);

let db = null;
let loginBusy = false;

const msg = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

// ربط نموذج الدخول أولاً لمنع إعادة تحميل الصفحة
const loginForm = $("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (loginBusy) return;

    if (!db) {
      msg("login-message", "تعذر تحميل الاتصال بقاعدة البيانات. أعد تحميل الصفحة.");
      return;
    }

    loginBusy = true;

    const button = loginForm.querySelector('button[type="submit"], button');
    if (button) {
      button.disabled = true;
      button.textContent = "جارٍ التحقق...";
    }

    msg("login-message", "جارٍ تسجيل الدخول...");

    try {
      const { error } = await db.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });

      if (error) {
        msg("login-message", "تعذر تسجيل الدخول: " + error.message);
        return;
      }

      await check();
    } catch (error) {
      msg("login-message", "حدث خطأ: " + error.message);
    } finally {
      loginBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = "تسجيل الدخول";
      }
    }
  });
}

// إنشاء اتصال Supabase بعد ربط نموذج الدخول
try {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("مكتبة Supabase لم يتم تحميلها.");
  }

  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (error) {
  console.error(error);
  msg("login-message", error.message);
}

async function check() {
  if (!db) return;

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
      $("login-panel").hidden = false;
      $("dashboard").hidden = true;
      msg("login-message", "هذا الحساب غير مخول بدخول لوحة الإدارة.");
      return;
    }

    $("login-panel").hidden = true;
    $("dashboard").hidden = false;
    $("admin-email").textContent = session.user.email;

    await load();

  } catch (error) {
    console.error(error);
    $("login-panel").hidden = false;
    $("dashboard").hidden = true;
    msg("login-message", "حدث خطأ أثناء التحقق: " + error.message);
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

  for (const election of data || []) {
    $("item-election").add(
      new Option(election.title, election.id)
    );

    const card = document.createElement("article");
    card.className = "entry";

    const heading = document.createElement("h3");
    heading.textContent = election.title + " · " + election.status;
    card.append(heading);

    const { data: items, error: itemError } = await db
      .from("election_items")
      .select("id,title,item_type,is_active")
      .eq("election_id", election.id)
      .order("sort_order");

    if (itemError) {
      card.append(itemError.message);
    } else {
      for (const item of items || []) {
        const paragraph = document.createElement("p");

        paragraph.textContent =
          (item.is_active ? "● " : "○ ") +
          item.title +
          " (" + item.item_type + ")";

        card.append(paragraph);

        const { data: options } = await db
          .from("election_item_options")
          .select("label")
          .eq("item_id", item.id)
          .order("sort_order");

        const small = document.createElement("small");

        small.textContent = (options || [])
          .map(option => option.label)
          .join(" · ");

        card.append(small);
      }
    }

    $("elections-list").append(card);
  }
}

// إنشاء انتخابات
$("election-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const { error } = await db.from("elections").insert({
    title: $("title").value.trim(),
    description: $("description").value.trim() || null
  });

  msg(
    "election-message",
    error ? error.message : "تم حفظ الانتخابات كمسودة."
  );

  if (!error) {
    event.target.reset();
    await load();
  }
});

// إضافة بند تصويت
$("item-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const election_id = $("item-election").value;
  const item_type = $("item-type").value;
  const title = $("item-title").value.trim();
  const body = $("item-body").value.trim();

  let labels = $("item-options").value
    .split("\n")
    .map(value => value.trim())
    .filter(Boolean);

  if (!labels.length && item_type !== "person") {
    labels = ["موافق", "غير موافق", "ممتنع"];
  }

  if (!election_id || !title || !labels.length) {
    msg("item-message", "اختر الانتخابات والعنوان وأدخل خيارات البند.");
    return;
  }

  if (new Set(labels).size !== labels.length) {
    msg("item-message", "توجد خيارات مكررة.");
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
    msg("item-message", error.message);
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
    msg(
      "item-message",
      "تم إنشاء البند لكن فشل حفظ الخيارات: " + optionError.message
    );
    return;
  }

  msg("item-message", "تم حفظ البند وخياراته.");
  event.target.reset();
  await load();
});

// تسجيل الخروج
$("signout").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();

  if (error) {
    alert(error.message);
    return;
  }

  await check();
});

// فحص الجلسة عند فتح الصفحة
if (db) {
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      $("login-panel").hidden = false;
      $("dashboard").hidden = true;
    }
  });

  check();
}
