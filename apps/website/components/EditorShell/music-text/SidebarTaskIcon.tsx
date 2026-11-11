/** 编辑台任务图标，与设计稿保持相同的对象语义。 */
export function SidebarTaskIcon({ task }: { task: "selection" | "paragraph" | "chord" | "song" }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {task === "selection" ? <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>
      : task === "paragraph" ? <><path d="M9 18V5l11-2v13M9 8l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></>
      : task === "chord" ? <><path d="M5 4v16M10 4v16M15 4v16M20 4v16M4 5h17M4 10h17M4 15h17M4 20h17" /><circle cx="10" cy="10" r="2" fill="currentColor" /></>
      : <><path d="M4 7h16M4 17h16M8 4v6m8 4v6" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>}
  </svg>;
}
