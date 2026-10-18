"use client";
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  RotateCcw,
} from "lucide-react";
import { Alert, Button, Modal } from "antd";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  GuitarAdvancedStoreProvider,
  useGuitarAdvancedStore,
} from "../../stores/guitar-advanced-store";
import type { GuitarAdvancedData, GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import { getLearningSequence } from "../../lib/guitar-advanced/catalog";
import {
  getContinueTarget,
  isTargetComplete,
} from "../../lib/guitar-advanced/progress";
import styles from "./GuitarAdvancedShell.module.scss";
const GuitarAdvancedShellContent = ({
  children,
  data,
}: {
  children: ReactNode;
  data: GuitarAdvancedData;
}) => {
  const pathname = usePathname();
  const [confirmation, setConfirmation] = useState<"clear" | "reload" | null>(
    null,
  );
  const hydrated = useGuitarAdvancedStore((s) => s.hydrated),
    issue = useGuitarAdvancedStore((s) => s.storageIssue),
    notification = useGuitarAdvancedStore((s) => s.notification),
    progress = useGuitarAdvancedStore((s) => s.progress);
  const hydrate = useGuitarAdvancedStore((s) => s.hydrate),
    clear = useGuitarAdvancedStore((s) => s.clearProgress),
    retry = useGuitarAdvancedStore((s) => s.retryPersist),
    dismiss = useGuitarAdvancedStore((s) => s.dismissNotification);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  const sequence = getLearningSequence(data);
  const continued = getContinueTarget(data, progress);
  const target = (kind: "lesson" | "exercise") =>
    (continued?.kind === kind
      ? continued.href
      : sequence.find((t) => t.kind === kind && !isTargetComplete(progress, t))
          ?.href) ?? "/guitar-advanced#learning-modules";
  const navigation = [
    {
      label: "学习路径",
      href: "/guitar-advanced",
      icon: LayoutDashboard,
      prefix: "/guitar-advanced/modules",
    },
    {
      label: "理论课程",
      href: target("lesson"),
      icon: BookOpen,
      prefix: "/guitar-advanced/theory",
    },
    {
      label: "练习中心",
      href: target("exercise"),
      icon: ClipboardList,
      prefix: "/guitar-advanced/practice",
    },
    {
      label: "综合考试",
      href: "/guitar-advanced/exam",
      icon: FileText,
      prefix: "/guitar-advanced/exam",
    },
    {
      label: "学习进度",
      href: "/guitar-advanced/progress",
      icon: History,
      prefix: "/guitar-advanced/progress",
    },
  ];
  // 使用应用内确认框，保持键盘可用并避免原生弹窗阻塞页面与自动化。
  const reset = () => setConfirmation("clear");
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>六</span>
          <span>六线猫</span>
        </Link>
        <nav className={styles.productNav} aria-label="产品导航">
          <Link href="/">曲谱工作台</Link>
          <span className={styles.productNavActive}>吉他进阶</span>
        </nav>
        <span className={styles.localBadge}>当前浏览器</span>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar} aria-label="吉他进阶导航">
          <div className={styles.sidebarTitle}>吉他进阶</div>
          <nav className={styles.navigation}>
            {navigation.map(({ label, href, icon: Icon, prefix }) => {
              const active =
                pathname === "/guitar-advanced"
                  ? label === "学习路径"
                  : pathname.startsWith(prefix);
              return (
                <Link
                  key={label}
                  title={label}
                  aria-current={active ? "page" : undefined}
                  className={`${styles.navigationItem} ${active ? styles.navigationItemActive : ""}`}
                  href={href}
                >
                  <Icon aria-hidden="true" size={17} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className={styles.sidebarFooter}>
            <CheckCircle2 aria-hidden="true" size={16} />
            <div>
              <strong>{issue ? "记录提示" : "本地保存"}</strong>
              <span>{hydrated ? "仅当前浏览器" : "正在读取记录…"}</span>
            </div>
            <Button
              size="small"
              onClick={reset}
              aria-label="清除本地进度"
              title="清除本地进度"
              icon={<RotateCcw aria-hidden="true" size={14} />}
            >
              <span className={styles.resetLabel}>清除本地进度</span>
            </Button>
          </div>
        </aside>
        <main className={styles.main}>
          {issue && (
            <Alert
              role="alert"
              type="warning"
              title="学习记录提示"
              description={issue.message}
              action={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {issue.kind === "writeFailed" && (
                    <Button size="small" onClick={() => retry()}>
                      重试保存
                    </Button>
                  )}
                  {issue.kind === "readProtected" && (
                    <Button
                      size="small"
                      onClick={() => {
                        setConfirmation("reload");
                      }}
                    >
                      刷新重读
                    </Button>
                  )}
                  <Button size="small" onClick={reset}>
                    清除记录
                  </Button>
                </div>
              }
            />
          )}{" "}
          {notification && (
            <Alert
              type="info"
              title={notification}
              closable
              onClose={dismiss}
            />
          )}
          {hydrated ? children : <p role="status">正在读取学习记录…</p>}
        </main>
      </div>
      <Modal
        open={confirmation !== null}
        title={confirmation === "clear" ? "清除本地进度" : "重新读取学习记录"}
        okText={confirmation === "clear" ? "清除并重新开始" : "刷新重读"}
        cancelText="取消"
        onCancel={() => setConfirmation(null)}
        onOk={() => {
          if (confirmation === "clear") {
            clear();
            setConfirmation(null);
          } else if (confirmation === "reload") window.location.reload();
        }}
      >
        <p>
          {confirmation === "clear"
            ? "将清除当前浏览器中新旧版本的全部吉他进阶学习记录。此操作不会影响曲谱文档。"
            : "刷新将丢失本次未保存的临时操作。确认重新读取学习记录？"}
        </p>
      </Modal>
    </div>
  );
};
export const GuitarAdvancedShell = ({
  children,
  data,
  exam,
}: {
  children: ReactNode;
  data: GuitarAdvancedData;
  exam: GuitarAdvancedExam;
}) => (
  <GuitarAdvancedStoreProvider catalog={data} exam={exam}>
    <GuitarAdvancedShellContent data={data}>
      {children}
    </GuitarAdvancedShellContent>
  </GuitarAdvancedStoreProvider>
);
