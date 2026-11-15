"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const initialNotes = ["1", "2", "3", "5", "6", "5", "1+3", "2", "3", "4", "5", "3", "2", "3", "5", "6", "5", "3", "2", "1", "1", "2", "3", "1"];
  const initialLyrics = [Array.from("风吹过山谷轻轻唱起我们心中的歌声落在远方余音悠长"), Array.from("晨光洒在窗前慢慢唤醒心底的旋律再唱一遍美好时光")];
  const state = { notes: [...initialNotes], lyrics: initialLyrics.map((row) => Array.from({ length: 24 }, (_, i) => row[i] || "")), kind: "numbered", stanza: 0, anchor: 0, focus: 3, draft: "", original: "", past: [], future: [], zoom: 125 };
  let dragging = false;
  let toastTimer;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const eligible = (i, kind = state.kind) => kind === "numbered" || !["0", "-"].includes(state.notes[i]);
  const selected = () => Array.from({ length: Math.abs(state.focus - state.anchor) + 1 }, (_, n) => Math.min(state.focus, state.anchor) + n).filter((i) => eligible(i));
  const at = (i) => state.kind === "numbered" ? state.notes[i] : state.lyrics[state.stanza][i];
  const address = (i) => `${Math.floor(i / 4) + 1}.${i % 4 + 1}`;
  const snapshot = () => ({ notes: [...state.notes], lyrics: state.lyrics.map((row) => [...row]) });
  const announce = (message) => { $("toast").textContent = message; $("toast").hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2300); };
  function seedDraft() {
    state.draft = selected().map((i) => at(i) || "_").join(" ");
    state.original = state.draft;
    $("content").value = state.draft;
  }
  function parsed() {
    const tokens = state.draft.trim() ? state.draft.trim().split(/\s+/) : [];
    const indices = selected();
    if (tokens.length > indices.length) return { tokens, indices, error: `选区共 ${indices.length} 个位置，当前输入 ${tokens.length} 项。请缩短输入或扩大选区。` };
    if (state.kind === "numbered") {
      const valid = (token) => ["_", "-"].includes(token) || token.split("+").every((note) => /^[#bn]?[0-7]['.]*$/.test(note));
      const invalid = tokens.find((token) => !valid(token));
      if (invalid) return { tokens, indices, error: `“${invalid}”不是有效简谱，请输入 1～7、0、- 或 1+3。` };
    }
    return { tokens, indices, error: "" };
  }
  function renderForm() {
    const indices = selected();
    const first = indices[0], last = indices.at(-1);
    const name = state.kind === "numbered" ? "简谱" : "歌词";
    $("context-title").textContent = `${name}范围`;
    $("range-label").textContent = Math.floor(first / 4) === Math.floor(last / 4)
      ? `第 ${Math.floor(first / 4) + 1} 小节 · 第 ${first % 4 + 1}${first === last ? "" : `～${last % 4 + 1}`} 拍`
      : `第 ${Math.floor(first / 4) + 1} 小节第 ${first % 4 + 1} 拍 → 第 ${Math.floor(last / 4) + 1} 小节第 ${last % 4 + 1} 拍`;
    $("input-label").textContent = `${name}内容`;
    $("count-label").textContent = `${indices.length} 个${state.kind === "numbered" ? "事件" : "位置"}`;
    $("selection-status").textContent = `已选择 ${indices.length} 个${name}${state.kind === "numbered" ? "事件" : "位置"}${state.kind === "lyrics" ? ` · 第${state.stanza ? "二" : "一"}段` : ""}`;
    $("numbered-tab").setAttribute("aria-pressed", String(state.kind === "numbered"));
    $("lyrics-tab").setAttribute("aria-pressed", String(state.kind === "lyrics"));
    $("stanza-row").hidden = state.kind !== "lyrics";
    const { tokens, error } = parsed();
    $("input-error").textContent = error;
    $("content").setAttribute("aria-invalid", String(Boolean(error)));
    $("apply").disabled = Boolean(error) || state.original === state.draft;
    $("restore").disabled = state.original === state.draft;
    $("draft-status").textContent = state.original !== state.draft ? "当前输入未应用" : "当前内容已应用";
    $("preview").innerHTML = indices.map((i, n) => {
      const token = tokens[n];
      const skip = token === "_" && state.kind === "numbered";
      const blank = token === undefined || token === "_" && !skip;
      return `<div class="preview-item"><div class="preview-token${blank ? " blank" : skip ? " skip" : ""}">${blank ? "" : skip ? "保留" : escape(token)}</div><small>${address(i)}</small></div>`;
    }).join("");
    $("help-panel").textContent = state.kind === "numbered"
      ? "空格分隔事件，1+3 表示同时发声。_ 保留原位置；空输入清空选区。输入不能超出所选范围，短输入剩余位置留空。"
      : "空格分词，_ 留空一个位置。空输入清空选区，短输入剩余位置留空；同一段内选择，跳过休止和延音。";
    $("undo").disabled = !state.past.length;
    $("redo").disabled = !state.future.length;
  }
  function noteMarkup(value, x, y) {
    if (!value) return `<rect class="placeholder" x="${x - 12}" y="${y - 14}" width="24" height="22" rx="3"/>`;
    if (value.includes("+")) return value.split("+").map((n, i, arr) => `<text x="${x}" y="${y - (arr.length - 1 - i) * 14}" font-size="15">${escape(n)}</text>`).join("");
    return `<text x="${x}" y="${y}" font-size="18">${escape(value)}</text>`;
  }
  function renderScore() {
    const selection = new Set(selected());
    let svg = '<rect width="840" height="830" fill="white"/><text x="420" y="72" text-anchor="middle" fill="#202838" font-size="25" font-weight="550">风吹过山谷 · 4/4 六线谱示例</text><text x="420" y="102" text-anchor="middle" fill="#626e82" font-size="12">编谱：六线猫</text><text x="66" y="153" fill="#202838" font-size="14">1=C　4/4</text>';
    for (let row = 0; row < 2; row++) {
      const top = 214 + row * 252;
      svg += `<g stroke="#202838" stroke-width="1" fill="none">${Array.from({ length: 6 }, (_, line) => `<path d="M65 ${top + line * 7}H776"/>`).join("")}${Array.from({ length: 4 }, (_, bar) => `<path d="M${65 + bar * 237} ${top}v35"/>`).join("")}</g>`;
      for (let measure = 0; measure < 3; measure++) {
        const x = 76 + measure * 237;
        svg += `<text x="${x}" y="${top - 44}" fill="#202838" font-size="13" font-family="Georgia,serif">${["C", "Em", "G", "D", "Am", "G"][row * 3 + measure]}</text><text x="${x - 15}" y="${top - 15}" fill="#8995a8" font-size="10">${row * 3 + measure + 1}</text>`;
      }
      for (let col = 0; col < 12; col++) {
        const i = row * 12 + col;
        const x = 95 + col * 59.2;
        const fret = ["0", "3", "2", "0", "2", "1", "0", "3"][i % 8];
        const tabY = top + (i % 5 + 1) * 7;
        svg += `<rect x="${x - 5}" y="${tabY - 6}" width="10" height="11" fill="white"/><text x="${x}" y="${tabY + 4}" text-anchor="middle" fill="#202838" font-size="13">${fret}</text><path d="M${x} ${top + 42}v22" stroke="#202838" stroke-width="1.2"/>`;
        if (col % 4 < 3) svg += `<path d="M${x} ${top + 64}h59.2" stroke="#202838" stroke-width="1.8"/>`;
        for (const kind of ["numbered", "lyrics"]) {
          if (!eligible(i, kind)) continue;
          const y = top + (kind === "numbered" ? 107 : 150);
          const isSelected = kind === state.kind && selection.has(i);
          const focused = kind === state.kind && i === state.focus;
          const value = kind === "numbered" ? state.notes[i] : state.lyrics[state.stanza][i];
          const label = `${kind === "numbered" ? "简谱" : "歌词"} 第${Math.floor(i / 4) + 1}小节第${i % 4 + 1}拍 ${value || "留空"}`;
          svg += `<g class="score-cell${isSelected ? " selected" : ""}${focused ? " focused" : ""}" data-kind="${kind}" data-index="${i}" tabindex="${focused ? 0 : -1}" role="button" aria-label="${escape(label)}" aria-pressed="${isSelected}"><rect class="cell-bg" x="${x - 27}" y="${y - 30}" width="54" height="43" rx="4"/><g text-anchor="middle" fill="#202838" font-family="${kind === "numbered" ? "Georgia,serif" : "PingFang SC,Microsoft YaHei,sans-serif"}">${noteMarkup(value, x, y)}</g></g>`;
        }
      }
    }
    svg += '<text x="67" y="783" fill="#98a1b2" font-size="11">吉他弹唱谱</text><text x="774" y="783" text-anchor="end" fill="#98a1b2" font-size="11">1</text>';
    $("score").innerHTML = svg;
  }
  function refresh(reseed = false) { if (reseed) seedDraft(); renderForm(); renderScore(); }
  function choose(kind, index, extend = false) {
    if (!eligible(index, kind)) return;
    if (kind !== state.kind || !extend) state.anchor = index;
    state.kind = kind; state.focus = index;
    refresh(true);
  }
  function focusCell() {
    const cell = $("score").querySelector(`[data-kind="${state.kind}"][data-index="${state.focus}"]`);
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function apply(clear = false) {
    const { tokens, indices, error } = parsed();
    if (error && !clear) return;
    const before = snapshot();
    indices.forEach((i, n) => {
      const token = clear ? undefined : tokens[n];
      if (state.kind === "numbered" && token === "_") return;
      const value = !token || token === "_" ? "" : token;
      if (state.kind === "numbered") state.notes[i] = value;
      else state.lyrics[state.stanza][i] = value;
    });
    const after = snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after)) { state.past.push(before); state.future = []; }
    refresh(true);
    announce(clear || !tokens.length ? `已清空 ${indices.length} 个位置` : `已应用到 ${indices.length} 个位置`);
  }
  function undo(redo = false) {
    const source = redo ? state.future : state.past;
    if (!source.length) return;
    const next = source.pop();
    (redo ? state.past : state.future).push(snapshot());
    state.notes = next.notes; state.lyrics = next.lyrics;
    refresh(true); announce(redo ? "已重做" : "已撤销");
  }
  $("score").addEventListener("pointerdown", (event) => {
    const cell = event.target.closest("[data-kind]");
    if (!cell || event.button !== 0) return;
    event.preventDefault(); dragging = true;
    choose(cell.dataset.kind, Number(cell.dataset.index), event.shiftKey);
  });
  document.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-kind]");
    if (!cell || cell.dataset.kind !== state.kind || Number(cell.dataset.index) === state.focus) return;
    choose(state.kind, Number(cell.dataset.index), true);
  });
  document.addEventListener("pointerup", () => { if (dragging) { dragging = false; focusCell(); } });
  $("score").addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Escape") state.anchor = state.focus;
      else {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        let next = state.focus;
        if (!event.shiftKey && state.anchor !== state.focus) next = direction < 0 ? Math.min(state.anchor, state.focus) : Math.max(state.anchor, state.focus);
        else { do { next += direction; } while (next >= 0 && next < 24 && !eligible(next)); }
        if (next >= 0 && next < 24) { state.focus = next; if (!event.shiftKey) state.anchor = next; }
      }
      refresh(true); focusCell();
    } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); apply(true); }
  });
  $("content").addEventListener("input", () => { state.draft = $("content").value; renderForm(); });
  $("content").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing && !$("apply").disabled) { event.preventDefault(); apply(); } });
  $("apply").onclick = () => apply();
  $("clear-selection").onclick = () => apply(true);
  $("clear-draft").onclick = () => { state.draft = ""; $("content").value = ""; renderForm(); $("content").focus(); };
  $("restore").onclick = () => { seedDraft(); renderForm(); };
  $("undo").onclick = () => undo(); $("redo").onclick = () => undo(true);
  $("numbered-tab").onclick = () => { state.kind = "numbered"; refresh(true); };
  $("lyrics-tab").onclick = () => {
    const candidates = state.notes.map((_, i) => i).filter((i) => eligible(i, "lyrics"));
    if (!candidates.length) { announce("当前没有可填词位置"); return; }
    state.kind = "lyrics";
    if (!eligible(state.focus)) state.focus = candidates.find((i) => i >= state.focus) ?? candidates.at(-1);
    if (!eligible(state.anchor)) state.anchor = state.focus;
    refresh(true);
  };
  $("stanza").onchange = () => { state.stanza = Number($("stanza").value); refresh(true); };
  $("select-all").onclick = () => { state.anchor = Math.floor(state.focus / 12) * 12; state.focus = state.anchor + 11; refresh(true); };
  $("cross-line").onclick = () => { state.anchor = 9; state.focus = 14; refresh(true); focusCell(); };
  $("chord-group").onclick = () => { state.kind = "numbered"; state.anchor = 6; state.focus = 6; refresh(true); focusCell(); };
  $("help-toggle").onclick = () => { $("help-panel").hidden = !$("help-panel").hidden; $("help-toggle").setAttribute("aria-expanded", String(!$("help-panel").hidden)); };
  function zoom(direction) {
    const values = [100, 125, 150, 200];
    state.zoom = values[Math.max(0, Math.min(3, values.indexOf(state.zoom) + direction))];
    $("zoom-value").textContent = `${state.zoom}%`;
    const width = 840 * state.zoom / 125;
    document.querySelector(".paper").style.minWidth = `${width}px`;
    document.querySelector(".paper").style.maxWidth = `${width}px`;
  }
  $("zoom-out").onclick = () => zoom(-1); $("zoom-in").onclick = () => zoom(1);
  document.addEventListener("keydown", (event) => {
    if (event.isComposing || event.target.matches("input,textarea,select")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(event.shiftKey); }
  });
  window.__rangeReview = () => ({ ...snapshot(), kind: state.kind, stanza: state.stanza, indices: selected(), draft: state.draft, history: state.past.length });
  refresh(true);
})();
