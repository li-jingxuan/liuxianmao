import { useState } from "react";
import type { LibraryEntry } from "../electron/library-types.cjs";
import { displayName } from "./library-score";
import brand from "../../../website/public/assets/brand/liuxianmao-128.png";

type SortOrder = "saved" | "title" | "opened";
type EntryAction = "rename" | "remove";
const compareTitles = new Intl.Collator("zh-CN", { numeric: true }).compare;
const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
const clockFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const coverPalettes = [
  ["#253e83", "#b7d0ff", "#e3edff"], ["#206457", "#b3dcc9", "#e4f4e9"], ["#b85c30", "#ffdb97", "#fff0d1"],
  ["#6c5282", "#e0c9e8", "#f8edff"], ["#446478", "#bedee6", "#ebf7f9"], ["#936b36", "#eddab3", "#fff4db"],
] as const;
const coverWaves = [
  (x: number, line: number) => 53 + line * 2.6 + 16 * Math.sin(x / 27 - line * .054) + 6 * Math.sin(x / 14 + line * .03),
  (x: number, line: number) => 56 + line * 2.8 + 18 * Math.sin(x / 34 + line * .094) + 6 * Math.cos(x / 15 - line * .09),
  (x: number, line: number) => 55 + line * 2.6 + 14 * Math.cos(x / 20 + line * .105) + 9 * Math.sin(x / 32 - line * .09),
].map((wave) => Array.from({ length: 24 }, (_, line) => {
  const points = Array.from({ length: 54 }, (_, index) => {
    const x = index * 2 - 2;
    return `${x} ${wave(x, line).toFixed(1)}`;
  });
  return `M${points.join("L")}`;
}).join(" "));

function dateText(time: number) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day = dateFormat.format(time);
  if (day === dateFormat.format(today)) return `今天 ${clockFormat.format(time)}`;
  if (day === dateFormat.format(yesterday)) return `昨天 ${clockFormat.format(time)}`;
  return day;
}

function Cover({ entry, small = false }: { entry: LibraryEntry; small?: boolean }) {
  const palette = parseInt(entry.id.slice(0, 2), 16) % coverPalettes.length;
  const [ink, thread, lettering] = coverPalettes[palette] ?? coverPalettes[0];
  return <span aria-hidden="true" className={`library-cover${small ? " is-mini" : ""}`}>
    <svg viewBox="0 0 100 124" preserveAspectRatio="none">
      <rect width="100" height="124" fill={ink} />
      <path d={coverWaves[palette % coverWaves.length] ?? coverWaves[0]} fill="none" stroke={thread} strokeWidth=".76" opacity=".9" />
      <path d="M9 0v124" stroke="white" opacity=".24" />
      <path d="M5 0v124" stroke="black" opacity=".2" />
      {!small && <>
        <text x="18" y="24" fill={lettering} fontFamily="Georgia, serif" fontSize="12" fontWeight="bold" letterSpacing="1.2">TAB</text>
        <path d="M18 30h18" stroke={thread} />
      </>}
    </svg>
  </span>;
}

export function LibraryView({ entries, unavailable, busy, loading, loadError, notice, onNew, onImport, onOpen, onManage, onReload }: {
  entries: LibraryEntry[];
  unavailable: Set<string>;
  busy: boolean;
  loading: boolean;
  loadError: string;
  notice: string;
  onNew(): void;
  onImport(): void;
  onOpen(entry: LibraryEntry): void;
  onManage(action: EntryAction, entry: LibraryEntry): void;
  onReload(): void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("saved");
  const [menu, setMenu] = useState<string>();
  const query = search.trim().toLocaleLowerCase();
  const recent = entries.filter(({ openedAt }) => openedAt > 0).sort((a, b) => b.openedAt - a.openedAt).slice(0, 3);
  const rows = entries.filter((entry) => [displayName(entry), entry.title, entry.name, entry.arranger]
    .some((value) => value.toLocaleLowerCase().includes(query)))
    .sort((a, b) => (sort === "saved" ? b.savedAt - a.savedAt : sort === "opened" ? b.openedAt - a.openedAt
      : compareTitles(displayName(a), displayName(b))) || compareTitles(a.name, b.name));
  const controls = <div className="library-actions">
    <button className="library-button" disabled={busy} onClick={onImport}><span aria-hidden="true">↓</span>导入曲谱</button>
    <button className="library-button is-primary" disabled={busy} onClick={onNew}><span aria-hidden="true">＋</span>新建曲谱</button>
  </div>;

  return <div className="library-screen" onClick={() => setMenu(undefined)}>
    <header className="library-appbar">
      <span className="library-brand"><img src={brand} alt="" />六线猫</span>
      <span className="library-app-section">桌面工作区</span>
      <span className="library-offline">离线可用</span>
    </header>
    <main className="library-workspace" aria-busy={loading || busy}>
      <div className="library-content">
        <div className="library-heading">
          <div><h1>六线谱库</h1><p>浏览和管理这台电脑上的曲谱</p></div>
          {(entries.length > 0 || loadError) && controls}
        </div>
        {loadError && <div className="library-load-error" role="alert">{loadError}<button className="library-button" disabled={busy || loading} onClick={onReload}>重试读取</button></div>}
        {entries.length === 0 && !loadError && <section className="library-empty">
          {loading ? <p role="status">正在读取谱库…</p> : <div>
            <span className="library-empty-symbol" aria-hidden="true"><i /><i /><i /></span>
            <h2>谱库里还没有曲谱</h2><p>新建一份曲谱，或导入电脑上的 .lxm 文件。</p>
            {controls}
          </div>}
        </section>}
        {recent.length > 0 && <section aria-labelledby="library-recent-title">
          <h2 id="library-recent-title" className="library-section-title"><span className="library-clock" aria-hidden="true" />最近打开</h2>
          <div className="library-shelf">
            {recent.map((entry) => <button key={entry.id} className="library-recent" disabled={busy} onClick={() => onOpen(entry)} aria-label={`继续编辑 ${displayName(entry)}`}>
              <Cover entry={entry} /><span className="library-card-text">
                <strong>{displayName(entry)}</strong><span>{entry.arranger || "编配未填写"}</span>
                <span className="library-card-meta"><span>{entry.tonality}</span><span>{entry.meter} 拍</span><span>{entry.measures} 小节</span></span>
              </span><span className="library-recent-arrow" aria-hidden="true">→</span>
            </button>)}
          </div>
        </section>}
        {entries.length > 0 && <section className="library-catalog" aria-labelledby="library-all-title">
          <div className="library-table-head">
            <h2 id="library-all-title">全部曲谱</h2><span className="library-count">{entries.length}</span>
            <label className="library-search"><span aria-hidden="true" /><input aria-label="搜索曲名、文件名或编配" type="search" placeholder="搜索曲名、文件名或编配" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <select className="library-sort" aria-label="曲谱排序" value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
              <option value="saved">最近保存</option><option value="title">曲名顺序</option><option value="opened">最近打开</option>
            </select>
          </div>
          <div className="library-table-wrap">
            {!rows.length ? <p className="library-no-match">没有找到匹配的曲谱。 <button className="library-text-button" onClick={() => setSearch("")}>清除搜索</button></p> : <table className="library-table">
              <colgroup><col style={{ width: "34%" }} /><col style={{ width: "18%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "20%" }} /><col style={{ width: "6%" }} /></colgroup>
              <thead><tr><th scope="col">曲谱名称</th><th scope="col">编配</th><th scope="col">调式</th><th scope="col">拍号</th><th scope="col">最后保存</th><th scope="col" aria-label="操作" /></tr></thead>
              <tbody>{rows.map((entry) => <tr key={entry.id} onClick={() => { if (!busy) onOpen(entry); }}>
                <td><button className="library-row-name" aria-label={`打开 ${displayName(entry)}`} disabled={busy} onClick={(event) => { event.stopPropagation(); setMenu(undefined); onOpen(entry); }}>
                  <Cover entry={entry} small /><span><strong>{displayName(entry)}{unavailable.has(entry.id) && <em>待定位</em>}</strong><small>{entry.name}</small></span>
                </button></td>
                <td title={entry.arranger}>{entry.arranger || "—"}</td><td><span className="library-key">{entry.tonality}</span></td><td>{entry.meter}</td><td>{dateText(entry.savedAt)}</td>
                <td className="library-manage-cell" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="library-manage" disabled={busy} aria-label={`管理 ${displayName(entry)}`} aria-expanded={menu === entry.id}
                    onClick={() => setMenu(menu === entry.id ? undefined : entry.id)} onKeyDown={(event) => { if (event.key === "Escape") setMenu(undefined); }}>···</button>
                  {menu === entry.id && <div className="library-manage-menu" onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setMenu(undefined); }}
                    onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.parentElement?.querySelector("button")?.focus(); setMenu(undefined); } }}>
                    <button disabled={busy} onClick={() => { setMenu(undefined); onOpen(entry); }}>打开曲谱</button>
                    <button onClick={() => { setMenu(undefined); onManage("rename", entry); }}>重命名显示名…</button>
                    <button onClick={() => { setMenu(undefined); onManage("remove", entry); }}>从谱库移除…</button>
                  </div>}
                </td>
              </tr>)}</tbody>
            </table>}
          </div>
        </section>}
      </div>
    </main>
    <footer className="library-status"><span aria-hidden="true">▤</span>本地谱库<span aria-hidden="true">·</span><span>{entries.length} 份曲谱</span></footer>
    {notice && <p className="library-notice" role="status">{notice}</p>}
  </div>;
}
