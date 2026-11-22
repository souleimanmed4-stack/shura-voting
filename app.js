
document.getElementById("year").textContent = new Date().getFullYear();

const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: "shura-voter-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const list = document.getElementById("election-list");
const statusTitle = document.getElementById("election-status-title");
const statusDescription = document.getElementById("election-status-description");
const statusPill = document.getElementById("election-status-pill");
const savedKey = "shura-voter-elections-v1";

function savedMemberships() {
  try { return JSON.parse(localStorage.getItem(savedKey) || "{}"); }
  catch { return {}; }
}
function saveMembership(electionId, member) {
  const all = savedMemberships();
  all[electionId] = member;
  localStorage.setItem(savedKey, JSON.stringify(all));
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function ensureVoterSession() {
  let { data, error } = await db.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    const signed = await db.auth.signInAnonymously();
    if (signed.error) throw signed.error;
    data = { session: signed.data.session };
  }
  if (!data.session?.user || data.session.user.is_anonymous !== true) {
    throw new Error("جلسة الناخب غير متاحة. افتح رابط التصويت في متصفح مستقل.");
  }
}
async function loadProgress(electionId, card, member) {
  card.replaceChildren();
  card.append(el("h3", "", member.full_name || "تم التحقق من العضوية"));
  card.append(el("p", "", "أهلاً بك. يمكنك التصويت مرة واحدة في كل بند، وتبقى عضويتك محفوظة على هذا الجهاز."));
  const { data: progress, error } = await db.rpc("get_voter_progress", { p_election_id: electionId });
  if (error) { card.append(el("p", "vote-message error", error.message)); return; }
  if (!progress?.length) { card.append(el("p", "vote-message", "لا توجد بنود تصويت مفعّلة حالياً.")); return; }

  for (const item of progress) {
    const section = el("section", "vote-item");
    section.append(el("h4", "", item.item_title));
    if (item.item_body) section.append(el("p", "item-body", item.item_body));
    if (item.has_voted) {
      section.append(el("p", "voted-label", "✓ تم تسجيل صوتك في هذا البند"));
    } else {
      const { data: options, error: optionsError } = await db.from("election_item_options")
        .select("id,label,description").eq("item_id", item.item_id).eq("is_active", true).order("sort_order");
      if (optionsError) { section.append(el("p", "vote-message error", "تعذر تحميل الخيارات.")); card.append(section); continue; }
      if (!options?.length) { section.append(el("p", "vote-message error", "لم تُضف خيارات لهذا البند بعد.")); card.append(section); continue; }

      const form = el("form", "vote-form");
      const group = el("div", "vote-options");
      for (const option of options) {
        const label = el("label", "vote-option");
        const radio = document.createElement("input");
        radio.type = "radio"; radio.name = "choice"; radio.value = option.id; radio.required = true;
        label.append(radio, el("span", "", option.label));
        if (option.description) label.append(el("small", "", option.description));
        group.append(label);
      }
      form.append(group);
      const submit = el("button", "vote-submit", "تأكيد التصويت");
      submit.type = "submit";
      const feedback = el("p", "vote-message", "");
      form.append(submit, feedback);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const selected = form.querySelector('input[name="choice"]:checked');
        if (!selected) return;
        submit.disabled = true; submit.textContent = "جارٍ تسجيل الصوت...";
        const { error: voteError } = await db.rpc("cast_election_vote", {
          p_election_id: electionId, p_item_id: item.item_id, p_option_id: selected.value
        });
        if (voteError) {
          feedback.textContent = voteError.message.includes("سبق لك") ? "سبق تسجيل صوتك في هذا البند." : voteError.message;
          feedback.classList.add("error");
          submit.disabled = false; submit.textContent = "تأكيد التصويت";
        } else {
          await loadProgress(electionId, card, member);
        }
      });
      section.append(form);
    }
    card.append(section);
  }
}
async function renderElection(election) {
  const card = el("article", "election-card");
  card.append(el("h3", "", election.title));
  if (election.description) card.append(el("p", "", election.description));
  const saved = savedMemberships()[election.id];
  if (saved?.verified) {
    await loadProgress(election.id, card, saved);
    return card;
  }

  card.append(el("p", "", "أدخل رمز العضوية المخصص لك للمشاركة في هذه الانتخابات."));
  const form = el("form", "membership-form");
  const input = document.createElement("input");
  input.type = "text"; input.inputMode = "text"; input.autocomplete = "one-time-code";
  input.maxLength = 24; input.minLength = 24; input.required = true;
  input.placeholder = "رمز العضوية المكوّن من 24 خانة";
  input.setAttribute("aria-label", "رمز العضوية");
  const button = el("button", "vote-submit", "التحقق والدخول");
  button.type = "submit";
  const feedback = el("p", "vote-message", "");
  form.append(input, button, feedback);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase().replace(/\s/g, "");
    if (!/^[A-F0-9]{24}$/.test(code)) {
      feedback.textContent = "تحقق من الرمز؛ يجب أن يتكون من 24 خانة من الأحرف A-F والأرقام.";
      feedback.classList.add("error"); return;
    }
    button.disabled = true; button.textContent = "جارٍ التحقق...";
    try {
      await ensureVoterSession();
      const { data, error } = await db.rpc("redeem_membership_code", { p_election_id: election.id, p_code: code });
      if (error) throw error;
      const member = { voter_id: data[0].voter_id, full_name: data[0].full_name, verified: true };
      saveMembership(election.id, member);
      await loadProgress(election.id, card, member);
    } catch (error) {
      feedback.textContent = error.message || "تعذر التحقق من الرمز.";
      feedback.classList.add("error");
      button.disabled = false; button.textContent = "التحقق والدخول";
    }
  });
  card.append(form);
  return card;
}
(async function init() {
  try {
    const { data: elections, error } = await db.from("elections")
      .select("id,title,description,status,is_published,starts_at,ends_at")
      .eq("is_published", true).order("created_at", { ascending: false });
    if (error) throw error;
    list.replaceChildren();
    if (!elections?.length) {
      statusTitle.textContent = "لا توجد انتخابات منشورة حالياً";
      statusDescription.textContent = "ستظهر الانتخابات هنا بعد إعلان لجنة الإشراف عنها.";
      statusPill.textContent = "بانتظار النشر";
      return;
    }
    statusTitle.textContent = "الانتخابات المنشورة: " + elections.length;
    statusDescription.textContent = "استخدم رمز العضوية المخصص لك للدخول والتصويت.";
    statusPill.textContent = "اتصال مباشر";
    for (const election of elections) list.append(await renderElection(election));
  } catch (error) {
    console.error(error);
    statusTitle.textContent = "تعذر تحميل بيانات الانتخابات";
    statusDescription.textContent = error.message || "تحقق من الاتصال بالمنصة.";
    statusPill.textContent = "تعذر الاتصال";
  }
})();
