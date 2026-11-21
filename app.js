document.getElementById("year").textContent = new Date().getFullYear();

(async function loadPublishedElections() {
  const title = document.getElementById("election-status-title");
  const description = document.getElementById("election-status-description");
  const pill = document.getElementById("election-status-pill");
  const list = document.getElementById("election-list");
  const SUPABASE_URL = "https://zwduejenlwnixsfpmqqx.supabase.co";
  // Publishable key: intended for browser use; never place service-role secrets here.
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QmwmpdoxTwZIr-YOfbAhGw_8Ep8nEDv";

  try {
    if (!window.supabase?.createClient) throw new Error("تعذر تحميل مكتبة الاتصال.");
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data: elections, error } = await client.from("elections")
      .select("id,title,description,status,is_published,starts_at,ends_at,show_results,created_at")
      .eq("is_published", true).order("created_at", { ascending: false });
    if (error) throw error;
    if (!elections?.length) {
      title.textContent = "لا توجد انتخابات منشورة حالياً";
      description.textContent = "عند إعلان لجنة الإشراف عن انتخابات جديدة، ستظهر تفاصيلها هنا.";
      pill.textContent = "بانتظار النشر";
      return;
    }
    title.textContent = "عدد الانتخابات المنشورة: " + elections.length;
    description.textContent = "هذه البيانات معروضة مباشرة من قاعدة بيانات المنصة.";
    pill.textContent = "محدّثة مباشرة";

    for (const election of elections) {
      const card = document.createElement("article"); card.className = "election-card";
      const heading = document.createElement("h3"); heading.textContent = election.title || "انتخابات بدون عنوان"; card.appendChild(heading);
      if (election.description) { const p = document.createElement("p"); p.textContent = election.description; card.appendChild(p); }
      const state = document.createElement("p"); state.className = "election-meta"; state.textContent = "الحالة: " + (election.status || "منشورة"); card.appendChild(state);
      const h4 = document.createElement("h4"); h4.textContent = "المترشحون"; card.appendChild(h4);
      const ul = document.createElement("ul"); ul.className = "candidate-list";
      const { data: candidates, error: candidateError } = await client.from("candidates")
        .select("id,name,description,sort_order,is_active").eq("election_id", election.id)
        .eq("is_active", true).order("sort_order", { ascending: true });
      if (candidateError) { const li = document.createElement("li"); li.textContent = "تعذر تحميل قائمة المترشحين حالياً."; ul.appendChild(li); }
      else if (!candidates?.length) { const li = document.createElement("li"); li.textContent = "لم تتم إضافة مترشحين بعد."; ul.appendChild(li); }
      else for (const candidate of candidates) {
        const li = document.createElement("li"); const strong = document.createElement("strong");
        strong.textContent = candidate.name; li.appendChild(strong);
        if (candidate.description) { const span = document.createElement("span"); span.textContent = " — " + candidate.description; li.appendChild(span); }
        ul.appendChild(li);
      }
      card.appendChild(ul); list.appendChild(card);
    }
  } catch (error) {
    console.error("Supabase connection error:", error);
    title.textContent = "تعذر تحميل بيانات الانتخابات";
    description.textContent = "تحقق من إعدادات الاتصال وصلاحيات القراءة في قاعدة البيانات.";
    pill.textContent = "تعذر الاتصال";
  }
})();
