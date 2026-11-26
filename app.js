
document.getElementById("year").textContent = new Date().getFullYear();

const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storageKey: "shura-voter-auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

const list = document.getElementById("election-list");
const statusTitle = document.getElementById("election-status-title");
const statusDescription = document.getElementById("election-status-description");
const statusPill = document.getElementById("election-status-pill");

let electionsCache = [];
let rendering = false;

function el(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
}

function normalizePhone(value) {
  let phone = String(value || "").trim().replace(/[\s().-]/g, "");

  if (phone.startsWith("00")) {
    phone = "+" + phone.slice(2);
  } else if (/^\d{8}$/.test(phone)) {
    phone = "+222" + phone;
  } else if (/^\d{9,15}$/.test(phone)) {
    phone = "+" + phone;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error(
      "أدخل رقم الهاتف مع مفتاح الدولة، أو 8 أرقام موريتانية محلية."
    );
  }

  return phone;
}

async function phoneAccountEmail(phone) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(phone)
  );

  const hex = Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return "voter-" + hex + "@accounts.shura.invalid";
}

function showMessage(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function createInput(type, placeholder, options = {}) {
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.required = options.required !== false;
  input.autocomplete = options.autocomplete || "off";

  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.inputMode) input.inputMode = options.inputMode;

  return input;
}

function createFormField(labelText, input) {
  const wrapper = el("label", "auth-field");
  wrapper.append(el("span", "", labelText), input);
  return wrapper;
}

function createButton(text) {
  const button = el("button", "vote-submit", text);
  button.type = "submit";
  return button;
}

async function callVoterAccount(body) {
  const { data, error } = await db.functions.invoke("voter-account", {
    body
  });

  if (!error) {
    if (data?.error) throw new Error(data.error);
    return data;
  }

  let message = error.message || "تعذر تنفيذ الطلب.";

  try {
    if (error.context && typeof error.context.json === "function") {
      const details = await error.context.json();
      message = details.error || message;
    }
  } catch (_) {}

  throw new Error(message);
}

/* جلب عضويات الحساب دون إظهار الرموز */
async function getMemberships() {
  const { data: sessionData, error: sessionError } =
    await db.auth.getSession();

  if (sessionError) throw sessionError;

  const session = sessionData.session;

  if (!session || session.user.is_anonymous) return [];

  const { data, error } = await db.rpc("get_my_memberships");

  if (error) throw error;

  return data || [];
}

/* بيانات الحساب وحالة الاسم */
async function getProfileState() {
  const { data, error } = await db.rpc("get_my_voter_profile_state");

  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
}

/* إنشاء حساب الدخول أو تسجيل الدخول */
function createAuthPanel() {
  const panel = el("div", "auth-panel");

  panel.append(
    el("h4", "", "الدخول إلى حساب الناخب"),
    el(
      "p",
      "item-body",
      "يمكنك الدخول بحسابك أو إنشاء حساب جديد باستخدام رقم الهاتف وكلمة المرور."
    )
  );

  const tabs = el("div", "auth-tabs");
  const loginTab = el("button", "auth-tab active", "تسجيل الدخول");
  const registerTab = el("button", "auth-tab", "حساب جديد");

  loginTab.type = "button";
  registerTab.type = "button";
  tabs.append(loginTab, registerTab);
  panel.append(tabs);

  const formArea = el("div", "auth-form-area");
  panel.append(formArea);

  function showLogin() {
    formArea.replaceChildren();
    loginTab.classList.add("active");
    registerTab.classList.remove("active");

    const form = el("form", "membership-form");
    const phone = createInput("tel", "رقم الهاتف", {
      autocomplete: "tel",
      inputMode: "tel"
    });
    const password = createInput("password", "كلمة المرور", {
      autocomplete: "current-password"
    });

    const button = createButton("دخول");
    const feedback = el("p", "vote-message", "");

    form.append(
      createFormField("رقم الهاتف", phone),
      createFormField("كلمة المرور", password),
      button,
      feedback
    );

    form.addEventListener("submit", async event => {
      event.preventDefault();
      button.disabled = true;
      button.textContent = "جارٍ تسجيل الدخول...";

      try {
        const normalizedPhone = normalizePhone(phone.value);
        const email = await phoneAccountEmail(normalizedPhone);

        const { error } = await db.auth.signInWithPassword({
          email,
          password: password.value
        });

        if (error) throw error;

        await renderAllElections();
      } catch (error) {
        showMessage(feedback, error.message || "تعذر تسجيل الدخول.", true);
        button.disabled = false;
        button.textContent = "دخول";
      }
    });

    formArea.append(form);
  }

  function showRegister() {
    formArea.replaceChildren();
    registerTab.classList.add("active");
    loginTab.classList.remove("active");

    const form = el("form", "membership-form");

    const phone = createInput("tel", "رقم الهاتف", {
      autocomplete: "tel",
      inputMode: "tel"
    });

    const password = createInput("password", "كلمة المرور", {
      autocomplete: "new-password"
    });

    const confirmPassword = createInput(
      "password",
      "تأكيد كلمة المرور",
      { autocomplete: "new-password" }
    );

    const button = createButton("إنشاء الحساب");
    const feedback = el("p", "vote-message", "");

    form.append(
      createFormField("رقم الهاتف", phone),
      createFormField("كلمة المرور (8 أحرف على الأقل)", password),
      createFormField("تأكيد كلمة المرور", confirmPassword),
      button,
      feedback
    );

    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (password.value.length < 8) {
        showMessage(feedback, "كلمة المرور يجب ألا تقل عن 8 أحرف.", true);
        return;
      }

      if (password.value !== confirmPassword.value) {
        showMessage(feedback, "كلمتا المرور غير متطابقتين.", true);
        return;
      }

      button.disabled = true;
      button.textContent = "جارٍ إنشاء الحساب...";

      try {
        const normalizedPhone = normalizePhone(phone.value);

        await callVoterAccount({
          action: "register",
          phone: normalizedPhone,
          password: password.value
        });

        const email = await phoneAccountEmail(normalizedPhone);

        const { error } = await db.auth.signInWithPassword({
          email,
          password: password.value
        });

        if (error) {
          throw new Error(
            "تم إنشاء الحساب. سجل الدخول الآن باستخدام رقم الهاتف وكلمة المرور."
          );
        }

        await renderAllElections();
      } catch (error) {
        showMessage(feedback, error.message || "تعذر إنشاء الحساب.", true);
        button.disabled = false;
        button.textContent = "إنشاء الحساب";
      }
    });

    formArea.append(form);
  }

  loginTab.addEventListener("click", showLogin);
  registerTab.addEventListener("click", showRegister);

  showLogin();
  return panel;
}

/* إدخال اسم الناخب لأول مرة */
function createNameForm() {
  const section = el("section", "auth-panel");

  section.append(
    el("h3", "", "استكمال بيانات الحساب"),
    el(
      "p",
      "item-body",
      "يرجى إدخال الاسم الكامل كما هو معتمد في سجل العضوية."
    )
  );

  const form = el("form", "membership-form");
  const name = createInput("text", "الاسم الكامل", {
    autocomplete: "name",
    maxLength: 150
  });

  const button = createButton("حفظ الاسم");
  const feedback = el("p", "vote-message", "");

  form.append(
    createFormField("الاسم الكامل", name),
    button,
    feedback
  );

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const fullName = name.value.trim();

    if (fullName.length < 3) {
      showMessage(feedback, "أدخل الاسم الكامل بصورة صحيحة.", true);
      return;
    }

    button.disabled = true;
    button.textContent = "جارٍ الحفظ...";

    try {
      const { error } = await db.rpc("set_my_voter_name", {
        p_full_name: fullName
      });

      if (error) throw error;

      await renderAllElections();
    } catch (error) {
      showMessage(feedback, error.message || "تعذر حفظ الاسم.", true);
      button.disabled = false;
      button.textContent = "حفظ الاسم";
    }
  });

  section.append(form);
  return section;
}

/* عرض رموز العضوية بعد اكتمال الاسم */
async function createMembershipCodesPanel() {
  const section = el("section", "auth-panel");

  section.append(
    el("h3", "", "عضوياتك ورموزها"),
    el(
      "p",
      "item-body",
      "هذه الرموز خاصة بعضوياتك في الانتخابات. ستحتاج إلى رمز كل انتخابات عند المشاركة فيها."
    )
  );

  const { data, error } = await db.rpc("get_my_membership_codes");

  if (error) {
    section.append(el("p", "vote-message error", error.message));
    return section;
  }

  if (!data || !data.length) {
    section.append(
      el("p", "vote-message", "لا توجد عضويات مفعّلة مرتبطة بهذا الحساب.")
    );
    return section;
  }

  for (const member of data) {
    const box = el("div", "membership-code-box");

    box.append(
      el("strong", "", member.election_title || "انتخابات"),
      el("span", "", "الاسم: " + (member.full_name || "غير متاح")),
      el("span", "", "رمز العضوية: " + (member.membership_code || "غير متاح"))
    );

    const copy = el("button", "auth-tab", "نسخ الرمز");
    copy.type = "button";

    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(member.membership_code);
        copy.textContent = "تم النسخ";
      } catch (_) {
        copy.textContent = "تعذر النسخ";
      }
    });

    box.append(copy);
    section.append(box);
  }

  return section;
}

/* رأس حساب الناخب */
function createAccountHeader(member) {
  const box = el("div", "account-header");

  box.append(
    el("h3", "", "مرحباً " + (member.full_name || "بك")),
    el("p", "", "تم ربط عضويتك بهذا الحساب.")
  );

  if (member.phone_e164) {
    box.append(
      el("p", "account-detail", "رقم الهاتف: " + member.phone_e164)
    );
  }

  return box;
}

/* تسجيل الخروج */
function createLogoutButton() {
  const button = el("button", "auth-tab", "تسجيل الخروج");
  button.type = "button";

  button.addEventListener("click", async () => {
    const { error } = await db.auth.signOut();

    if (error) {
      alert("تعذر تسجيل الخروج: " + error.message);
      return;
    }

    await renderAllElections();
  });

  return button;
}

/* التحقق من رمز العضوية الخاص بهذه الانتخابات */
function createElectionVerificationForm(election) {
  const section = el("section", "auth-panel");

  section.append(
    el("h4", "", "التحقق من عضوية هذه الانتخابات"),
    el(
      "p",
      "item-body",
      "أدخل الرمز الرباعي الخاص بهذه الانتخابات لفتح صفحة التصويت."
    )
  );

  const form = el("form", "membership-form");
  const code = createInput("text", "الرمز الرباعي", {
    autocomplete: "one-time-code",
    inputMode: "numeric",
    maxLength: 4
  });

  const button = createButton("التحقق والمتابعة");
  const feedback = el("p", "vote-message", "");

  form.append(
    createFormField("رمز العضوية", code),
    button,
    feedback
  );

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const value = code.value.trim();

    if (!/^\d{4}$/.test(value)) {
      showMessage(feedback, "يجب أن يتكون الرمز من أربعة أرقام.", true);
      return;
    }

    button.disabled = true;
    button.textContent = "جارٍ التحقق...";

    try {
      const { data, error } = await db.rpc(
        "verify_membership_code_for_election",
        {
          p_election_id: election.id,
          p_code: value
        }
      );

      if (error) throw error;
      if (data !== true) throw new Error("تعذر تأكيد العضوية.");

      await renderAllElections();
    } catch (error) {
      showMessage(feedback, error.message || "الرمز غير صحيح.", true);
      button.disabled = false;
      button.textContent = "التحقق والمتابعة";
    }
  });

  section.append(form);
  return section;
}

/* عرض حالة التصويت */
async function loadProgress(election, card, member) {
  card.append(createAccountHeader(member));

  const { data: progress, error } = await db.rpc("get_voter_progress", {
    p_election_id: election.id
  });

  if (error) {
    card.append(el("p", "vote-message error", error.message));
    return;
  }

  if (!progress || !progress.length) {
    card.append(
      el("p", "vote-message", "لا توجد بنود تصويت مفعّلة حالياً.")
    );
    return;
  }

  for (const item of progress) {
    const section = el("section", "vote-item");
    section.append(el("h4", "", item.item_title));

    if (item.item_body) {
      section.append(el("p", "item-body", item.item_body));
    }

    if (item.has_voted) {
      section.append(
        el("p", "voted-label", "✓ تم تسجيل صوتك في هذا البند")
      );
      card.append(section);
      continue;
    }

    const { data: options, error: optionsError } = await db
      .from("election_item_options")
      .select("id,label,description")
      .eq("item_id", item.item_id)
      .eq("is_active", true)
      .order("sort_order");

    if (optionsError) {
      section.append(
        el("p", "vote-message error", "تعذر تحميل خيارات التصويت.")
      );
      card.append(section);
      continue;
    }

    if (!options || !options.length) {
      section.append(
        el("p", "vote-message error", "لم تُضف خيارات لهذا البند بعد.")
      );
      card.append(section);
      continue;
    }

    const form = el("form", "vote-form");
    const group = el("div", "vote-options");

    for (const option of options) {
      const label = el("label", "vote-option");
      const radio = document.createElement("input");

      radio.type = "radio";
      radio.name = "choice";
      radio.value = option.id;
      radio.required = true;

      label.append(radio, el("span", "", option.label));

      if (option.description) {
        label.append(el("small", "", option.description));
      }

      group.append(label);
    }

    const submit = createButton("تأكيد التصويت");
    const feedback = el("p", "vote-message", "");

    form.append(group, submit, feedback);

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const selected = form.querySelector(
        'input[name="choice"]:checked'
      );

      if (!selected) return;

      if (!window.confirm(
        "هل أنت متأكد من اختيارك؟ لا يمكن تكرار التصويت في هذا البند."
      )) return;

      submit.disabled = true;
      submit.textContent = "جارٍ تسجيل الصوت...";

      try {
        const { error: voteError } = await db.rpc(
          "cast_election_vote",
          {
            p_election_id: election.id,
            p_item_id: item.item_id,
            p_option_id: selected.value
          }
        );

        if (voteError) throw voteError;

        await renderAllElections();
      } catch (error) {
        showMessage(
          feedback,
          error.message || "حدث خطأ أثناء تسجيل التصويت.",
          true
        );

        submit.disabled = false;
        submit.textContent = "تأكيد التصويت";
      }
    });

    section.append(form);
    card.append(section);
  }
}

/* رسم بطاقة الانتخابات */
async function renderElection(election, memberships, verifiedIds) {
  const card = el("article", "election-card");
  card.append(el("h3", "", election.title));

  if (election.description) {
    card.append(el("p", "", election.description));
  }

  const member = memberships.find(
    item => item.election_id === election.id
  );

  if (!member) {
    card.append(
      el(
        "p",
        "vote-message",
        "لا توجد عضوية مفعّلة مرتبطة بحسابك في هذه الانتخابات."
      )
    );
    return card;
  }

  if (!verifiedIds.has(election.id)) {
    card.append(createElectionVerificationForm(election));
    return card;
  }

  await loadProgress(election, card, member);
  return card;
}

/* تحديث الواجهة */
async function renderAllElections() {
  if (rendering) return;
  rendering = true;

  try {
    list.replaceChildren();

    const { data: sessionData, error: sessionError } =
      await db.auth.getSession();

    if (sessionError) throw sessionError;

    const session = sessionData.session;
    const permanentAccount =
      session && session.user && session.user.is_anonymous !== true;

    if (!permanentAccount) {
      list.append(createAuthPanel());

      for (const election of electionsCache) {
        const card = el("article", "election-card");
        card.append(
          el("h3", "", election.title),
          el("p", "item-body", "سجل الدخول للمشاركة في هذه الانتخابات.")
        );
        list.append(card);
      }

      return;
    }

    const memberships = await getMemberships();
    const profile = await getProfileState();

    if (!profile || !profile.has_name) {
      list.append(createNameForm());
      return;
    }

    const profilePanel = await createMembershipCodesPanel();
    list.append(profilePanel, createLogoutButton());

    const verifiedIds = new Set();

    for (const election of electionsCache) {
      const { data, error } = await db.rpc(
        "is_election_membership_verified",
        { p_election_id: election.id }
      );

      if (error) throw error;
      if (data === true) verifiedIds.add(election.id);
    }

    for (const election of electionsCache) {
      const card = await renderElection(
        election,
        memberships,
        verifiedIds
      );

      list.append(card);
    }

  } catch (error) {
    console.error(error);

    list.replaceChildren(
      el(
        "p",
        "vote-message error",
        error.message || "تعذر تحميل بيانات العضوية."
      )
    );
  } finally {
    rendering = false;
  }
}

/* تحميل الانتخابات المنشورة */
async function init() {
  try {
    const { data: elections, error } = await db
      .from("elections")
      .select(
        "id,title,description,status,is_published,starts_at,ends_at,created_at"
      )
      .eq("is_published", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    electionsCache = elections || [];

    if (!electionsCache.length) {
      statusTitle.textContent = "لا توجد انتخابات منشورة حالياً";
      statusDescription.textContent =
        "ستظهر الانتخابات هنا بعد إعلان لجنة الإشراف عنها.";
      statusPill.textContent = "بانتظار النشر";
      return;
    }

    statusTitle.textContent =
      "الانتخابات المنشورة: " + electionsCache.length;

    statusDescription.textContent =
      "سجل الدخول أو أنشئ حساباً دائماً لربط عضويتك والمشاركة.";

    statusPill.textContent = "اتصال مباشر";

    await renderAllElections();

  } catch (error) {
    console.error(error);

    statusTitle.textContent = "تعذر تحميل بيانات الانتخابات";
    statusDescription.textContent =
      error.message || "تحقق من الاتصال بالمنصة.";
    statusPill.textContent = "تعذر الاتصال";
  }
}

init();
