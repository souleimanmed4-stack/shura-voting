const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

const $ = id => document.getElementById(id);
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const msg = (id, text) => {
  if ($(id)) $(id).textContent = text;
};

let selectedElection = "";

function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function showCode(code, title) {
  const box = $("new-code-result");
  box.replaceChildren();

  box.append(node(
    "strong",
    title || "رمز العضوية — أرسله للعضو واحفظ نسخة منه"
  ));

  const value = node("code", code);
  box.append(value);

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

async function check() {
  const { data: sessionData, error } = await db.auth.getSession();

  if (error) throw error;

  const session = sessionData.session;

  if (!session) {
    $("login-panel").hidden = false;
    $("dashboard").hidden = true;
    return;
  }

  const { data: admin, error: adminError } = await db
    .from("admin_access")
    .select("user_id,role")
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
  $("admin-email").textContent = session.user.email || "حساب الإدارة";

  await load();
}

async function load() {
  const { data, error } = await db
    .from("elections")
    .select("id,title,status,is_published,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    msg("elections-list", error.message);
    return;
  }

  const select = $("item-election");
  const voterSelect = $("voter-election");

  select.replaceChildren(new Option("اختر الانتخابات", ""));
  voterSelect.replaceChildren(new Option("اختر الانتخابات", ""));

  $("elections-list").replaceChildren();

  for (const election of data || []) {
    select.add(new Option(election.title, election.id));
    voterSelect.add(new Option(election.title, election.id));

    const card = node("article", "", "entry");

    card.append(node(
      "h3",
      election.title + " · " + election.status +
      (election.is_published ? " · منشورة" : " · غير منشورة")
    ));

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

        const { data: opts } = await db
          .from("election_item_options")
          .select("label")
          .eq("item_id", item.id)
          .order("sort_order");

        card.append(node(
          "small",
          (opts || []).map(x => x.label).join(" · ")
        ));
      }
    }

    $("elections-list").append(card);
  }
}

async function loadVoters() {
  const electionId = $("voter-election").value;

  if (!electionId) {
    msg("voter-message", "اختر الانتخابات أولاً.");
    return;
  }

  selectedElection = electionId;

  // لا نخفي مربع الرمز هنا؛ فقد يكون قد عُرض للتو بعد إنشاء العضو أو إعادة إصدار الرمز.

  const [votersRes, participationRes, resultsRes] = await Promise.all([
    db.rpc("admin_list_eligible_voters", {
      p_election_id: electionId
    }),

    db.rpc("admin_voter_participation", {
      p_election_id: electionId
    }),

    db.rpc("admin_get_election_results", {
      p_election_id: electionId
    })
  ]);

  for (const r of [votersRes, participationRes, resultsRes]) {
    if (r.error) {
      msg("voter-message", r.error.message);
      return;
    }
  }

  const voters = votersRes.data || [];
  const participation = participationRes.data || [];
  const results = resultsRes.data || [];

  const totalMembers = voters.length;
  const logged = voters.filter(v => v.has_logged_in).length;

  $("voter-summary").replaceChildren(
    node(
      "p",
      `عدد الأعضاء: ${totalMembers} · من دخلوا المنصة: ${logged} (${totalMembers ? Math.round(logged * 100 / totalMembers) : 0}%)`
    )
  );

  // جدول الأعضاء
  const table = $("voter-table");
  table.replaceChildren();

  const head = node("tr");

  [
    "اسم العضو",
    "الهاتف",
    "آخر 4 من الرمز",
    "الدخول",
    "حالة العضوية"
  ].forEach(t => head.append(node("th", t)));

  table.append(head);

  for (const voter of voters) {
    const tr = node("tr");

    [
      voter.full_name,
      voter.phone_e164,
      voter.membership_code_hint || "—",
      voter.has_logged_in ? "دخل" : "لم يدخل",
      voter.is_enabled ? "مفعلة" : "معطلة"
    ].forEach(t => {
      tr.append(node("td", String(t)));
    });

    // تفعيل وتعطيل العضو
    const action = node("td");

    const btn = node(
      "button",
      voter.is_enabled ? "تعطيل" : "تفعيل"
    );

    btn.type = "button";

    btn.addEventListener("click", async () => {
      const { error } = await db.rpc("admin_set_voter_enabled", {
        p_voter_id: voter.voter_id,
        p_enabled: !voter.is_enabled
      });

      if (error) {
        alert(error.message);
      } else {
        await loadVoters();
      }
    });

    action.append(btn);

    // إعادة إصدار رمز العضوية
    const resetCell = node("td");
    const reset = node("button", "إعادة إصدار رمز");

    reset.type = "button";

    reset.addEventListener("click", async () => {
      if (!confirm(
        "سيصبح الرمز القديم غير صالح، وسيحتاج العضو إلى الرمز الجديد. متابعة؟"
      )) return;

      const { data, error } = await db.rpc(
        "admin_reset_voter_access",
        { p_voter_id: voter.voter_id }
      );

      if (error) {
        alert(error.message);
        return;
      }

      if (!data || !data.length || !data[0].membership_code) {
        alert("لم يتم استلام الرمز الجديد.");
        return;
      }

      await loadVoters();

      showCode(
        data[0].membership_code,
        "رمز جديد للعضو: " + voter.full_name
      );
    });

    resetCell.append(reset);
    tr.append(action, resetCell);
    table.append(tr);
  }

  // جدول المشاركة
  const pTable = $("participation-table");
  pTable.replaceChildren();

  const pHead = node("tr");

  [
    "اسم العضو",
    "البند",
    "شارك؟",
    "وقت المشاركة"
  ].forEach(t => pHead.append(node("th", t)));

  pTable.append(pHead);

  for (const row of participation) {
    const tr = node("tr");

    [
      row.full_name,
      row.item_title,
      row.has_voted ? "نعم" : "لا",
      row.cast_at
        ? new Date(row.cast_at).toLocaleString("ar")
        : "—"
    ].forEach(t => {
      tr.append(node("td", String(t)));
    });

    pTable.append(tr);
  }

  // جدول النتائج الإجمالية
  const rTable = $("results-table");
  rTable.replaceChildren();

  const rHead = node("tr");

  [
    "البند",
    "الخيار",
    "الأصوات",
    "الإجمالي",
    "النسبة"
  ].forEach(t => rHead.append(node("th", t)));

  rTable.append(rHead);

  for (const row of results) {
    const tr = node("tr");

    [
      row.item_title,
      row.option_label,
      row.vote_count,
      row.total_votes,
      row.percentage + "%"
    ].forEach(t => {
      tr.append(node("td", String(t)));
    });

    rTable.append(tr);
  }

  msg(
    "voter-message",
    "تم تحديث بيانات العضوية والمشاركة والنتائج."
  );
}

// تسجيل الدخول
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("login-form").querySelector("button");
  button.disabled = true;

  try {
    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) {
      msg("login-message", error.message);
    } else {
      await check();
    }
  } catch (e) {
    msg("login-message", e.message);
  } finally {
    button.disabled = false;
  }
});

// إنشاء انتخابات جديدة
$("election-form").addEventListener("submit", async event => {
  event.preventDefault();

  const { error } = await db.from("elections").insert({
    title: $("title").value.trim(),
    description: $("description").value.trim() || null
  });

  msg(
    "election-message",
    error ? error.message : "حُفظت الانتخابات كمسودة."
  );

  if (!error) {
    event.target.reset();
    await load();
  }
});

// إضافة بند تصويت
$("item-form").addEventListener("submit", async event => {
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

  msg(
    "item-message",
    optionError
      ? "تم إنشاء البند لكن تعذر حفظ الخيارات: " + optionError.message
      : "تم حفظ البند وخياراته."
  );

  if (!optionError) {
    event.target.reset();
    await load();
  }
});

// إضافة عضو وإنشاء رمز
$("voter-form").addEventListener("submit", async event => {
  event.preventDefault();

  const electionId = $("voter-election").value;

  if (!electionId) {
    msg("voter-message", "اختر الانتخابات أولاً.");
    return;
  }

  const { data, error } = await db.rpc(
    "admin_add_eligible_voter",
    {
      p_election_id: electionId,
      p_full_name: $("voter-name").value.trim(),
      p_phone_e164: $("voter-phone").value.trim()
    }
  );

  if (error) {
    msg("voter-message", error.message);
    return;
  }

  if (!data || !data.length || !data[0].membership_code) {
    msg("voter-message", "لم يتم استلام رمز العضوية.");
    return;
  }

  await loadVoters();

  showCode(
    data[0].membership_code,
    "رمز العضوية الجديد للعضو: " + data[0].full_name
  );

  event.target.reset();
  $("voter-election").value = electionId;
});

// تحديث بيانات الأعضاء
$("load-voters").addEventListener("click", loadVoters);

// تسجيل الخروج
$("signout").addEventListener("click", async () => {
  await db.auth.signOut();
  await check();
});

// متابعة حالة الجلسة
db.auth.onAuthStateChange(event => {
  if (event === "SIGNED_OUT") {
    $("login-panel").hidden = false;
    $("dashboard").hidden = true;
  }
});

// التحقق عند فتح لوحة الإدارة
check().catch(e => {
  msg("login-message", e.message);
});
