(function () {
  "use strict";
  const api = globalThis.CosmowarEditorUI;
  if (!api) return;
  const configured = document.querySelector('meta[name="feedback-url"]')?.content;
  let feedback;
  try { feedback = new URL(configured); if (!/^https?:$/.test(feedback.protocol)) return; } catch { return; }
  let player = null;
  let current = null;
  let reviewDraft = null;
  let maps = [];
  let baseline = "";
  let dirty = false;
  let busy = false;
  let polling;
  const overlays = [];
  const controls = [];
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const button = (text, click, className = "btn") => { const node = make("button", text, className); node.type = "button"; node.addEventListener("click", click); return node; };
  const activeShell = () => document.querySelector(document.documentElement.dataset.uiShell === "current" ? "#shellCurrent" : "#shellNew");
  function icon(name, small = false) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("class", `ico${small ? " sm" : ""}`); node.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(node.namespaceURI, "use"); use.setAttribute("href", `#i-${name}`); node.append(use); return node;
  }
  function iconButton(label, name, click) {
    const node = button("", click, "icon-btn"); node.title = label; node.setAttribute("aria-label", label); node.append(icon(name)); return node;
  }
  function tell(message) {
    const toast = make("div", "", "toast multiplayer-toast"); toast.setAttribute("role", "status");
    toast.append(icon("info"), make("span", message));
    (activeShell().querySelector(".toasts, .multiplayer-toast-stack") || activeShell()).append(toast);
    setTimeout(() => toast.remove(), 6500);
  }
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
      item.title.textContent = current ? `${current.name}${dirty ? " •" : ""}` : reviewDraft ? `${reviewDraft.name} · Review copy` : "Local draft";
      item.title.title = current ? `Revision ${current.revision}${dirty ? " · Unsaved changes" : " · Saved"}` : reviewDraft ? `FB-${reviewDraft.reportId} · Revision ${reviewDraft.revision} · Changes stay in your own copy` : "Save this draft to your account";
      item.identity.textContent = player ? player.displayName : "Sign in";
      item.save.disabled = busy; item.submit.disabled = busy;
      item.title.classList.toggle("is-dirty", dirty);
    }
  }
  function close(overlay) { overlay.remove(); const i = overlays.indexOf(overlay); if (i >= 0) overlays.splice(i, 1);
    if (!overlays.length) document.querySelectorAll("[data-ui-shell]").forEach(button => { button.disabled = false; });
    overlay.returnFocus?.focus(); }
  function dialog(title, wide = false) {
    globalThis.CosmowarUIShell?.closeOverlays?.();
    const overlay = make("div", "", "modal-scrim account-scrim");
    overlay.returnFocus = document.activeElement?.closest(".menu-popover") ? document.querySelector('[data-menu="menuFile"]') : document.activeElement;
    const panel = make("section", "", `settings-modal account-dialog${wide ? " account-wide" : ""}`);
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", title); panel.tabIndex = -1;
    const header = make("header");
    header.append(icon(wide ? "grid-four" : "floppy-disk"), make("h2", title), iconButton("Close", "x", () => { if (!busy) close(overlay); }));
    panel.append(header); overlay.append(panel); overlays.push(overlay); activeShell().append(overlay);
    document.querySelectorAll("[data-ui-shell]").forEach(button => { button.disabled = true; });
    overlay.addEventListener("click", event => { if (event.target === overlay && !busy) close(overlay); });
    panel.focus(); return { panel, overlay, header };
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
  function field(label, value, maxLength = 80) { const wrap = make("label"); wrap.append(make("span", label)); const input = make("input"); input.type = "text"; input.value = value || ""; input.maxLength = maxLength; wrap.append(input); return { wrap, input }; }
  function updateUrl(id) { const url = new URL(location.href); url.searchParams.delete("gallery"); url.searchParams.delete("review"); if (new URLSearchParams(url.hash.slice(1)).has("review-token")) url.hash = ""; if (id) url.searchParams.set("map", id); else url.searchParams.delete("map"); window.history.replaceState(null, "", url); }
  function changed() {
    clearTimeout(polling);
    polling = setTimeout(() => { try { dirty = JSON.stringify(api.getDocument()) !== baseline; sync(); } catch { dirty = true; sync(); } }, 200);
  }
  window.addEventListener("cosmowar-document-change", changed);
  window.addEventListener("cosmowar-new-document", () => { current = null; reviewDraft = null; baseline = ""; dirty = true; updateUrl(null); sync(); });
  window.addEventListener("beforeunload", event => { if (dirty && player) { event.preventDefault(); event.returnValue = ""; } });

  async function openMap(id, overlay) {
    if (busy || dirty && !confirm("Open this map and replace your local unsaved changes?")) return;
    busy = true; sync();
    try {
      const result = await request(`/api/maps/${encodeURIComponent(id)}`);
      api.openDocument(result.map.content);
      current = result.map; reviewDraft = null; baseline = JSON.stringify(api.getDocument()); dirty = false; updateUrl(id); sync();
      if (overlay) close(overlay);
    } catch (error) { tell(error.message); }
    finally { busy = false; sync(); }
  }
  async function gallery() {
    if (!player) return signIn();
    const { panel, overlay, header } = dialog("My maps", true);
    const create = button("New map", () => { if (!busy && api.newMap()) close(overlay); }, "btn primary");
    create.prepend(icon("plus", true)); header.insertBefore(create, header.lastChild);
    const layout = make("div", "", "settings-layout account-browser");
    const folders = make("nav", "", "account-folders"); folders.setAttribute("aria-label", "Map folders");
    const content = make("div", "", "account-browser-content");
    const search = field("Search maps", "", 120); search.wrap.className = "account-search";
    search.wrap.firstChild.className = "sr"; search.input.type = "search"; search.input.placeholder = "Find a map"; search.wrap.prepend(icon("magnifying-glass", true));
    const status = make("select"); status.setAttribute("aria-label", "Submission status");
    for (const label of ["All statuses", "Draft", "Submitted", "Accepted"]) { const option = make("option", label); option.value = label; status.append(option); }
    const toolbar = make("div", "", "account-filters"); toolbar.append(search.wrap, status);
    const list = make("div", "", "account-map-list"); list.setAttribute("aria-label", "Saved maps");
    const message = make("p", "Loading maps…", "account-browser-count"); message.setAttribute("role", "status");
    content.append(toolbar, list, message); layout.append(folders, content); panel.append(layout);
    let folder = "*";
    function render() {
      list.replaceChildren();
      const query = search.input.value.toLowerCase();
      const shown = maps.filter(map => (!query || `${map.name} ${map.folder} Defuse`.toLowerCase().includes(query)) && (folder === "*" || map.folder === folder) && (status.value === "All statuses" || labels(map).includes(status.value)));
      message.textContent = `${shown.length} of ${maps.length} maps`;
      if (!shown.length) list.append(make("p", maps.length ? "No matching maps." : "No saved maps yet. Use File → Save map to add one.", "account-empty"));
      for (const map of shown) {
        const row = make("article", "", "account-map-row");
        if (map.id === current?.id) row.classList.add("is-current");
        const open = button("", () => void openMap(map.id, overlay), "account-map-open");
        const description = make("span", "", "account-map-description");
        description.append(make("strong", map.name), make("span", `${map.folder || "Unfiled"} · Defuse · v${map.revision}`, "account-map-meta"));
        open.append(icon("bounding-box"), description); row.append(open);
        const tags = make("div", "", "account-tags");
        labels(map).filter(label => label !== "Defuse").forEach(label => tags.append(make("span", label, `account-state state-${label.toLowerCase()}`)));
        row.append(tags);
        const modified = make("time", new Date(map.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), "account-map-date"); modified.dateTime = map.updatedAt; row.append(modified);
        if (map.reportId) {
          const link = make("a", "", "icon-btn"); link.href = new URL(`/r/${map.reportId}`, feedback).href;
          link.title = "Open feedback"; link.setAttribute("aria-label", `Feedback for ${map.name}`); link.append(icon("link-simple", true)); row.append(link);
        } else row.append(make("span", "", "account-link-space"));
        list.append(row);
      }
    }
    search.input.addEventListener("input", render); status.addEventListener("change", render);
    try {
      maps = (await request("/api/maps")).maps;
      const paths = ["*", ...new Set(["", ...maps.map(map => map.folder)])];
      for (const path of paths) {
        const item = button("", () => {
          folder = path;
          for (const sibling of folders.children) { sibling.classList.toggle("active", sibling === item); sibling.setAttribute("aria-pressed", String(sibling === item)); }
          render();
        }, "settings-tab");
        item.append(icon(path === "*" ? "grid-four" : "stack-simple", true), make("span", path === "*" ? "All maps" : path || "Unfiled"));
        item.classList.toggle("active", path === "*"); item.setAttribute("aria-pressed", String(path === "*")); folders.append(item);
      }
      render(); search.input.focus();
    } catch (error) { message.textContent = error.message; }
  }
  function saveDialog(submit = false) {
    if (!player) return signIn();
    if (!player.nameConfirmed) { const welcome = new URL("/welcome", feedback); welcome.searchParams.set("next", location.href); location.assign(welcome.href); return; }
    const { panel, overlay } = dialog(submit ? "Submit for review" : "Save map");
    const form = make("form", "", "account-save-form");
    const name = field("Map name", current?.name || (reviewDraft ? `${reviewDraft.name.slice(0, 73)} (copy)` : "")); name.input.required = true;
    const folder = field("Folder", current?.folder || ""); folder.input.placeholder = "e.g. In progress / Arenas";
    const mode = make("div", "", "account-mode"); mode.append(make("span", "Game mode"), make("span", "Defuse", "readonly"));
    const note = make("p", submit ? "Saves this revision and opens its feedback discussion." : "", "account-hint");
    const errorLine = make("p", "", "account-error"); errorLine.setAttribute("role", "status");
    const save = make("button", submit ? "Submit for review" : "Save map", "btn primary"); save.type = "submit";
    const fields = make("div", "", "account-form-fields"); fields.append(name.wrap, folder.wrap, mode, note, errorLine);
    const footer = make("footer", "", "account-dialog-actions"); footer.append(button("Cancel", () => { if (!busy) close(overlay); }), save);
    form.append(fields, footer); panel.append(form); name.input.focus();
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (busy) return;
      busy = true; sync(); save.disabled = true; errorLine.textContent = "";
      try {
        const content = api.getDocument();
        if (submit) { const problem = api.validateDocument(); if (problem) throw new Error(problem); }
        const sent = JSON.stringify(content);
        const result = await request(current ? `/api/maps/${encodeURIComponent(current.id)}` : "/api/maps", current ? "PUT" : "POST", { name: name.input.value.trim(), folder: folder.input.value.trim(), mode: "defuse", content, ...(current ? { revision: current.revision } : {}) });
        current = result.map; reviewDraft = null; baseline = sent; dirty = JSON.stringify(api.getDocument()) !== sent; updateUrl(current.id); sync();
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
  const shell = document.getElementById("shellNew");
  const topbar = shell.querySelector(".topbar");
  const title = button("Local draft", () => saveDialog(), "menu-btn account-title");
  topbar.insertBefore(title, topbar.querySelector(".top-spacer"));
  const save = iconButton("Save map (Ctrl+S)", "floppy-disk", () => saveDialog());
  topbar.insertBefore(save, title);
  const identity = button("Sign in", () => { if (!player) signIn(); else void gallery(); }, "menu-btn account-identity");
  topbar.append(identity);
  const file = document.getElementById("menuFile");
  function fileItem(label, symbol, action, shortcut) {
    const item = button("", action, ""); item.setAttribute("role", "menuitem");
    item.append(icon(symbol, true), make("span", label)); if (shortcut) item.append(make("kbd", shortcut)); return item;
  }
  const saveItem = fileItem("Save map", "floppy-disk", () => saveDialog(), "Ctrl S");
  const submit = fileItem("Submit for review", "check-circle", () => saveDialog(true));
  file.insertBefore(document.createElement("hr"), file.children[1]);
  file.insertBefore(submit, file.children[1]);
  file.insertBefore(saveItem, file.children[1]);
  file.insertBefore(fileItem("My maps", "grid-four", () => void gallery()), file.firstChild);
  controls.push({ title, save, submit, identity });
  const legacyHost = document.querySelector("#shellCurrent .sidebar-header");
  if (legacyHost) {
    const toolbar = make("div", "", "account-legacy-controls");
    toolbar.append(button("My maps", () => void gallery(), "action-button secondary"), button("Save map", () => saveDialog(), "action-button secondary"), button("Submit for review", () => saveDialog(true), "action-button"));
    legacyHost.after(toolbar);
  }
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !overlays.length) { event.preventDefault(); saveDialog(); }
  });
  async function init() {
    const query = new URLSearchParams(location.search);
    const reviewToken = new URLSearchParams(location.hash.slice(1)).get("review-token");
    try {
      player = (await request("/api/editor-session")).player;
      sync();
    } catch { tell("Account maps are unavailable. Your local editor remains available."); sync(); }
    if (reviewToken) {
      busy = true; sync();
      try {
        const result = await request("/api/maps/review", "POST", { token: reviewToken });
        api.openDocument(result.content);
        current = null; reviewDraft = result; baseline = JSON.stringify(api.getDocument()); dirty = false;
        tell(`Opened ${result.name} · Revision ${result.revision}. Changes stay in your own copy.`);
      } catch (error) { tell(error.message); }
      finally { busy = false; sync(); }
    } else {
      const id = query.get("map");
      if (player && id) await openMap(id);
      if (player && query.has("gallery")) await gallery();
    }
  }
  void init();
})();
