
/* =====================================================
   سجل العضوية المركزي - منصة الشورى
   يعتمد على عميل Supabase المنشأ في admin.js
   ===================================================== */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  let membersCache = [];

  function message(text, isError = false) {
    const node = $("central-member-message");
    if (!node) return;

    node.textContent = text;
    node.classList.toggle("error", isError);
  }

  function allowed() {
    const access = window.shuraAdminAccess;

    if (!access || !access.is_active) return false;

    return access.role === "super_admin" ||
      (access.permissions || []).includes("voters_manage");
  }

  function client() {
    return window.shuraAdminDb || null;
  }

  async function rpc(name, args = {}) {
    const db = client();

    if (!db) {
      throw new Error("لم يتم الاتصال بقاعدة البيانات.");
    }

    const { data, error } = await db.rpc(name, args);

    if (error) throw error;

    return data;
  }

  function record(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function button(label, handler) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", handler);
    return node;
  }

  function cell(row, value, header = false) {
    const node = document.createElement(header ? "th" : "td");
    node.textContent = value == null ? "" : String(value);
    row.append(node);
    return node;
  }

  function renderTable(members) {
    const table = $("central-member-table");
    if (!table) return;

    table.replaceChildren();

    const headers = [
      "الاسم",
      "رقم الهاتف",
      "آخر رقمين من الرمز",
      "الحالة",
      "الانتخابات",
      "الإجراءات"
    ];

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    headers.forEach(value => cell(headerRow, value, true));
    thead.append(headerRow);

    const tbody = document.createElement("tbody");

    for (const member of members) {
      const row = document.createElement("tr");

      cell(row, member.full_name || "—");
      cell(row, member.phone_e164 || "—");
      cell(row, member.membership_code_last2 || "—");
      cell(row, member.is_active ? "مفعّل" : "معطّل");
      cell(row, member.election_count ?? 0);

      const actions = document.createElement("td");
      const wrapper = document.createElement("div");
      wrapper.className = "table-actions";

      wrapper.append(
        button("تعديل البيانات", () => editMember(member)),
        button(
          member.is_active ? "تعطيل" : "تفعيل",
          () => toggleMember(member)
        ),
        button("إعادة إصدار الرمز", () => resetCode(member))
      );

      actions.append(wrapper);
      row.append(actions);
      tbody.append(row);
    }

    if (!members.length) {
      const row = document.createElement("tr");
      const empty = cell(row, "لا توجد نتائج مطابقة.");
      empty.colSpan = headers.length;
      tbody.append(row);
    }

    table.append(thead, tbody);
  }

  async function loadMembers(search = "") {
    if (!allowed()) return;

    message("جارٍ تحميل سجل العضوية...");

    try {
      const data = await rpc("central_admin_list_members", {
        p_search: search.trim() || null
      });

      membersCache = data || [];
      renderTable(membersCache);

      message("عدد الأعضاء المعروضين: " + membersCache.length);

    } catch (error) {
      message("تعذر تحميل الأعضاء: " + error.message, true);
    }
  }

  async function addMember(event) {
    event.preventDefault();

    if (!allowed()) {
      message("ليست لديك صلاحية إدارة العضوية.", true);
      return;
    }

    const name = $("central-member-name").value.trim();
    const phone = $("central-member-phone").value.trim();

    if (!phone) {
      message("أدخل رقم الهاتف.", true);
      return;
    }

    const submit = $("central-member-form").querySelector(
      'button[type="submit"]'
    );

    if (submit) submit.disabled = true;

    try {
      const data = await rpc("central_admin_add_member", {
        p_phone: phone,
        p_full_name: name
      });

      const member = record(data);

      if (!member || !member.code) {
        throw new Error("تمت العملية دون إرجاع رمز العضوية.");
      }

      showNewCode(member);

      $("central-member-form").reset();

      message("تمت إضافة العضو بنجاح.");

      await loadMembers(
        $("central-member-search").value.trim()
      );

    } catch (error) {
      message("تعذرت إضافة العضو: " + error.message, true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function showNewCode(member) {
    const result = $("central-member-code-result");
    result.replaceChildren();
    result.hidden = false;

    const title = document.createElement("strong");
    title.textContent = "تم إنشاء العضوية بنجاح";

    const name = document.createElement("p");
    name.textContent = "الاسم: " + (member.full_name || "—");

    const phone = document.createElement("p");
    phone.textContent = "الهاتف: " + (member.phone_e164 || "—");

    const code = document.createElement("p");
    code.textContent = "رمز العضوية: " + member.code;

    const warning = document.createElement("p");
    warning.textContent =
      "احفظ الرمز وسلّمه للعضو بصورة آمنة. لن يظهر كاملاً مرة أخرى.";

    const copy = button("نسخ الرمز", async () => {
      try {
        await navigator.clipboard.writeText(member.code);
        copy.textContent = "تم النسخ";
      } catch (_) {
        code.textContent =
          "رمز العضوية: " + member.code +
          " (تعذر النسخ تلقائياً)";
      }
    });

    result.append(title, name, phone, code, warning, copy);
  }

  async function editMember(member) {
    if (!allowed()) return;

    const name = prompt(
      "أدخل اسم العضو:",
      member.full_name || ""
    );

    if (name === null) return;

    const phone = prompt(
      "أدخل رقم الهاتف:",
      member.phone_e164 || ""
    );

    if (phone === null) return;

    if (!phone.trim()) {
      message("رقم الهاتف لا يمكن أن يكون فارغاً.", true);
      return;
    }

    try {
      await rpc("central_admin_update_member", {
        p_member_id: member.member_id || member.id,
        p_phone: phone.trim(),
        p_full_name: name.trim()
      });

      message("تم تحديث بيانات العضو.");
      await refresh();

    } catch (error) {
      message("تعذر تعديل العضو: " + error.message, true);
    }
  }

  async function toggleMember(member) {
    if (!allowed()) return;

    const active = !member.is_active;

    const action = active ? "تفعيل" : "تعطيل";

    if (!confirm("هل تريد " + action + " هذه العضوية؟")) return;

    try {
      await rpc("central_admin_set_member_active", {
        p_member_id: member.member_id || member.id,
        p_active: active
      });

      message("تم تحديث حالة العضوية.");
      await refresh();

    } catch (error) {
      message("تعذر تغيير الحالة: " + error.message, true);
    }
  }

  async function resetCode(member) {
    if (!allowed()) return;

    if (!confirm(
      "سيُلغى الرمز السابق ويصدر رمز جديد. هل تريد المتابعة؟"
    )) return;

    try {
      const data = await rpc("central_admin_reset_member_code", {
        p_member_id: member.member_id || member.id
      });

      const result = record(data);

      if (!result || !result.code) {
        throw new Error("لم يتم إرجاع الرمز الجديد.");
      }

      showNewCode({
        full_name: member.full_name,
        phone_e164: member.phone_e164,
        code: result.code
      });

      message("تم إصدار رمز جديد. احفظه وسلّمه للعضو.");

      await refresh();

    } catch (error) {
      message("تعذر إصدار الرمز: " + error.message, true);
    }
  }

  async function assignElection(event) {
    event.preventDefault();

    if (!allowed()) {
      message("ليست لديك صلاحية إدارة العضوية.", true);
      return;
    }

    const memberId = $("central-member-id").value.trim();
    const electionId = $("central-member-election").value;

    if (!memberId || !electionId) {
      message("أدخل معرّف العضو واختر الانتخابات.", true);
      return;
    }

    try {
      await rpc("central_admin_assign_member_election", {
        p_member_id: memberId,
        p_election_id: electionId,
        p_enabled: true
      });

      message("تم ربط العضو بالانتخابات.");

      $("central-member-election-form").reset();

      await refresh();

    } catch (error) {
      message("تعذر ربط العضو: " + error.message, true);
    }
  }

  async function loadElections() {
    const db = client();
    const select = $("central-member-election");

    if (!db || !select) return;

    try {
      const { data, error } = await db
        .from("elections")
        .select("id,title")
        .order("created_at", { ascending: false });

      if (error) throw error;

      select.replaceChildren(
        new Option("اختر الانتخابات", "")
      );

      for (const election of data || []) {
        select.add(
          new Option(election.title, election.id)
        );
      }

    } catch (error) {
      message("تعذر تحميل الانتخابات: " + error.message, true);
    }
  }

  async function refresh() {
    await loadMembers(
      $("central-member-search")?.value || ""
    );
    await loadElections();
  }

  function initialize() {
    const form = $("central-member-form");

    if (form) {
      form.addEventListener("submit", addMember);
    }

    const searchButton = $("central-member-search-button");

    if (searchButton) {
      searchButton.addEventListener("click", () => {
        loadMembers($("central-member-search").value);
      });
    }

    const searchInput = $("central-member-search");

    if (searchInput) {
      searchInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          loadMembers(searchInput.value);
        }
      });
    }

    const refreshButton = $("central-member-refresh");

    if (refreshButton) {
      refreshButton.addEventListener("click", refresh);
    }

    const electionForm = $("central-member-election-form");

    if (electionForm) {
      electionForm.addEventListener("submit", assignElection);
    }

    document.addEventListener("shura-admin-ready", () => {
      if (allowed()) refresh();
    });
  }

  initialize();

})();

