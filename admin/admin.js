
// ============================================
// إعداد الاتصال بقاعدة بيانات Supabase
// ============================================

const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";
const EDITOR_FUNCTION = "hyper-action";

const $ = id => document.getElementById(id);

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const PERMISSIONS = [
  ["elections_create", "إنشاء الانتخابات"],
  ["elections_edit", "تعديل الانتخابات والبنود"],
  ["elections_publish", "نشر الانتخابات وإيقافها"],
  ["voters_manage", "إدارة الأعضاء ورموز العضوية"],
  ["results_view", "عرض النتائج الإجمالية"],
  ["participation_view", "متابعة المشاركة"],
  ["reports_view", "إعداد التقارير"]
];

let currentAccess = null;
let currentPermissions = [];
let accessMonitorRunning = false;
let forcedLogoutInProgress = false;

// ============================================
// أدوات مساعدة
// ============================================

function msg(id, text) {
  if ($(id)) $(id).textContent = text;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function hasPermission(permission) {
  return currentAccess?.role === "super_admin" ||
    currentPermissions.includes(permission);
}

function showLogin(message = "") {
  currentAccess = null;
  currentPermissions = [];
  $("dashboard").hidden = true;
  $("login-panel").hidden = false;
  msg("login-message", message);
}

// ============================================
// عرض رمز العضوية
// ============================================

function showCode(code, title) {
  const box = $("new-code-result");
  box.replaceChildren();

  box.append(node("strong", title || "رمز العضوية — احفظه وسلّمه للعضو"));
  box.append(node("code", code));

  const copy = node("button", "نسخ الرمز");
  copy.type = "button";

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "تم النسخ";
    } catch {
      copy.textContent = "انسخ الرمز يدوياً";
    }
  });

  box.append(copy);
  box.hidden = false;
}

// ============================================
// واجهة الصلاحيات
// ============================================

function applyAccessUI() {
  const isSuperAdmin = currentAccess?.role === "super_admin";

  $("admin-role").textContent = isSuperAdmin ? "المدير العام" : "محرر";
  $("editor-management").hidden = !isSuperAdmin;

  $("election-create-panel").hidden = !hasPermission("elections_create");
  $("item-create-panel").hidden = !hasPermission("elections_edit");
  $("elections-list-panel").hidden = false;

  const canAccessVoters =
    hasPermission("voters_manage") ||
    hasPermission("participation_view") ||
    hasPermission("results_view");

  $("voter-management-panel").hidden = !canAccessVoters;
  $("voter-add-area").hidden = !hasPermission("voters_manage");
  $("voter-refresh-area").hidden = !canAccessVoters;
  $("voter-list-area").hidden = !hasPermission("voters_manage");
  $("participation-area").hidden = !hasPermission("participation_view");
  $("results-area").hidden = !hasPermission("results_view");
}

// ============================================
// التحقق من الحساب
// ============================================

async function check() {
  const { data: sessionData, error: sessionError } =
    await db.auth.getSession();

  if (sessionError) throw sessionError;

  const session = sessionData.session;

  if (!session) {
    showLogin();
    return;
  }

  const { data, error } = await db.rpc("admin_get_my_access");
  if (error) throw error;

  const access = Array.isArray(data) ? data[0] : data;

  if (
    !access ||
    access.is_active !== true ||
    !["super_admin", "editor", "committee"].includes(access.role)
  ) {
    try {
      await db.auth.signOut();
    } catch {}

    showLogin("هذا الحساب غير نشط أو غير مخول بدخول لوحة الإدارة.");
    return;
  }

  currentAccess = access;
  currentPermissions = Array.isArray(access.permissions)
    ? access.permissions
    : [];

  $("login-panel").hidden = true;
  $("dashboard").hidden = false;
  $("admin-email").textContent = session.user.email || "حساب الإدارة";

  applyAccessUI();
  await loadElections();

  if (
    hasPermission("voters_manage") ||
    hasPermission("participation_view") ||
    hasPermission("results_view")
  ) {
    if ($("voter-election").value) await loadVoterData();
  }

  if (access.role === "super_admin") await loadEditors();
}

// ============================================
// مراقبة تعطيل الحساب
// ============================================

async function returnToLoginBecauseDisabled() {
  if (forcedLogoutInProgress) return;

  forcedLogoutInProgress = true;

  try {
    await db.auth.signOut();
  } catch (error) {
    console.error("تعذر إنهاء الجلسة:", error);
  }

  showLogin(
    "تم تعطيل هذا الحساب من المدير العام. انتهت صلاحية دخولك، ويمكنك التواصل مع الإدارة."
  );

  forcedLogoutInProgress = false;
}

async function monitorAdminAccess() {
  if (
    accessMonitorRunning ||
    forcedLogoutInProgress ||
    !currentAccess
  ) return;

  accessMonitorRunning = true;

  try {
    const { data, error } = await db.rpc("admin_get_my_access");

    if (error) {
      console.warn("تعذر تحديث الصلاحيات:", error.message);
      return;
    }

    const access = Array.isArray(data) ? data[0] : data;

    if (
      !access ||
      access.is_active !== true ||
      !["super_admin", "editor", "committee"].includes(access.role)
    ) {
      await returnToLoginBecauseDisabled();
      return;
    }

    currentAccess = access;
    currentPermissions = Array.isArray(access.permissions)
      ? access.permissions
      : [];

    applyAccessUI();

  } catch (error) {
    console.warn("تعذر التحقق الدوري:", error);
  } finally {
    accessMonitorRunning = false;
  }
}

setInterval(monitorAdminAccess, 10000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) monitorAdminAccess();
});

// ============================================
// أدوات نشر الانتخابات وإيقافها
// ============================================

function addPublicationControls(card, election) {
  if (!hasPermission("elections_publish")) return;

  const controls = node("div", "", "editor-actions");
  const select = document.createElement("select");

  const statuses = [
    ["draft", "إلغاء النشر وإعادتها لمسودة"],
    ["open", "نشر وفتح التصويت"],
    ["paused", "إيقاف مؤقت مع إبقاء النشر"],
    ["closed", "إغلاق التصويت مع إبقاء النشر"]
  ];

  statuses.forEach(([value, label]) => {
    select.add(new Option(label, value));
  });

  select.value = election.is_published ? election.status : "draft";

  const button = node("button", "تطبيق الحالة");
  button.type = "button";

  button.addEventListener("click", async () => {
    const status = select.value;
    const published = status !== "draft";

    if (!confirm(
      `هل تريد تغيير حالة انتخابات «${election.title}»؟`
    )) return;

    button.disabled = true;

    try {
      const { error } = await db.rpc(
        "admin_set_election_publication",
        {
          p_election_id: election.id,
          p_is_published: published,
          p_status: status
        }
      );

      if (error) throw error;

      alert("تم تحديث حالة الانتخابات.");
      await loadElections();

    } catch (error) {
      alert("تعذر تغيير الحالة: " + error.message);
    } finally {
      button.disabled = false;
    }
  });

  controls.append(select, button);
  card.append(controls);
}

// ============================================
// تحميل الانتخابات وبنودها
// ============================================

async function loadElections() {
  const { data, error } = await db
    .from("elections")
    .select("id,title,status,is_published,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    msg("elections-list", error.message);
    return;
  }

  const itemSelect = $("item-election");
  const voterSelect = $("voter-election");
  const previousVoterValue = voterSelect.value;

  itemSelect.replaceChildren(new Option("اختر الانتخابات", ""));
  voterSelect.replaceChildren(new Option("اختر الانتخابات", ""));
  $("elections-list").replaceChildren();

  for (const election of data || []) {
    itemSelect.add(new Option(election.title, election.id));
    voterSelect.add(new Option(election.title, election.id));

    const card = node("article", "", "entry");

    card.append(node(
      "h3",
      election.title + " · " + election.status +
      (election.is_published ? " · منشورة" : " · غير منشورة")
    ));

    addPublicationControls(card, election);

    const { data: items, error: itemError } = await db
      .from("election_items")
      .select("id,title,item_type,is_active")
      .eq("election_id", election.id)
      .order("sort_order");

    if (itemError) {
      card.append(node("p", itemError.message));
    } else {
      for (const item of items || []) {
        card.append(node(
          "p",
          (item.is_active ? "● " : "○ ") +
          item.title + " (" + item.item_type + ")"
        ));

        const { data: options } = await db
          .from("election_item_options")
          .select("label")
          .eq("item_id", item.id)
          .order("sort_order");

        card.append(node(
          "small",
          (options || []).map(option => option.label).join(" · ")
        ));
      }
    }

    $("elections-list").append(card);
  }

  if (
    previousVoterValue &&
    [...voterSelect.options].some(option => option.value === previousVoterValue)
  ) {
    voterSelect.value = previousVoterValue;
  } else if (data?.length === 1) {
    voterSelect.value = data[0].id;
  }
}

// ============================================
// بيانات الأعضاء والمشاركة والنتائج
// ============================================

async function loadVoterData() {
  const electionId = $("voter-election").value;

  if (!electionId) {
    msg("voter-message", "اختر الانتخابات أولاً.");
    return;
  }

  const requests = {};

  if (hasPermission("voters_manage")) {
    requests.voters = db.rpc("admin_list_eligible_voters", {
      p_election_id: electionId
    });
  }

  if (hasPermission("participation_view")) {
    requests.participation = db.rpc("admin_voter_participation", {
      p_election_id: electionId
    });
  }

  if (hasPermission("results_view")) {
    requests.results = db.rpc("admin_get_election_results", {
      p_election_id: electionId
    });
  }

  const keys = Object.keys(requests);
  const responses = await Promise.all(keys.map(key => requests[key]));
  const result = {};

  for (let i = 0; i < keys.length; i++) {
    if (responses[i].error) {
      msg("voter-message", responses[i].error.message);
      return;
    }
    result[keys[i]] = responses[i].data || [];
  }

  // سجل الأعضاء
  if (hasPermission("voters_manage")) {
    const voters = result.voters || [];
    const logged = voters.filter(voter => voter.has_logged_in).length;

    $("voter-summary").textContent =
      `عدد الأعضاء: ${voters.length} · دخلوا المنصة: ${logged} ` +
      `(${voters.length ? Math.round(logged * 100 / voters.length) : 0}%)`;

    const table = $("voter-table");
    table.replaceChildren();

    const head = node("tr");
    ["اسم العضو", "الهاتف", "آخر 4 من الرمز", "الدخول", "حالة العضوية", "الإجراءات"]
      .forEach(title => head.append(node("th", title)));
    table.append(head);

    for (const voter of voters) {
      const tr = node("tr");

      [
        voter.full_name,
        voter.phone_e164,
        voter.membership_code_hint || "—",
        voter.has_logged_in ? "دخل" : "لم يدخل",
        voter.is_enabled ? "مفعلة" : "معطلة"
      ].forEach(value => {
        tr.append(node("td", String(value ?? "—")));
      });

      const actions = node("td");

      const toggle = node("button", voter.is_enabled ? "تعطيل" : "تفعيل");
      toggle.type = "button";

      toggle.addEventListener("click", async () => {
        toggle.disabled = true;

        const { error } = await db.rpc("admin_set_voter_enabled", {
          p_voter_id: voter.voter_id,
          p_enabled: !voter.is_enabled
        });

        toggle.disabled = false;

        if (error) msg("voter-message", error.message);
        else await loadVoterData();
      });

      actions.append(toggle);

      const reset = node("button", "إعادة إصدار رمز");
      reset.type = "button";

      reset.addEventListener("click", async () => {
        if (!confirm(
          "سيصبح الرمز القديم غير صالح، وسيحتاج العضو إلى الرمز الجديد. متابعة؟"
        )) return;

        const { data, error } = await db.rpc("admin_reset_voter_access", {
          p_voter_id: voter.voter_id
        });

        if (error) {
          msg("voter-message", error.message);
          return;
        }

        if (!data?.length || !data[0].membership_code) {
          msg("voter-message", "لم يتم استلام الرمز الجديد.");
          return;
        }

        showCode(
          data[0].membership_code,
          "رمز جديد للعضو: " + voter.full_name
        );

        await loadVoterData();
      });

      actions.append(reset);
      tr.append(actions);
      table.append(tr);
    }
  }

  // متابعة المشاركة
  if (hasPermission("participation_view")) {
    const table = $("participation-table");
    table.replaceChildren();

    const head = node("tr");
    ["اسم العضو", "البند", "شارك؟", "وقت المشاركة"]
      .forEach(title => head.append(node("th", title)));
    table.append(head);

    for (const row of result.participation || []) {
      const tr = node("tr");

      [
        row.full_name,
        row.item_title,
        row.has_voted ? "نعم" : "لا",
        row.cast_at ? new Date(row.cast_at).toLocaleString("ar") : "—"
      ].forEach(value => {
        tr.append(node("td", String(value ?? "—")));
      });

      table.append(tr);
    }
  }

  // النتائج الإجمالية دون ربط الاختيار باسم صاحبه
  if (hasPermission("results_view")) {
    const table = $("results-table");
    table.replaceChildren();

    const head = node("tr");
    ["البند", "الخيار", "الأصوات", "الإجمالي", "النسبة"]
      .forEach(title => head.append(node("th", title)));
    table.append(head);

    for (const row of result.results || []) {
      const tr = node("tr");

      [
        row.item_title,
        row.option_label,
        row.vote_count,
        row.total_votes,
        row.percentage + "%"
      ].forEach(value => {
        tr.append(node("td", String(value ?? "—")));
      });

      table.append(tr);
    }
  }

  msg("voter-message", "تم تحديث البيانات المتاحة وفق صلاحيات حسابك.");
}

// ============================================
// إدارة المحررين
// ============================================

async function loadEditors() {
  if (currentAccess?.role !== "super_admin") return;

  const { data, error } = await db.rpc("admin_list_editors");

  if (error) {
    msg("editor-message", "تعذر تحميل المحررين: " + error.message);
    return;
  }

  const list = $("editors-list");
  list.replaceChildren();

  if (!data || data.length === 0) {
    list.append(node("p", "لا يوجد محررون مسجلون حالياً."));
    return;
  }

  for (const editor of data) {
    const card = node("article", "", "entry editor-card");

    card.append(node(
      "h3",
      editor.email + (editor.is_active ? " · نشط" : " · معطل")
    ));

    card.append(node(
      "p",
      "تاريخ الإنشاء: " + new Date(editor.created_at).toLocaleString("ar")
    ));

    const fieldset = node("fieldset", "", "permission-fieldset");
    fieldset.append(node("legend", "صلاحيات المحرر"));

    for (const [key, label] of PERMISSIONS) {
      const wrapper = node("label", "", "check-label");
      const checkbox = document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.value = key;
      checkbox.checked = (editor.permissions || []).includes(key);

      wrapper.append(checkbox, document.createTextNode(label));
      fieldset.append(wrapper);
    }

    card.append(fieldset);

    const actions = node("div", "", "editor-actions");
    const save = node("button", "حفظ الصلاحيات");
    save.type = "button";

    save.addEventListener("click", async () => {
      const permissions = [
        ...fieldset.querySelectorAll('input[type="checkbox"]:checked')
      ].map(input => input.value);

      save.disabled = true;

      const { error } = await db.rpc("admin_update_editor_permissions", {
        p_user_id: editor.user_id,
        p_permissions: permissions
      });

      save.disabled = false;

      if (error) {
        msg("editor-message", error.message);
      } else {
        msg("editor-message", "تم تحديث صلاحيات " + editor.email);
        await loadEditors();
      }
    });

    const toggle = node(
      "button",
      editor.is_active ? "تعطيل الحساب" : "تفعيل الحساب"
    );
    toggle.type = "button";

    toggle.addEventListener("click", async () => {
      const action = editor.is_active ? "تعطيل" : "تفعيل";

      if (!confirm(`هل تريد ${action} حساب ${editor.email}؟`)) return;

      toggle.disabled = true;

      const { error } = await db.rpc("admin_set_editor_active", {
        p_user_id: editor.user_id,
        p_active: !editor.is_active
      });

      toggle.disabled = false;

      if (error) {
        msg("editor-message", error.message);
      } else {
        msg("editor-message", "تم تحديث حالة الحساب.");
        await loadEditors();
      }
    });

    actions.append(save, toggle);
    card.append(actions);
    list.append(card);
  }
}

// ============================================
// تسجيل الدخول
// ============================================

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("login-form").querySelector("button");
  button.disabled = true;

  try {
    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) msg("login-message", error.message);
    else await check();

  } catch (error) {
    msg("login-message", error.message);
  } finally {
    button.disabled = false;
  }
});

// ============================================
// إنشاء انتخابات جديدة
// ============================================

$("election-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!hasPermission("elections_create")) {
    msg("election-message", "لا تملك صلاحية إنشاء الانتخابات.");
    return;
  }

  const button = event.target.querySelector("button");
  button.disabled = true;

  const { error } = await db.from("elections").insert({
    title: $("title").value.trim(),
    description: $("description").value.trim() || null
  });

  button.disabled = false;

  msg(
    "election-message",
    error ? error.message : "حُفظت الانتخابات كمسودة."
  );

  if (!error) {
    event.target.reset();
    await loadElections();
  }
});

// ============================================
// إضافة بند تصويت
// ============================================

$("item-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!hasPermission("elections_edit")) {
    msg("item-message", "لا تملك صلاحية تعديل الانتخابات.");
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

  if (
    !election_id ||
    !title ||
    !labels.length ||
    new Set(labels).size !== labels.length
  ) {
    msg(
      "item-message",
      "اختر الانتخابات والعنوان وأدخل خيارات صحيحة غير مكررة."
    );
    return;
  }

  const button = event.target.querySelector("button");
  button.disabled = true;

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
    button.disabled = false;
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

  button.disabled = false;

  msg(
    "item-message",
    optionError
      ? "تم إنشاء البند لكن تعذر حفظ الخيارات: " + optionError.message
      : "تم حفظ البند وخياراته."
  );

  if (!optionError) {
    event.target.reset();
    await loadElections();
  }
});

// ============================================
// إضافة عضو وإنشاء رمز
// ============================================

$("voter-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!hasPermission("voters_manage")) {
    msg("voter-message", "لا تملك صلاحية إدارة الأعضاء.");
    return;
  }

  const electionId = $("voter-election").value;

  if (!electionId) {
    msg("voter-message", "اختر الانتخابات أولاً.");
    return;
  }

  const button = event.target.querySelector("button");
  button.disabled = true;

  const { data, error } = await db.rpc("admin_add_eligible_voter", {
    p_election_id: electionId,
    p_full_name: $("voter-name").value.trim(),
    p_phone_e164: $("voter-phone").value.trim()
  });

  button.disabled = false;

  if (error) {
    msg("voter-message", error.message);
    return;
  }

  if (!data?.length || !data[0].membership_code) {
    msg("voter-message", "لم يتم استلام رمز العضوية.");
    return;
  }

  showCode(
    data[0].membership_code,
    "رمز العضوية الجديد للعضو: " + data[0].full_name
  );

  event.target.reset();
  $("voter-election").value = electionId;

  await loadVoterData();
});

// ============================================
// إنشاء حساب محرر
// ============================================

$("editor-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (
    currentAccess?.role !== "super_admin" ||
    currentAccess?.is_active !== true
  ) {
    msg("editor-message", "إنشاء المحررين متاح للمدير العام النشط فقط.");
    return;
  }

  const full_name = $("editor-name").value.trim();
  const email = $("editor-email").value.trim().toLowerCase();
  const password = $("editor-password").value;
  const confirmPassword = $("editor-password-confirm").value;

  const permissions = [
    ...document.querySelectorAll('input[name="editor-permission"]:checked')
  ].map(input => input.value);

  if (!full_name || !email || !password) {
    msg("editor-message", "أكمل البيانات المطلوبة.");
    return;
  }

  if (password.length < 10) {
    msg("editor-message", "كلمة المرور يجب ألا تقل عن 10 أحرف.");
    return;
  }

  if (password !== confirmPassword) {
    msg("editor-message", "كلمتا المرور غير متطابقتين.");
    return;
  }

  const button = $("create-editor-button");
  button.disabled = true;
  msg("editor-message", "جارٍ إنشاء الحساب وتسجيل صلاحياته...");

  try {
    const { data, error } = await db.functions.invoke(EDITOR_FUNCTION, {
      body: { full_name, email, password, permissions }
    });

    if (error) throw error;

    if (!data?.success) {
      throw new Error(data?.error || "لم يكتمل إنشاء الحساب.");
    }

    event.target.reset();
    msg(
      "editor-message",
      "تم إنشاء حساب المحرر بنجاح. سلّمه بيانات الدخول بطريقة آمنة."
    );

    await loadEditors();

  } catch (error) {
    msg(
      "editor-message",
      "تعذر إنشاء الحساب: " + (error.message || "خطأ غير معروف")
    );
  } finally {
    button.disabled = false;
  }
});

// ============================================
// أزرار التحديث
// ============================================

$("load-voters").addEventListener("click", loadVoterData);
$("voter-election").addEventListener("change", loadVoterData);

// ============================================
// تسجيل الخروج
// ============================================

$("signout").addEventListener("click", async () => {
  await db.auth.signOut();
  showLogin();
});

// ============================================
// متابعة حالة الجلسة
// ============================================

db.auth.onAuthStateChange(event => {
  if (event === "SIGNED_OUT") showLogin();
});

// ============================================
// التحقق عند فتح لوحة الإدارة
// ============================================

check().catch(error => {
  msg(
    "login-message",
    error.message || "تعذر التحقق من صلاحيات الحساب."
  );
});
