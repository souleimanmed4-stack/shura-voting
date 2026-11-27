const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

const $ = id => document.getElementById(id);

let db = null;
let checking = false;
let currentAccess = null;
let electionsCache = [];

const PERMISSIONS = {
  elections_create: "إنشاء الانتخابات",
  elections_edit: "تعديل الانتخابات والبنود",
  voters_manage: "إدارة الأعضاء ورموز العضوية",
  results_view: "عرض النتائج الإجمالية",
  participation_view: "متابعة المشاركة",
  reports_view: "إعداد التقارير"
};

function showMessage(id, message, isError = false) {
  const node = $(id);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", isError);
}

function setVisible(id, visible) {
  const node = $(id);
  if (node) node.hidden = !visible;
}

function hasPermission(permission) {
  if (!currentAccess || !currentAccess.is_active) return false;
  if (currentAccess.role === "super_admin") return true;
  return (currentAccess.permissions || []).includes(permission);
}

function isSuperAdmin() {
  return currentAccess?.role === "super_admin" &&
    currentAccess?.is_active === true;
}

function makeButton(label, handler, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", handler);
  return button;
}

function makeCell(row, value, header = false) {
  const cell = document.createElement(header ? "th" : "td");
  cell.textContent = value == null ? "" : String(value);
  row.append(cell);
  return cell;
}

function makeTable(table, headers, rows) {
  table.replaceChildren();

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach(text => makeCell(headerRow, text, true));
  thead.append(headerRow);

  const tbody = document.createElement("tbody");

  for (const values of rows) {
    const row = document.createElement("tr");
    values.forEach(value => {
      if (value instanceof Node) {
        const cell = document.createElement("td");
        cell.append(value);
        row.append(cell);
      } else {
        makeCell(row, value);
      }
    });
    tbody.append(row);
  }

  table.append(thead, tbody);
}

async function rpc(name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

function showLoginError(message) {
  showMessage("login-message", message, true);
  setVisible("login-panel", true);
  setVisible("dashboard", false);
}

async function checkSession() {
  if (!db || checking) return;
  checking = true;

  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    const session = data.session;

    if (!session) {
      currentAccess = null;
      window.shuraAdminAccess = null;
      setVisible("login-panel", true);
      setVisible("dashboard", false);
      return;
    }

    const accessRows = await rpc("admin_get_my_access");
    const access = Array.isArray(accessRows) ? accessRows[0] : null;

    if (!access || !access.is_active) {
      await db.auth.signOut();
      currentAccess = null;
      window.shuraAdminAccess = null;
      showLoginError("هذا الحساب غير نشط أو غير مخوّل لدخول لوحة الإدارة.");
      return;
    }

    currentAccess = access;
    window.shuraAdminAccess = access;

    setVisible("login-panel", false);
    setVisible("dashboard", true);

    $("admin-email").textContent = session.user.email || "";
    $("admin-role").textContent =
      access.role === "super_admin" ? "المدير العام" :
      access.role === "committee" ? "اللجنة" : "محرر";

    applyPermissions();

    document.dispatchEvent(new Event("shura-admin-ready"));

    await load();
    
    if (isSuperAdmin()) {
  await loadEditors();
}

  } catch (error) {
    showLoginError("تعذر التحقق من الصلاحيات: " + error.message);
  } finally {
    checking = false;
  }
}

function applyPermissions() {
  setVisible("editor-management", isSuperAdmin());

  setVisible(
    "election-create-panel",
    hasPermission("elections_create")
  );

  setVisible(
    "item-create-panel",
    hasPermission("elections_edit")
  );

  setVisible(
    "voter-management-panel",
    hasPermission("voters_manage") ||
    hasPermission("participation_view") ||
    hasPermission("results_view")
  );

  setVisible(
    "central-members-panel",
    hasPermission("voters_manage")
  );

  setVisible(
    "voter-add-area",
    hasPermission("voters_manage")
  );

  setVisible(
    "voter-refresh-area",
    hasPermission("voters_manage") ||
    hasPermission("participation_view") ||
    hasPermission("results_view")
  );

  setVisible(
    "voter-list-area",
    hasPermission("voters_manage")
  );

  setVisible(
    "participation-area",
    hasPermission("participation_view")
  );

  setVisible(
    "results-area",
    hasPermission("results_view")
  );

  setVisible("elections-list-panel", true);
}

/* تحميل الانتخابات */
async function load() {
  const { data, error } = await db
    .from("elections")
    .select("id,title,description,status,is_published,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    $("elections-list").textContent = error.message;
    return;
  }

  electionsCache = data || [];

  ["item-election", "voter-election", "central-member-election"].forEach(id => {
    const select = $(id);
    if (!select) return;

    select.replaceChildren(new Option("اختر الانتخابات", ""));

    electionsCache.forEach(election => {
      select.add(new Option(election.title, election.id));
    });
  });

  const container = $("elections-list");
  container.replaceChildren();

  for (const election of electionsCache) {
    const card = document.createElement("article");
    card.className = "entry";

    const heading = document.createElement("h3");
    heading.textContent =
      election.title + " · " + election.status +
      (election.is_published ? " · منشورة" : " · غير منشورة");

    card.append(heading);

    if (election.description) {
      const description = document.createElement("p");
      description.textContent = election.description;
      card.append(description);
    }

    if (hasPermission("elections_publish")) {
      const publicationButton = makeButton(
        election.is_published ? "إدارة حالة النشر" : "نشر الانتخابات",
        () => changePublication(election)
      );
      card.append(publicationButton);
    }

    const { data: items, error: itemError } = await db
      .from("election_items")
      .select("id,title,item_type,is_active")
      .eq("election_id", election.id)
      .order("sort_order");

    if (itemError) {
      const errorText = document.createElement("p");
      errorText.textContent = itemError.message;
      card.append(errorText);
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
          .map(option => option.label)
          .join(" · ");

        card.append(small);
      }
    }

    container.append(card);
  }
}

/* نشر الانتخابات أو إيقافها */
async function changePublication(election) {
  const action = election.is_published
    ? "إيقاف النشر أو تغيير الحالة"
    : "نشر الانتخابات";

  const choice = prompt(
    action + "\n\nاكتب إحدى الحالات التالية:\n" +
    "open = مفتوحة\npaused = متوقفة مؤقتاً\nclosed = مغلقة\n" +
    (!election.is_published ? "draft = مسودة (لن تُنشر)\n" : "")
  );

  if (choice === null) return;

  const status = choice.trim();

  if (!["draft", "open", "paused", "closed"].includes(status)) {
    alert("الحالة المدخلة غير معتمدة.");
    return;
  }

  const published = status !== "draft";

  if (!confirm(
    "تأكيد تغيير حالة الانتخابات إلى: " + status +
    (published ? " مع النشر؟" : " مع إلغاء النشر؟")
  )) return;

  try {
    await rpc("admin_set_election_publication", {
      p_election_id: election.id,
      p_is_published: published,
      p_status: status
    });

    alert("تم تحديث حالة الانتخابات.");
    await load();
  } catch (error) {
    alert(error.message);
  }
}

/* إنشاء الانتخابات */
if ($("election-form")) {
  $("election-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!hasPermission("elections_create")) {
      showMessage("election-message", "ليس لديك صلاحية إنشاء الانتخابات.", true);
      return;
    }

    try {
      const { error } = await db.from("elections").insert({
        title: $("title").value.trim(),
        description: $("description").value.trim() || null
      });

      if (error) throw error;

      showMessage("election-message", "تم حفظ الانتخابات كمسودة.");
      event.target.reset();
      await load();
    } catch (error) {
      showMessage("election-message", error.message, true);
    }
  });
}

/* إضافة بند وخيارات */
if ($("item-form")) {
  $("item-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!hasPermission("elections_edit")) {
      showMessage("item-message", "ليس لديك صلاحية تعديل البنود.", true);
      return;
    }

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
      showMessage("item-message", "اختر الانتخابات والعنوان وأدخل الخيارات.", true);
      return;
    }

    if (new Set(labels).size !== labels.length) {
      showMessage("item-message", "توجد خيارات مكررة.", true);
      return;
    }

    try {
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

      if (error) throw error;

      const { error: optionError } = await db
        .from("election_item_options")
        .insert(
          labels.map((label, sort_order) => ({
            item_id: item.id,
            label,
            sort_order
          }))
        );

      if (optionError) throw optionError;

      showMessage("item-message", "تم حفظ البند وخياراته.");
      event.target.reset();
      await load();

    } catch (error) {
      showMessage("item-message", error.message, true);
    }
  });
}

/* إضافة عضو */
if ($("voter-form")) {
  $("voter-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!hasPermission("voters_manage")) {
      showMessage("voter-message", "ليس لديك صلاحية إدارة الأعضاء.", true);
      return;
    }

    const electionId = $("voter-election").value;
    const fullName = $("voter-name").value.trim();
    const phone = $("voter-phone").value.trim();

    if (!electionId || !fullName || !phone) {
      showMessage("voter-message", "أكمل بيانات العضو والانتخابات.", true);
      return;
    }

    try {
      const rows = await rpc("admin_add_eligible_voter", {
        p_election_id: electionId,
        p_full_name: fullName,
        p_phone_e164: phone
      });

      const member = Array.isArray(rows) ? rows[0] : rows;

      if (!member) throw new Error("لم يتم إرجاع بيانات العضوية.");

      const result = $("new-code-result");
      result.replaceChildren();
      result.hidden = false;

      const heading = document.createElement("strong");
      heading.textContent = "تمت إضافة العضو بنجاح";

      const name = document.createElement("p");
      name.textContent = "الاسم: " + member.full_name;

      const phoneText = document.createElement("p");
      phoneText.textContent = "الهاتف: " + member.phone_e164;

      const code = document.createElement("p");
      code.textContent = "رمز العضوية: " + member.membership_code;

      const warning = document.createElement("p");
      warning.textContent =
        "احفظ الرمز وسلّمه للعضو بصورة آمنة. لن يظهر كاملاً في قائمة الأعضاء لاحقاً.";

      const copy = makeButton("نسخ الرمز", async () => {
        try {
          await navigator.clipboard.writeText(member.membership_code);
          copy.textContent = "تم النسخ";
        } catch (_) {
          copy.textContent = "تعذر النسخ";
        }
      });

      result.append(heading, name, phoneText, code, warning, copy);

      showMessage("voter-message", "تمت إضافة العضو.");
      event.target.reset();

      await loadVoters();
    } catch (error) {
      showMessage("voter-message", error.message, true);
    }
  });
}

/* قائمة الأعضاء وإجراءات العضوية */
async function loadVoters() {
  if (!hasPermission("voters_manage")) return;

  const electionId = $("voter-election").value;

  if (!electionId) {
    showMessage("voter-message", "اختر الانتخابات أولاً.", true);
    return;
  }

  try {
    const voters = await rpc("admin_list_eligible_voters", {
      p_election_id: electionId
    });

    const rows = (voters || []).map(voter => {
      const state = voter.is_enabled ? "مفعّل" : "معطّل";
      const login = voter.has_logged_in ? "سبق له الدخول" : "لم يسجل الدخول";

      const actions = document.createElement("div");
      actions.className = "table-actions";

      actions.append(
        makeButton(
          voter.is_enabled ? "تعطيل" : "تفعيل",
          () => setVoterEnabled(voter.voter_id, !voter.is_enabled)
        ),
        makeButton(
          "إعادة إصدار الرمز",
          () => resetVoterCode(voter.voter_id)
        )
      );

      return [
        voter.full_name || "—",
        voter.phone_e164 || "—",
        voter.membership_code_hint || "—",
        state,
        login,
        actions
      ];
    });

    makeTable(
      $("voter-table"),
      ["الاسم", "الهاتف", "آخر أرقام الرمز", "الحالة", "الدخول", "الإجراءات"],
      rows
    );

    $("voter-summary").textContent =
      "عدد العضويات: " + rows.length +
      " · المفعّلة: " + voters.filter(v => v.is_enabled).length +
      " · المعطّلة: " + voters.filter(v => !v.is_enabled).length;

    setVisible("voter-list-area", true);
    showMessage("voter-message", "تم تحديث قائمة الأعضاء.");

  } catch (error) {
    showMessage("voter-message", error.message, true);
  }
}

async function setVoterEnabled(voterId, enabled) {
  const action = enabled ? "تفعيل" : "تعطيل";

  if (!confirm("هل تريد " + action + " هذه العضوية؟")) return;

  try {
    await rpc("admin_set_voter_enabled", {
      p_voter_id: voterId,
      p_enabled: enabled
    });

    await loadVoters();
  } catch (error) {
    alert(error.message);
  }
}

async function resetVoterCode(voterId) {
  if (!confirm(
    "سيتم إنشاء رمز جديد وإلغاء صلاحية الرمز السابق. هل تريد المتابعة؟"
  )) return;

  try {
    const rows = await rpc("admin_reset_voter_access", {
      p_voter_id: voterId
    });

    const record = Array.isArray(rows) ? rows[0] : rows;

    if (!record?.membership_code) {
      throw new Error("لم يتم إرجاع الرمز الجديد.");
    }

    alert("رمز العضوية الجديد: " + record.membership_code);
    await loadVoters();
  } catch (error) {
    alert(error.message);
  }
}

if ($("load-voters")) {
  $("load-voters").addEventListener("click", async () => {
    await loadVoters();
    await loadParticipation();
    await loadResults();
  });
}

/* متابعة المشاركة */
async function loadParticipation() {
  if (!hasPermission("participation_view")) return;

  const electionId = $("voter-election").value;
  if (!electionId) return;

  try {
    const data = await rpc("admin_voter_participation", {
      p_election_id: electionId
    });

    const rows = (data || []).map(row => [
      row.full_name || "—",
      row.phone_e164 || "—",
      row.item_title || "—",
      row.has_voted ? "صوّت" : "لم يصوّت",
      row.cast_at ? new Date(row.cast_at).toLocaleString("ar") : "—"
    ]);

    makeTable(
      $("participation-table"),
      ["العضو", "الهاتف", "بند التصويت", "الحالة", "وقت التصويت"],
      rows
    );

    setVisible("participation-area", true);
  } catch (error) {
    showMessage("voter-message", error.message, true);
  }
}

/* النتائج الإجمالية */
async function loadResults() {
  if (!hasPermission("results_view")) return;

  const electionId = $("voter-election").value;
  if (!electionId) return;

  try {
    const data = await rpc("admin_get_election_results", {
      p_election_id: electionId
    });

    const rows = (data || []).map(row => [
      row.item_title,
      row.option_label,
      row.vote_count,
      row.total_votes,
      Number(row.percentage).toFixed(2) + "%"
    ]);

    makeTable(
      $("results-table"),
      ["البند", "الخيار", "الأصوات", "إجمالي الأصوات", "النسبة"],
      rows
    );

    setVisible("results-area", true);
  } catch (error) {
    showMessage("voter-message", error.message, true);
  }
}

/* إدارة المحررين - للمدير العام فقط */
async function loadEditors() {
  if (!isSuperAdmin()) return;

  try {
    const editors = await rpc("admin_list_editors");

    const container = $("editors-list");
    if (!container) return;

    container.replaceChildren();

    for (const editor of editors || []) {
      const card = document.createElement("article");
      card.className = "entry";

      const title = document.createElement("h4");
      title.textContent = editor.email;

      const state = document.createElement("p");
      state.textContent =
        (editor.is_active ? "الحساب نشط" : "الحساب معطّل") +
        " · " + (editor.role || "editor");

      const permissionText = document.createElement("p");
      permissionText.textContent =
        (editor.permissions || [])
          .map(key => PERMISSIONS[key] || key)
          .join("، ") || "لا توجد صلاحيات محددة";

      const toggle = makeButton(
        editor.is_active ? "تعطيل المحرر" : "تفعيل المحرر",
        () => toggleEditor(editor)
      );

      card.append(title, state, permissionText, toggle);
      container.append(card);
    }

    if (!editors || !editors.length) {
      container.textContent = "لا يوجد محررون مسجلون حالياً.";
    }
  } catch (error) {
    showMessage("editor-message", error.message, true);
  }
}

async function toggleEditor(editor) {
  if (!isSuperAdmin()) return;

  const active = !editor.is_active;

  if (!confirm(
    active ? "هل تريد تفعيل هذا المحرر؟" : "هل تريد تعطيل هذا المحرر؟"
  )) return;

  try {
    await rpc("admin_set_editor_active", {
      p_user_id: editor.user_id,
      p_active: active
    });

    await loadEditors();
  } catch (error) {
    alert(error.message);
  }
}

/* إنشاء حساب محرر جديد */
if ($("editor-form")) {
  $("editor-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!isSuperAdmin()) {
      showMessage(
        "editor-message",
        "إنشاء حسابات المحررين متاح للمدير العام فقط.",
        true
      );
      return;
    }

    const email = $("editor-email").value.trim();
    const password = $("editor-password").value;
    const button = $("create-editor-button");

    if (!email || !password) {
      showMessage(
        "editor-message",
        "أدخل البريد الإلكتروني وكلمة المرور.",
        true
      );
      return;
    }

    if (password.length < 8) {
      showMessage(
        "editor-message",
        "كلمة المرور يجب ألا تقل عن 8 أحرف.",
        true
      );
      return;
    }

    button.disabled = true;
    button.textContent = "جارٍ إنشاء الحساب...";

    try {
      const { data, error } = await db.functions.invoke("hyper-action", {
        body: { email, password }
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "تعذر إنشاء الحساب.");
      }

      showMessage(
        "editor-message",
        "تم إنشاء حساب المحرر بنجاح: " + data.editor.email
      );

      event.target.reset();
      await loadEditors();

    } catch (error) {
      showMessage(
        "editor-message",
        error.message || "حدث خطأ أثناء إنشاء الحساب.",
        true
      );
    } finally {
      button.disabled = false;
      button.textContent = "إنشاء حساب المحرر";
    }
  });
}

/* تسجيل الخروج */
if ($("signout")) {
  $("signout").addEventListener("click", async () => {
    await db.auth.signOut();
    currentAccess = null;
    window.shuraAdminAccess = null;
    await checkSession();
  });
}

/* تسجيل الدخول */
if ($("login-form")) {
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();

    const button = $("login-form").querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    try {
      const email = $("email").value.trim();
      const password = $("password").value;

      showMessage("login-message", "جارٍ التحقق من بيانات الدخول...");

      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await checkSession();

    } catch (error) {
      showLoginError("تعذر تسجيل الدخول: " + error.message);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

/* تهيئة Supabase */
try {
  if (!window.supabase?.createClient) {
    throw new Error("لم يتم تحميل مكتبة Supabase.");
  }

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

  window.shuraAdminDb = db;

  db.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      currentAccess = null;
      window.shuraAdminAccess = null;
      checkSession();
    }
  });

  checkSession();

} catch (error) {
  showLoginError(error.message);
}
