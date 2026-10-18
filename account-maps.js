(function () {
  "use strict";
  const api = globalThis.CosmowarEditorUI;
  if (!api) return;
  const configured = document.querySelector('meta[name="feedback-url"]')?.content;
  let feedback;
  try { feedback = new URL(configured); if (!/^https?:$/.test(feedback.protocol)) return; } catch { return; }
  let player = null;
  let current = null;
  let maps = [];
  let baseline = "";
  let dirty = false;
  let busy = false;
  let polling;
  const overlays = [];
  const controls = [];
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const button = (text, click, className = "btn") => { const node = make("button", text, className); node.type = "button"; node.addEventListener("click", click); return node; };
  const toast = make("p", "", "account-notice"); toast.setAttribute("role", "status"); toast.hidden = true; document.body.append(toast);
  let toastTimer;
  function tell(message) { toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6500); }
  async function request(path, method = "GET", body) {
    const response = await fetch(new URL(path, feedback), { method, credentials: "include", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { player = null; sync(); }
      throw new Error(result.error || "The account service could not complete that request.");
    }
    return result;
  }
  function signIn() {
    // Keep the existing local autosave intact through sign-in; no session token enters browser storage.
    const url = new URL("/sign-in", feedback);
    const destination = new URL(location.href); destination.searchParams.set("gallery", "1");
    url.searchParams.set("next", destination.href); location.assign(url.href);
  }
  function labels(map) {
    const values = ["Defuse"];
    if (map.acceptedRevision !== null) values.push("Accepted");
    if (map.submittedRevision !== null && map.submittedRevision !== map.acceptedRevision) values.push("Submitted");
    if (map.submittedRevision === null || map.revision > map.submittedRevision) values.push("Draft");
    return values;
  }
  function sync() {
    for (const item of controls) {
      item.title.textContent = current ? `${current.name}${dirty ? " •" : ""}` : "Local draft";
      item.title.title = current ? `Revision ${current.revision}${dirty ? " · Unsaved changes" : " · Saved"}` : "Save this draft to your account";
      item.identity.textContent = player ? player.displayName : "Sign in";
      item.save.disabled = busy; item.submit.disabled = busy;
    }
  }
  function close(overlay) { overlay.remove(); const i = overlays.indexOf(overlay); if (i >= 0) overlays.splice(i, 1); overlay.returnFocus?.focus(); }
  function dialog(title, wide = false) {
    const overlay = make("div", "", "account-scrim");
    overlay.returnFocus = document.activeElement;
    const panel = make("section", "", `account-dialog${wide ? " account-wide" : ""}`);
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", title); panel.tabIndex = -1;
    const header = make("header"); header.append(make("h2", title), button("Close", () => close(overlay)));
    panel.append(header); overlay.append(panel); overlays.push(overlay); document.body.append(overlay);
    overlay.addEventListener("click", event => { if (event.target === overlay && !busy) close(overlay); });
    panel.focus(); return { panel, overlay };
  }
  document.addEventListener("keydown", event => {
    const overlay = overlays.at(-1);
    if (!overlay) return;
    // The canvas keyboard handlers must not edit a map while a gallery dialog is open.
    event.stopPropagation();
    if (event.key === "Escape" && !busy) { event.preventDefault(); close(overlay); }
    if (event.key === "Tab") {
      const nodes = [...overlay.querySelectorAll('button:not(:disabled), input, select, a[href], [tabindex="0"]')].filter(n => n.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.firstChild)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  function field(label, value, maxLength = 80) { const wrap = make("label"); wrap.append(make("span", label)); const input = make("input"); input.value = value || ""; input.maxLength = maxLength; wrap.append(input); return { wrap, input }; }
  function updateUrl(id) { const url = new URL(location.href); url.searchParams.delete("gallery"); if (id) url.searchParams.set("map", id); else url.searchParams.delete("map"); window.history.replaceState(null, "", url); }
  function changed() {
    clearTimeout(polling);
    polling = setTimeout(() => { try { dirty = JSON.stringify(api.getDocument()) !== baseline; sync(); } catch { dirty = true; sync(); } }, 200);
  }
  window.addEventListener("cosmowar-document-change", changed);
  window.addEventListener("cosmowar-new-document", () => { current = null; baseline = ""; dirty = true; updateUrl(null); sync(); });
  window.addEventListener("beforeunload", event => { if (dirty && player) { event.preventDefault(); event.returnValue = ""; } });

  async function openMap(id, overlay) {
    if (busy || dirty && !confirm("Open this map and replace your local unsaved changes?")) return;
    busy = true; sync();
    try {
      const result = await request(`/api/maps/${encodeURIComponent(id)}`);
      api.openDocument(result.map.content);
      current = result.map; baseline = JSON.stringify(api.getDocument()); dirty = false; updateUrl(id); sync();
      if (overlay) close(overlay);
    } catch (error) { tell(error.message); }
    finally { busy = false; sync(); }
  }
  async function gallery() {
    if (!player) return signIn();
    const { panel, overlay } = dialog("My maps", true);
    const search = field("Search maps", "", 120); search.input.type = "search";
    const folder = make("select"); folder.setAttribute("aria-label", "Folder");
    const status = make("select"); status.setAttribute("aria-label", "Submission status");
    for (const label of ["All statuses", "Draft", "Submitted", "Accepted"]) { const option = make("option", label); option.value = label; status.append(option); }
    const toolbar = make("div", "", "account-filters"); toolbar.append(search.wrap, folder, status, button("New map", () => { if (busy) return; if (api.newMap()) close(overlay); }));
    const list = make("div", "", "account-map-grid"); const message = make("p", "Loading your maps…", "account-hint");
    panel.append(toolbar, message, list);
    function render() {
      list.replaceChildren();
      const query = search.input.value.toLowerCase();
      const shown = maps.filter(map => (!query || `${map.name} ${map.folder} Defuse`.toLowerCase().includes(query)) && (folder.value === "*" || map.folder === folder.value) && (status.value === "All statuses" || labels(map).includes(status.value)));
      message.textContent = maps.length ? `${shown.length} of ${maps.length} maps · Defuse` : "Your gallery is empty. Save your current draft to start.";
      for (const map of shown) {
        const card = make("article", "", "account-map-card");
        card.append(make("h3", map.name), make("p", map.folder || "Unfiled", "account-hint"));
        const tags = make("div", "", "account-tags"); labels(map).forEach(label => tags.append(make("span", label, `account-tag tag-${label.toLowerCase()}`))); card.append(tags);
        card.append(make("p", `Revision ${map.revision} · ${new Date(map.updatedAt).toLocaleDateString()}`, "account-hint"));
        const actions = make("div", "", "account-card-actions"); actions.append(button("Open in editor", () => void openMap(map.id, overlay), "btn primary"));
        if (map.reportId) { const link = make("a", "Feedback", "btn"); link.href = new URL(`/r/${map.reportId}`, feedback).href; actions.append(link); }
        card.append(actions); list.append(card);
      }
    }
    search.input.addEventListener("input", render); folder.addEventListener("change", render); status.addEventListener("change", render);
    try {
      maps = (await request("/api/maps")).maps;
      const folders = ["*", ...new Set(["", ...maps.map(map => map.folder)])];
      for (const path of folders) { const option = make("option", path === "*" ? "All folders" : path || "Unfiled"); option.value = path; folder.append(option); }
      render(); search.input.focus();
    } catch (error) { message.textContent = error.message; }
  }
  function saveDialog(submit = false) {
    if (!player) return signIn();
    if (!player.nameConfirmed) { const welcome = new URL("/welcome", feedback); welcome.searchParams.set("next", location.href); location.assign(welcome.href); return; }
    const { panel, overlay } = dialog(submit ? "Submit map for review" : "Save map");
    const form = make("form", "", "account-save-form");
    const name = field("Map name", current?.name || ""); name.input.required = true;
    const folder = field("Folder", current?.folder || ""); folder.input.placeholder = "e.g. In progress / Arenas";
    const mode = make("p", "Game mode: Defuse", "account-hint");
    const note = make("p", submit ? "This saves a revision and opens its feedback conversation with the map review team. Later changes require another approval." : "Your draft is saved to your account. Submitted and accepted revisions stay available for review.", "account-hint");
    const errorLine = make("p", "", "account-error"); errorLine.setAttribute("role", "status");
    const save = make("button", submit ? "Save and submit" : "Save to account", "btn primary"); save.type = "submit";
    form.append(name.wrap, folder.wrap, mode, note, errorLine, save); panel.append(form); name.input.focus();
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (busy) return;
      busy = true; sync(); save.disabled = true; errorLine.textContent = "";
      try {
        const content = api.getDocument();
        if (submit) { const problem = api.validateDocument(); if (problem) throw new Error(problem); }
        const sent = JSON.stringify(content);
        const result = await request(current ? `/api/maps/${encodeURIComponent(current.id)}` : "/api/maps", current ? "PUT" : "POST", { name: name.input.value.trim(), folder: folder.input.value.trim(), mode: "defuse", content, ...(current ? { revision: current.revision } : {}) });
        current = result.map; baseline = sent; dirty = JSON.stringify(api.getDocument()) !== sent; updateUrl(current.id); sync();
        if (submit) {
          const submitted = await request(`/api/maps/${encodeURIComponent(current.id)}/submit`, "POST", { revision: current.revision });
          current = submitted.map;
          // Navigation follows the same feedback session that saved and submitted this map.
          location.assign(new URL(submitted.url, feedback).href);
        } else { close(overlay); tell(`Saved ${current.name} · Revision ${current.revision}`); }
      } catch (error) { errorLine.textContent = error.message; }
      finally { busy = false; save.disabled = false; sync(); }
    });
  }
  for (const host of [document.querySelector("#shellNew .topbar"), document.querySelector("#shellCurrent .sidebar-header")].filter(Boolean)) {
    const toolbar = make("div", "", "account-toolbar");
    const title = button("Local draft", () => saveDialog()); title.classList.add("account-title");
    const save = button("Save", () => saveDialog());
    const submit = button("Submit", () => saveDialog(true), "btn primary");
    const identity = button("Sign in", () => { if (!player) signIn(); else void gallery(); });
    toolbar.append(title, button("My maps", () => void gallery()), save, submit, identity);
    host.append(toolbar); controls.push({ title, save, submit, identity });
  }
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !overlays.length) { event.preventDefault(); saveDialog(); }
  });
  async function init() {
    try {
      player = (await request("/api/editor-session")).player;
      sync();
      const query = new URLSearchParams(location.search);
      const id = query.get("map");
      if (player && id) await openMap(id);
      if (player && query.has("gallery")) await gallery();
    } catch { tell("Account maps are unavailable. Your local editor remains available."); sync(); }
  }
  void init();
})();
