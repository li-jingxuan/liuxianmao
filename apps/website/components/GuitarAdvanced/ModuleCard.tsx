"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { GuitarModule } from "../../lib/guitar-advanced/model";
import styles from "./LearningPathOverview.module.scss";

interface ModuleCardProps {
  module: GuitarModule;
  completed: number;
  total: number;
  status: "学习中" | "已完成" | "未开始" | "即将开放";
  targetHref: string | null;
}

/** 模块卡片只接收已经计算好的状态，避免组件直接读取 store 和课程数据。 */
export const ModuleCard = ({
  module,
  completed,
  total,
  status,
  targetHref,
}: ModuleCardProps) => {
  const ratio = total === 0 ? 0 : completed / total;
  const isComingSoon = module.availability === "comingSoon";
  return (
    <article className={styles.moduleCard} data-status={status}>
      <div className={styles.cardTopline}>
        <span
          className={styles.statusTag}
          data-tone={
            isComingSoon ? "muted" : status === "已完成" ? "green" : "blue"
          }
        >
          {isComingSoon ? <LockKeyhole aria-hidden="true" size={13} /> : null}
          {status}
        </span>
        <span className={styles.moduleOrder}>0{module.order}</span>
      </div>
      <h3>{module.title}</h3>
      <p>{module.summary}</p>
      <div className={styles.cardFooter}>
        <div className={styles.cardProgress}>
          <div className={styles.progressTrack}>
            <span style={{ width: `${ratio * 100}%` }} />
          </div>
          <span>
            {isComingSoon ? "内容准备中" : `${completed} / ${total} 项`}
          </span>
        </div>
        {targetHref ? (
          <Link
            className={
              status === "学习中"
                ? styles.primaryButton
                : styles.secondaryButton
            }
            href={targetHref}
          >
            {status === "已完成"
              ? "查看复习"
              : status === "学习中"
                ? "继续学习"
                : "查看内容"}
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        ) : (
          <span className={styles.disabledButton}>即将开放</span>
        )}
      </div>
    </article>
  );
};
