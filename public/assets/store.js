(function(){
  "use strict";

  let designs = [];
  let settings = {
    businessName: "", businessEmail: "", quoteEmailEnabled: false,
    eventModeEnabled: false, kioskModeEnabled: false, kioskIdleMinutes: 2
  };
  let currentFilter = { cat: "all", q: "", type: "all" };

  const featuredSection = document.getElementById("featured-section");
  const featuredGrid = document.getElementById("featured-grid");
  const resultCount = document.getElementById("result-count");
  const emptyState = document.getElementById("empty-state");
  const searchInput = document.getElementById("search-input");
  const chipRow = document.getElementById("category-chips");
  const typeChipRow = document.getElementById("type-chips");
  const businessNameEl = document.getElementById("business-name");
  const heroSub = document.getElementById("hero-sub");
  const modalBackdrop = document.getElementById("modal-backdrop");
  const modal = document.getElementById("modal");
  const cartBtn = document.getElementById("quote-cart-btn");
  const cartCountEl = document.getElementById("quote-cart-count");
  const quoteBackdrop = document.getElementById("quote-backdrop");
  const quoteModal = document.getElementById("quote-modal");
  const offlineBanner = document.getElementById("offline-banner");
  const kioskToast = document.getElementById("kiosk-toast");
  const bookViewport = document.getElementById("book-viewport");
  const bookStage = document.getElementById("book-stage");
  const bookPageTop = document.getElementById("book-page-top");
  const bookPageBottom = document.getElementById("book-page-bottom");
  const bookPrevBtn = document.getElementById("book-prev-btn");
  const bookNextBtn = document.getElementById("book-next-btn");
  const bookPageIndicator = document.getElementById("book-page-indicator");

  const DESIGNS_CACHE_KEY = "catalogDesignsCache";
  const SETTINGS_CACHE_KEY = "catalogSettingsCache";
  const PENDING_QUOTES_KEY = "pendingQuoteRequests";
  const BOOK_PAGE_SIZE = 4;

  // ---- quote cart (slugs the customer wants a quote for) ----
  let cart = [];
  try{ cart = JSON.parse(sessionStorage.getItem("quoteCart") || "[]"); }catch(e){ cart = []; }

  function saveCart(){
    try{ sessionStorage.setItem("quoteCart", JSON.stringify(cart)); }catch(e){}
    updateCartUi();
  }
  function inCart(slug){ return cart.includes(slug); }
  function toggleCart(slug){
    if(inCart(slug)) cart = cart.filter(s => s !== slug);
    else cart.push(slug);
    saveCart();
  }
  function removeFromCart(slug){
    cart = cart.filter(s => s !== slug);
    saveCart();
  }
  function updateCartUi(){
    cartCountEl.textContent = cart.length;
    cartBtn.style.display = cart.length ? "flex" : "none";
    document.querySelectorAll(".quote-toggle").forEach(btn => {
      btn.classList.toggle("added", inCart(btn.dataset.slug));
      btn.textContent = inCart(btn.dataset.slug) ? "✓" : "+";
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  async function init(){
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    try{
      const [settingsRes, designsRes] = await Promise.all([
        fetch("/api/public/settings").then(r => r.json()),
        fetch("/api/public/designs").then(r => r.json())
      ]);
      settings = settingsRes;
      designs = designsRes.data || [];
      try{
        localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
        localStorage.setItem(DESIGNS_CACHE_KEY, JSON.stringify({ designs, cachedAt: new Date().toISOString() }));
      }catch(e){}
      offlineBanner.classList.remove("show");
      applySettingsUi();
      buildTypeChips();
      render();
      updateCartUi();
      startKioskTimer();
      flushPendingQuotes();
    }catch(err){
      // network failed — fall back to whatever we last cached on this device
      let cachedDesigns = null, cachedSettings = null;
      try{ cachedSettings = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || "null"); }catch(e){}
      try{ cachedDesigns = JSON.parse(localStorage.getItem(DESIGNS_CACHE_KEY) || "null"); }catch(e){}

      if(cachedDesigns && cachedSettings){
        settings = cachedSettings;
        designs = cachedDesigns.designs || [];
        applySettingsUi();
        buildTypeChips();
        render();
        updateCartUi();
        startKioskTimer();
        const when = new Date(cachedDesigns.cachedAt);
        offlineBanner.textContent = "You're offline — showing the catalog from " +
          (isNaN(when) ? "your last visit" : when.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })) + ".";
        offlineBanner.classList.add("show");
      } else {
        resultCount.textContent = "Couldn't load the catalog — check your connection and try again.";
      }
    }

    window.addEventListener("online", () => { offlineBanner.classList.remove("show"); flushPendingQuotes(); });
  }

  function applySettingsUi(){
    if(settings.businessName) businessNameEl.textContent = settings.businessName;
    heroSub.textContent = settings.eventModeEnabled
      ? "Here's what we brought today — ask us about anything else in the full catalog."
      : "Browse available designs — order online or request a quote.";
  }

  searchInput.addEventListener("input", () => {
    currentFilter.q = searchInput.value.trim().toLowerCase();
    render();
  });

  // ---- Pokémon type colors (matching the games' type-badge palette) ----
  const TYPE_COLORS = {
    normal:"#A8A878", fire:"#F08030", water:"#6890F0", electric:"#F8D030",
    grass:"#78C850", ice:"#98D8D8", fighting:"#C03028", poison:"#A040A0",
    ground:"#E0C068", flying:"#A890F0", psychic:"#F85888", bug:"#A8B820",
    rock:"#B8A038", ghost:"#705898", dragon:"#7038F8", dark:"#705848",
    steel:"#B8B8D0", fairy:"#EE99AC"
  };
  function typeColor(t){ return TYPE_COLORS[String(t).toLowerCase()] || "#68A090"; }

  chipRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if(!btn) return;
    const wasActive = btn.classList.contains("active");
    chipRow.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    if(wasActive && btn.dataset.cat !== "all"){
      chipRow.querySelector('[data-cat="all"]').classList.add("active");
      currentFilter.cat = "all";
    } else {
      btn.classList.add("active");
      currentFilter.cat = btn.dataset.cat;
    }
    render();
  });

  typeChipRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if(!btn) return;
    const wasActive = btn.classList.contains("active");
    typeChipRow.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    if(wasActive && btn.dataset.type !== "all"){
      typeChipRow.querySelector('[data-type="all"]').classList.add("active");
      currentFilter.type = "all";
    } else {
      btn.classList.add("active");
      currentFilter.type = btn.dataset.type;
    }
    render();
  });

  function buildTypeChips(){
    const types = new Set();
    for(const d of designs){
      if(d.pokemon && Array.isArray(d.pokemon.types)){
        for(const t of d.pokemon.types) if(t) types.add(t);
      }
    }
    const sorted = Array.from(types).sort((a, b) => a.localeCompare(b));
    typeChipRow.style.display = sorted.length ? "flex" : "none";
    if(!sorted.length){
      currentFilter.type = "all";
      return;
    }
    typeChipRow.innerHTML = '<button class="chip active" data-type="all">All types</button>';
    const frag = document.createDocumentFragment();
    for(const t of sorted){
      const btn = document.createElement("button");
      btn.className = "chip chip-type";
      btn.dataset.type = t;
      btn.textContent = t;
      const color = typeColor(t);
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = "#fff";
      frag.appendChild(btn);
    }
    typeChipRow.appendChild(frag);
  }

  function render(){
    let list = designs;
    if(currentFilter.cat !== "all") list = list.filter(d => d.category === currentFilter.cat);
    if(currentFilter.type !== "all") list = list.filter(d => d.pokemon && Array.isArray(d.pokemon.types) && d.pokemon.types.includes(currentFilter.type));
    if(currentFilter.q){
      const q = currentFilter.q;
      list = list.filter(d => {
        const hay = [d.title, d.slug, d.pokemon && d.pokemon.name, d.pokemon && String(d.pokemon.pokedex_number)]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    resultCount.textContent = list.length + (list.length === 1 ? " design" : " designs");
    emptyState.classList.toggle("show", list.length === 0);

    // Featured grouping only makes sense in normal mode (event mode already
    // filters the whole catalog down to featured items server-side) and only
    // at the default view — once someone searches or picks a category, just
    // show the flat filtered results like any other catalog.
    const showFeaturedSplit = !settings.eventModeEnabled && currentFilter.cat === "all" && currentFilter.type === "all" && !currentFilter.q &&
      designs.some(d => d.is_featured);

    if(showFeaturedSplit){
      const featured = designs.filter(d => d.is_featured);
      featuredGrid.innerHTML = "";
      const ffrag = document.createDocumentFragment();
      for(const d of featured) ffrag.appendChild(buildCard(d, featured));
      featuredGrid.appendChild(ffrag);
      featuredSection.style.display = "block";
    } else {
      featuredSection.style.display = "none";
    }

    bookList = list;
    bookPages = [];
    for(let i = 0; i < list.length; i += BOOK_PAGE_SIZE) bookPages.push(list.slice(i, i + BOOK_PAGE_SIZE));
    showBookPage(0, 0);
  }

  // ---- the "book": paginates the current results 4-per-page, with a real page-turn animation ----
  let bookList = [];
  let bookPages = [];
  let bookIndex = 0;
  let bookAnimating = false;

  function fillBookPage(container, pageIndex){
    container.innerHTML = "";
    const items = bookPages[pageIndex] || [];
    const frag = document.createDocumentFragment();
    for(const d of items) frag.appendChild(buildCard(d, bookList));
    container.appendChild(frag);
  }

  function updateBookNav(){
    const total = bookPages.length;
    bookPageIndicator.textContent = total ? ("Page " + (bookIndex + 1) + " of " + total) : "";
    bookPrevBtn.disabled = bookIndex <= 0;
    bookNextBtn.disabled = total === 0 || bookIndex >= total - 1;
  }

  function showBookPage(index, dir){
    const total = bookPages.length;
    if(total === 0){
      bookViewport.style.display = "none";
      bookPageIndicator.textContent = "";
      bookPageTop.innerHTML = "";
      bookPageBottom.innerHTML = "";
      bookIndex = 0;
      return;
    }
    bookViewport.style.display = "flex";
    index = Math.max(0, Math.min(index, total - 1));

    if(!dir){
      bookIndex = index;
      fillBookPage(bookPageTop, index);
      bookPageBottom.innerHTML = "";
      updateBookNav();
      return;
    }

    bookAnimating = true;
    fillBookPage(bookPageBottom, index);
    bookPageTop.classList.remove("flip-next", "flip-prev");
    void bookPageTop.offsetWidth; // restart animation
    bookPageTop.classList.add(dir > 0 ? "flip-next" : "flip-prev");

    const onEnd = () => {
      bookPageTop.removeEventListener("animationend", onEnd);
      bookPageTop.classList.remove("flip-next", "flip-prev");
      bookIndex = index;
      fillBookPage(bookPageTop, index);
      bookAnimating = false;
      updateBookNav();
    };
    bookPageTop.addEventListener("animationend", onEnd);
  }

  function gotoBookPage(newIndex, dir){
    if(bookAnimating) return;
    if(newIndex < 0 || newIndex >= bookPages.length) return;
    showBookPage(newIndex, dir);
  }

  bookPrevBtn.addEventListener("click", () => gotoBookPage(bookIndex - 1, -1));
  bookNextBtn.addEventListener("click", () => gotoBookPage(bookIndex + 1, 1));

  document.addEventListener("keydown", (e) => {
    if(modalBackdrop.classList.contains("show")) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if(tag === "INPUT" || tag === "TEXTAREA") return;
    if(e.key === "ArrowRight") gotoBookPage(bookIndex + 1, 1);
    else if(e.key === "ArrowLeft") gotoBookPage(bookIndex - 1, -1);
  });

  // touch swipe on the book itself: left = next page, right = previous page
  let bookTouchStartX = null, bookTouchStartY = null;
  bookStage.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    bookTouchStartX = t.clientX; bookTouchStartY = t.clientY;
  }, { passive: true });
  bookStage.addEventListener("touchend", (e) => {
    if(bookTouchStartX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - bookTouchStartX;
    const dy = t.clientY - bookTouchStartY;
    bookTouchStartX = null; bookTouchStartY = null;
    if(Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5){
      if(dx < 0) gotoBookPage(bookIndex + 1, 1);
      else gotoBookPage(bookIndex - 1, -1);
    }
  }, { passive: true });

  function buildCard(d, list){
    const card = document.createElement("div");
    card.className = "card";
    card.addEventListener("click", () => openModal(d, list));

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "card-thumb-wrap";
    if(d.image_url){
      const img = document.createElement("img");
      img.src = d.image_url; img.loading = "lazy"; img.alt = d.title;
      thumbWrap.appendChild(img);
    }
    if(d.is_extra){
      const b = document.createElement("div"); b.className = "badge"; b.textContent = "limited";
      thumbWrap.appendChild(b);
    }
    if(d.sprite_url){
      const spriteWrap = document.createElement("div");
      spriteWrap.className = "sprite-badge";
      const sprite = document.createElement("img");
      sprite.src = d.sprite_url; sprite.loading = "lazy"; sprite.alt = "";
      spriteWrap.appendChild(sprite);
      thumbWrap.appendChild(spriteWrap);
    }
    const qToggle = document.createElement("button");
    qToggle.className = "quote-toggle" + (inCart(d.slug) ? " added" : "");
    qToggle.textContent = inCart(d.slug) ? "✓" : "+";
    qToggle.dataset.slug = d.slug;
    qToggle.title = "Add to quote request";
    qToggle.addEventListener("click", (e) => { e.stopPropagation(); toggleCart(d.slug); });
    thumbWrap.appendChild(qToggle);
    card.appendChild(thumbWrap);

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.className = "card-title"; title.textContent = d.title;
    body.appendChild(title);
    const bottom = document.createElement("div");
    bottom.className = "card-bottom";
    const price = document.createElement("span");
    if(d.has_price){
      price.className = "card-price"; price.textContent = d.price;
    } else {
      price.className = "card-price unset"; price.textContent = "Ask for pricing";
    }
    bottom.appendChild(price);
    body.appendChild(bottom);
    card.appendChild(body);
    return card;
  }

  // ---- "book" modal: swipe/arrow through the current list like flipping pages ----
  let modalList = [];
  let modalIndex = -1;

  function openModal(d, list){
    modalList = list && list.length ? list : [d];
    modalIndex = modalList.findIndex(x => x.slug === d.slug);
    if(modalIndex < 0) modalIndex = 0;
    modalBackdrop.classList.add("show");
    renderModalPage(modalIndex, 0);
  }

  function gotoModal(newIndex, dir){
    if(newIndex < 0 || newIndex >= modalList.length) return;
    renderModalPage(newIndex, dir);
  }

  function renderModalPage(index, dir){
    modalIndex = index;
    const d = modalList[index];
    modal.innerHTML = renderModalHtml(d, index, modalList.length);
    modal.scrollTop = 0;

    document.getElementById("modal-close-btn").addEventListener("click", closeModal);
    const prevBtn = document.getElementById("modal-prev-btn");
    const nextBtn = document.getElementById("modal-next-btn");
    if(prevBtn) prevBtn.addEventListener("click", () => gotoModal(modalIndex - 1, -1));
    if(nextBtn) nextBtn.addEventListener("click", () => gotoModal(modalIndex + 1, 1));

    const qToggle = document.getElementById("modal-quote-toggle");
    qToggle.addEventListener("click", () => {
      toggleCart(d.slug);
      const added = inCart(d.slug);
      qToggle.classList.toggle("added", added);
      qToggle.textContent = added ? "✓ Added to quote request" : "+ Add to quote request";
    });

    if(dir){
      modal.classList.remove("page-in-left", "page-in-right");
      void modal.offsetWidth; // restart animation
      modal.classList.add(dir > 0 ? "page-in-left" : "page-in-right");
    }
  }

  function closeModal(){
    modalBackdrop.classList.remove("show");
    modalList = []; modalIndex = -1;
  }
  modalBackdrop.addEventListener("click", (e) => { if(e.target === modalBackdrop) closeModal(); });

  document.addEventListener("keydown", (e) => {
    if(!modalBackdrop.classList.contains("show")) return;
    if(e.key === "ArrowRight") gotoModal(modalIndex + 1, 1);
    else if(e.key === "ArrowLeft") gotoModal(modalIndex - 1, -1);
    else if(e.key === "Escape") closeModal();
  });

  // touch swipe: left = next page, right = previous page
  let touchStartX = null, touchStartY = null;
  modal.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStartX = t.clientX; touchStartY = t.clientY;
  }, { passive: true });
  modal.addEventListener("touchend", (e) => {
    if(touchStartX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    touchStartX = null; touchStartY = null;
    if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5){
      if(dx < 0) gotoModal(modalIndex + 1, 1);
      else gotoModal(modalIndex - 1, -1);
    }
  }, { passive: true });

  function cartMailtoFallback(items, customer){
    if(!settings.businessEmail) return null;
    const subject = encodeURIComponent("Quote request (" + items.length + " design" + (items.length > 1 ? "s" : "") + ")");
    const lines = items.map(d => "- " + d.title + (d.has_price ? " (" + d.price + ")" : " (price on request)"));
    const bodyParts = [
      "Hi, I'd like a quote for the following design(s):",
      "",
      lines.join("\n"),
      "",
      customer && customer.notes ? "Notes: " + customer.notes : "",
      ""
    ].filter(Boolean);
    const body = encodeURIComponent(bodyParts.join("\n"));
    return "mailto:" + settings.businessEmail + "?subject=" + subject + "&body=" + body;
  }

  // ---- quote request modal ----
  cartBtn.addEventListener("click", openQuoteModal);
  quoteBackdrop.addEventListener("click", (e) => { if(e.target === quoteBackdrop) closeQuoteModal(); });

  function openQuoteModal(){
    renderQuoteModal();
    quoteBackdrop.classList.add("show");
  }
  function closeQuoteModal(){ quoteBackdrop.classList.remove("show"); }

  function renderQuoteModal(){
    const items = designs.filter(d => cart.includes(d.slug));
    let html = '<h2>Request a quote</h2>';
    if(items.length === 0){
      html += '<div class="qm-empty">No designs added yet — tap the + on any design to add it here.</div>';
      quoteModal.innerHTML = html;
      return;
    }
    for(const d of items){
      html += '<div class="qm-item">';
      html += d.image_url ? '<img src="' + escapeHtml(d.image_url) + '" alt="">' : '<div style="width:36px;height:36px;"></div>';
      html += '<div class="name">' + escapeHtml(d.title) + '</div>';
      html += '<div style="color:var(--text-faint);font-size:0.78rem;">' + (d.has_price ? escapeHtml(d.price) : "TBD") + '</div>';
      html += '<button class="remove" data-slug="' + escapeHtml(d.slug) + '">✕</button>';
      html += '</div>';
    }
    html += '<div class="qm-field"><label for="qm-name">Name</label><input id="qm-name" type="text" placeholder="Your name"></div>';
    html += '<div class="qm-field"><label for="qm-email">Email' + (settings.quoteEmailEnabled ? ' (we\'ll send your PDF quote here)' : '') + '</label><input id="qm-email" type="email" placeholder="you@example.com" required></div>';
    html += '<div class="qm-field"><label for="qm-notes">Notes (optional)</label><textarea id="qm-notes" rows="3" placeholder="Colors, quantities, deadlines…"></textarea></div>';
    html += '<button id="quote-submit-btn">' + (settings.quoteEmailEnabled ? "Email me a PDF quote" : "Request a quote") + '</button>';
    html += '<div id="quote-form-status"></div>';
    quoteModal.innerHTML = html;

    quoteModal.querySelectorAll(".remove").forEach(btn => {
      btn.addEventListener("click", () => { removeFromCart(btn.dataset.slug); renderQuoteModal(); });
    });
    document.getElementById("quote-submit-btn").addEventListener("click", () => submitQuote(items));
  }

  async function submitQuote(items){
    const nameEl = document.getElementById("qm-name");
    const emailEl = document.getElementById("qm-email");
    const notesEl = document.getElementById("qm-notes");
    const submitBtn = document.getElementById("quote-submit-btn");
    const status = document.getElementById("quote-form-status");
    const customer = { name: nameEl.value.trim(), email: emailEl.value.trim(), notes: notesEl.value.trim() };

    if(!customer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)){
      status.className = "err"; status.textContent = "Enter a valid email address.";
      return;
    }

    if(!settings.quoteEmailEnabled){
      const mailto = cartMailtoFallback(items, customer);
      if(mailto){ window.location.href = mailto; }
      else { status.className = "err"; status.textContent = "Quotes aren't available right now — please contact us directly."; }
      return;
    }

    const payload = { name: customer.name, email: customer.email, notes: customer.notes, slugs: items.map(d => d.slug) };

    submitBtn.disabled = true;
    status.className = ""; status.textContent = "Sending…";
    try{
      const res = await fetch("/api/public/quote-request", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if(!res.ok) throw new Error(j.error || "Something went wrong.");
      status.className = "ok";
      status.textContent = "Quote sent to " + customer.email + " — check your inbox in a minute.";
      cart = []; saveCart();
      setTimeout(closeQuoteModal, 2200);
    }catch(err){
      if(err instanceof TypeError){
        // fetch only throws TypeError for actual network failures, not HTTP error statuses
        queuePendingQuote(payload);
        status.className = "ok";
        status.textContent = "You're offline — this quote is saved and will send automatically once you're back online.";
        cart = []; saveCart();
        setTimeout(closeQuoteModal, 2600);
      } else {
        status.className = "err";
        status.textContent = err.message || "Couldn't send that — please try again.";
      }
    }finally{
      submitBtn.disabled = false;
    }
  }

  // ---- offline quote queue ----
  function getPendingQuotes(){
    try{ return JSON.parse(localStorage.getItem(PENDING_QUOTES_KEY) || "[]"); }catch(e){ return []; }
  }
  function setPendingQuotes(list){
    try{ localStorage.setItem(PENDING_QUOTES_KEY, JSON.stringify(list)); }catch(e){}
  }
  function queuePendingQuote(payload){
    const list = getPendingQuotes();
    list.push(payload);
    setPendingQuotes(list);
  }
  async function flushPendingQuotes(){
    const list = getPendingQuotes();
    if(!list.length) return;
    const remaining = [];
    for(const payload of list){
      try{
        const res = await fetch("/api/public/quote-request", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify(payload)
        });
        if(!res.ok && res.status !== 400){
          // server reachable but failed for a non-client reason (e.g. SMTP down) — try again later
          remaining.push(payload);
        }
        // ok, or a 400 (bad request we can't fix by retrying) — drop it either way
      }catch(err){
        remaining.push(payload); // still offline — keep it queued
      }
    }
    setPendingQuotes(remaining);
  }

  // ---- kiosk mode: reset the storefront after a stretch of inactivity ----
  let kioskTimer = null;
  function startKioskTimer(){
    clearTimeout(kioskTimer);
    if(!settings.kioskModeEnabled) return;
    const ms = Math.max(0.5, settings.kioskIdleMinutes || 2) * 60 * 1000;
    kioskTimer = setTimeout(doKioskReset, ms);
  }
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(evt => {
    window.addEventListener(evt, () => { if(settings.kioskModeEnabled) startKioskTimer(); }, { passive: true });
  });

  function doKioskReset(){
    closeModal();
    closeQuoteModal();
    cart = []; saveCart();
    currentFilter = { cat: "all", q: "", type: "all" };
    searchInput.value = "";
    chipRow.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.cat === "all"));
    typeChipRow.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.type === "all"));
    window.scrollTo({ top: 0, behavior: "auto" });
    render();
    showKioskToast("Ready for the next guest");
    startKioskTimer();
  }

  function showKioskToast(text){
    kioskToast.textContent = text;
    kioskToast.classList.add("show");
    setTimeout(() => kioskToast.classList.remove("show"), 2200);
  }

  function renderModalHtml(d, index, total){
    const poke = d.pokemon;
    let html = "";
    html += '<div class="modal-topbar">';
    html += '<button class="modal-nav-btn" id="modal-prev-btn" aria-label="Previous design"' + (index <= 0 ? ' disabled' : '') + '>‹</button>';
    html += '<div class="modal-page-indicator">' + (index + 1) + ' / ' + total + '</div>';
    html += '<button class="modal-nav-btn" id="modal-next-btn" aria-label="Next design"' + (index >= total - 1 ? ' disabled' : '') + '>›</button>';
    html += '<button class="modal-close" id="modal-close-btn">✕</button>';
    html += '</div>';
    if(d.image_url){
      html += '<div class="modal-hero-wrap">';
      html += '<img class="modal-hero" src="' + escapeHtml(d.image_url) + '" alt="">';
      if(d.sprite_url) html += '<div class="sprite-badge modal-sprite-badge"><img src="' + escapeHtml(d.sprite_url) + '" alt=""></div>';
      html += '</div>';
    }
    html += '<div class="modal-body">';
    html += '<h2>' + escapeHtml(d.title) + '</h2>';
    html += '<div class="modal-sub">';
    if(poke && poke.types && poke.types.length){
      html += '<span class="type-badges">' + poke.types.map(t =>
        '<span class="type-badge" style="background:' + typeColor(t) + '">' + escapeHtml(t) + '</span>'
      ).join("") + '</span>';
    }
    if(d.is_extra) html += '<span class="modal-sub-extra">limited item</span>';
    html += '</div>';
    if(poke && poke.description) html += '<div class="modal-flavor">' + escapeHtml(poke.description) + '</div>';

    html += '<div class="stat-grid">';
    html += statBox("print time", d.print_time || "—");
    html += statBox("weight", d.total_weight_grams != null ? d.total_weight_grams + " g" : "—");
    html += statBox("price", d.has_price ? d.price : "Ask");
    html += '</div>';

    if(d.filaments && d.filaments.length){
      html += '<div class="section-label">Filaments</div>';
      for(const f of d.filaments){
        html += '<div class="filament-row">';
        html += '<div class="swatch" style="background:' + (f.hex_color || "#444") + '"></div>';
        html += '<div class="fname">' + escapeHtml(f.color) + ' <span style="color:var(--text-faint)">· ' + escapeHtml(f.series) + '</span></div>';
        html += '<div class="fgrams">' + f.weight_grams + 'g</div>';
        html += '</div>';
      }
    }
    html += '</div>'; // modal-body

    html += '<div class="modal-actions">';
    if(d.shop_url){
      html += '<a class="cta-btn" href="' + escapeHtml(d.shop_url) + '" target="_blank" rel="noopener">Order online</a>';
    }
    html += '<button class="modal-quote-toggle' + (inCart(d.slug) ? ' added' : '') + '" id="modal-quote-toggle" data-slug="' + escapeHtml(d.slug) + '">' +
      (inCart(d.slug) ? '✓ Added to quote request' : '+ Add to quote request') + '</button>';
    html += '</div>';
    return html;
  }

  function statBox(label, val){
    return '<div class="stat-box"><div class="label">' + escapeHtml(label) + '</div><div class="val">' + escapeHtml(String(val)) + '</div></div>';
  }

  updateCartUi();
  init();
})();
