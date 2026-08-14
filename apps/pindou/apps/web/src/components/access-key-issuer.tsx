"use client";

import { Check, Clipboard, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { createAccessKey } from "@/lib/api";
import type { AccessKeyCreateResponse } from "@/lib/types";

import styles from "./access-key-issuer.module.scss";

const MIN_ALLOWED_USES = 1;
const MAX_ALLOWED_USES = 1_000_000;

const parseAllowedUses = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_ALLOWED_USES && parsed <= MAX_ALLOWED_USES
    ? parsed
    : null;
};

/** Clipboard API 在非安全上下文不可用时，回退到浏览器的选区复制能力。 */
export const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 权限拒绝时继续尝试兼容旧浏览器和局域网 HTTP 环境的降级方案。
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("复制失败");
};

type AccessKeyIssuerProps = {
  prefix: string;
};

type CopyState = "idle" | "copied" | "failed";

/** 管理员消费密钥签发页的全部客户端交互。 */
export function AccessKeyIssuer({ prefix }: AccessKeyIssuerProps) {
  const [adminApiKey, setAdminApiKey] = useState("");
  const [allowedUses, setAllowedUses] = useState("1");
  const [result, setResult] = useState<AccessKeyCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedAdminApiKey = adminApiKey.trim();
    const normalizedAllowedUses = parseAllowedUses(allowedUses);
    if (!normalizedAdminApiKey) {
      setError("请输入 X-Admin-API-Key");
      return;
    }
    if (normalizedAllowedUses === null) {
      setError("可用次数必须是 1 到 1,000,000 之间的整数");
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setResult(null);
    setCopyState("idle");
    setIsSubmitting(true);

    try {
      const response = await createAccessKey(
        { prefix, allowedUses: normalizedAllowedUses },
        { adminApiKey: normalizedAdminApiKey, signal: controller.signal },
      );
      setResult(response);
    } catch (cause: unknown) {
      if ((cause as Error).name !== "AbortError") {
        setError(cause instanceof Error ? cause.message : "签发失败，请稍后重试");
      }
    } finally {
      if (!controller.signal.aborted) setIsSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!result) return;

    try {
      await copyText(result.key);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="access-key-title">
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <KeyRound />
          </span>
          <div>
            <p className={styles.eyebrow}>Access Key Issuer</p>
            <h1 id="access-key-title">签发访问密钥</h1>
            <p className={styles.description}>填写管理密钥和使用次数，为当前来源生成消费密钥。</p>
          </div>
        </header>

        <div className={styles.routeInfo}>
          <span>当前路由前缀</span>
          <code>{prefix}</code>
        </div>

        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.field}>
            <label htmlFor="admin-api-key">X-Admin-API-Key</label>
            <input
              id="admin-api-key"
              type="password"
              value={adminApiKey}
              onChange={(event) => setAdminApiKey(event.target.value)}
              placeholder="请输入管理 API Key"
              autoComplete="off"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="allowed-uses">allowed_uses</label>
            <input
              id="allowed-uses"
              type="number"
              value={allowedUses}
              onChange={(event) => setAllowedUses(event.target.value)}
              min={MIN_ALLOWED_USES}
              max={MAX_ALLOWED_USES}
              step="1"
              inputMode="numeric"
              aria-describedby="allowed-uses-help"
              disabled={isSubmitting}
              required
            />
            <small id="allowed-uses-help">允许该 key 使用的总次数，范围 1–1,000,000。</small>
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <LoaderCircle className={styles.spinner} aria-hidden="true" />
                正在签发…
              </>
            ) : (
              <>
                <ShieldCheck aria-hidden="true" />
                生成 Key
              </>
            )}
          </button>
        </form>

        {result && (
          <section className={styles.result} aria-live="polite" aria-label="签发结果">
            <div className={styles.resultHeading}>
              <div>
                <span>签发成功</span>
                <small>剩余可用次数：{result.remaining_uses.toLocaleString("zh-CN")}</small>
              </div>
              <Check aria-hidden="true" />
            </div>
            <div className={styles.keyRow}>
              <code>{result.key}</code>
              <button type="button" onClick={copyKey} aria-label="复制访问密钥">
                {copyState === "copied" ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                {copyState === "copied" ? "已复制" : "复制"}
              </button>
            </div>
            {copyState === "failed" && (
              <p className={styles.copyError} role="alert">复制失败，请手动选择 key 复制。</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
