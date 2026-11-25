function renderStrumArrows(lengths, directions) {
  const cells = lengths.flatMap((length, index) => [directions[index], ...Array(length - 1).fill('延')]);
  const marks = cells.map((direction, index) => {
    const x = 17 + index * 34;
    if (direction === '延') return `<path data-stroke="延" d="M${x-4} 16h8" stroke="#77879a" stroke-width="1.6"/>`;
    const up = direction === '上';
    // The arrow follows the strings on TAB (1 at the top, 6 at the bottom).
    const tip = up ? 25 : 7;
    const wing = up ? -5 : 5;
    return `<path data-stroke="${direction}" d="M${x} ${up ? 7 : 25}V${tip}m-5 ${wing} 5 ${-wing} 5 ${wing}" stroke="${up ? '#08746e' : '#223a50'}" stroke-width="2.6"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="136" height="32" viewBox="0 0 136 32" aria-hidden="true" focusable="false"><path d="M34 5v22M68 5v22M102 5v22" fill="none" stroke="#d9e2eb"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">${marks}</g></svg>`;
}

function renderBeatNotation(lengths, width = 112) {
  const height = 39;
  const stemOffset = 6;
  const headY = 31;
  const beamY = 6;
  const heads = lengths.map((length, index) => ({
    x: width / 2 + (index - (lengths.length - 1) / 2) * Math.min(26, (width - 24) / Math.max(1, lengths.length - 1)),
    beams: length <= 0.5 ? 3 : length === 1 ? 2 : length < 4 ? 1 : 0,
    dotted: length === 3,
  }));
  const stems = heads.map((note) => `M${note.x + stemOffset} ${headY}V${beamY}`).join("");
  const beams = [];

  for (let level = 1; level <= Math.max(0, ...heads.map((note) => note.beams)); level += 1) {
    const y = beamY + (level - 1) * 5;
    for (const [index, note] of heads.entries()) {
      if (note.beams < level) continue;
      const next = heads[index + 1];
      const previous = heads[index - 1];
      const x = note.x + stemOffset;
      if (next?.beams >= level) {
        beams.push(`<path d="M${x - 0.7} ${y}H${next.x + stemOffset + 0.7}"/>`);
      } else if (!(previous?.beams >= level)) {
        // Isolated upper beams point into the group of shorter notes sharing the main beam.
        const toward = next?.beams >= level - 1 ? next : previous;
        if (toward && level > 1) {
          const hook = Math.min(9, Math.abs(toward.x - note.x) / 2 - 2);
          const side = Math.sign(toward.x - note.x);
          beams.push(`<path d="M${x - side * 0.7} ${y}h${side * hook}"/>`);
        } else {
          beams.push(`<path d="M${x} ${y}c1 6 10 7 8 16" fill="none" stroke-width="2"/>`);
        }
      }
    }
  }

  const notes = heads.map(({ x, dotted }) =>
    `<ellipse cx="${x}" cy="${headY}" rx="7" ry="4.4" transform="rotate(-17 ${x} ${headY})"/>` +
    (dotted ? `<circle cx="${x + 11}" cy="${headY}" r="1.65"/>` : ""),
  ).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
    <path d="${stems}" fill="none" stroke="#14171b" stroke-width="1.65"/>
    <g stroke="#14171b" stroke-width="3.6">${beams.join("")}</g>
    <g fill="#14171b">${notes}</g>
  </svg>`;
}

function renderPanel(host, mode, model) {
  const doc = host.ownerDocument;
  const bubble = mode === "bubble";
  const strum = model.tab === "strum";

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, action, className, value) {
    const node = element("button", className, label);
    node.type = "button";
    node.dataset.action = action;
    if (value !== undefined) node.dataset.value = value;
    return node;
  }

  function templateCard(template, action, selected) {
    const { id, name, form, lengths, directions, beatForms } = template;
    const card = button(undefined, action, "sp-template", id);
    const pressed = id === selected;
    card.setAttribute("aria-pressed", String(pressed));

    const text = element("span", "sp-template-text");
    text.append(element("span", "sp-template-name", form || name));
    if (directions) card.setAttribute('aria-label', `${name}，${form}`);
    card.append(text);
    if (pressed) {
      const check = element("span", "sp-check", "✓");
      check.setAttribute("aria-hidden", "true");
      card.append(check);
    }

    const notation = element("span", "sp-notation");
    if (beatForms) {
      notation.classList.add("sp-measure-notation");
      notation.innerHTML = beatForms.map(beatForm => renderBeatNotation(model.forms[beatForm], 92)).join("");
    } else {
      notation.innerHTML = directions ? renderStrumArrows(lengths, directions) : renderBeatNotation(lengths);
    }
    card.append(notation);
    return card;
  }

  function templateGroup({ title, detail, templates, action, selected, expanded, limit, expandAction, expandLabel, collapseLabel }) {
    const section = element("section", `sp-section sp-section--${action}`);
    const heading = element("div", "sp-section-heading");
    heading.append(
      element(bubble ? "h3" : "h4", "sp-section-title", title),
      element("span", "sp-section-detail", detail),
    );
    const list = element("div", "sp-template-grid");
    const visible = expanded ? templates : templates.slice(0, limit);
    list.append(...visible.map((template) => templateCard(template, action, selected)));
    section.append(heading);
    section.append(list);

    if (templates.length > limit) {
      const toggle = button(expanded ? collapseLabel : expandLabel, expandAction, "sp-expand");
      toggle.setAttribute("aria-expanded", String(Boolean(expanded)));
      section.append(toggle);
    }
    return section;
  }

  const root = element("section", "strum-panel");
  root.dataset.mode = mode;
  root.setAttribute("aria-label", "节奏型");
  root.tabIndex = -1;

  const header = element("header", "sp-header");
  header.append(element(bubble ? "h2" : "h3", "sp-title", bubble ? "节奏型" : "常见节奏型"));
  if (bubble) {
    const actions = element("div", "sp-header-actions");
    const handoff = button("在侧栏展开", "sidebar", "sp-handoff");
    const close = button("×", "close", "sp-close");
    close.setAttribute("aria-label", "关闭节奏型");
    actions.append(handoff, close);
    header.append(actions);
  }

  const tabs = element("div", "sp-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "节奏模板类别");
  root.append(header, tabs);
  let activePane;
  for (const [id, label] of [["rhythm", "普通节奏型"], ["strum", "扫弦节奏型"]]) {
    const tab = button(label, "tab", "sp-tab", id);
    const pane = element("div", "sp-scroll");
    const active = model.tab === id;
    tab.id = `${mode}-${id}-tab`;
    pane.id = `${mode}-${id}-pane`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("aria-controls", pane.id);
    tab.tabIndex = active ? 0 : -1;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", tab.id);
    pane.tabIndex = 0;
    pane.hidden = !active;
    tabs.append(tab);
    root.append(pane);
    if (active) activePane = pane;
  }
  if (strum) {
    activePane.append(element('p', 'sp-legend', '↓ 上扫 1→6弦　↑ 下扫 6→1弦　– 延音　每格 ¼ 拍'), templateGroup({
      title: "拍内扫弦模板", detail: "每组一拍", templates: model.patterns, action: "pattern", selected: model.selected,
      expanded: model.expanded.pattern, limit: 6, expandAction: "expand",
      expandLabel: "展开全部", collapseLabel: "收起扫弦模板",
    }));
  } else {
    activePane.append(templateGroup({
      title: "拍内模板", detail: "4/4", templates: model.regularPatterns, action: "regular", selected: model.selected,
      expanded: model.expanded.regular, limit: 4, expandAction: "regular-expand",
      expandLabel: "展开拍内模板", collapseLabel: "收起拍内模板",
    }), templateGroup({
      title: "整小节模板", detail: `${model.measurePatterns.length} 条`, templates: model.measurePatterns, action: "measure",
      selected: model.selected, expanded: model.expanded.measure, limit: 6, expandAction: "measure-expand",
      expandLabel: "展开整小节模板", collapseLabel: "收起整小节模板",
    }));
  }

  const footer = element("footer", "sp-footer");
  const description = element("div", "sp-destination");
  description.setAttribute("aria-live", "polite");
  description.append(element("div", "sp-range", model.range));
  if (model.detail) description.append(element("div", "sp-summary", model.detail));
  const actions = element("div", "sp-footer-actions");
  if (model.canUndo) actions.append(button("撤销应用", "undo", "sp-undo"));
  if (bubble) actions.append(button(model.activeStrum && !model.draft ? "关闭" : "取消", strum && model.draft ? "cancel" : "close", "sp-cancel"));
  const apply = button(strum ? "应用" : "应用节奏型", "apply", "sp-apply");
  apply.disabled = !model.canApply;
  actions.append(apply);
  footer.append(description, actions);
  root.append(footer);

  const previous = host.firstElementChild;
  const scrollTop = previous?.querySelector(`[id="${activePane.id}"]:not([hidden])`)?.scrollTop ?? 0;
  host.replaceChildren(root);
  activePane.scrollTop = scrollTop;
}
