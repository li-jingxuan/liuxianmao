"use client";

import { Palette, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getColorCatalog } from "@/lib/api";
import type { ColorCatalogResponse, ColorSeriesGroup } from "@/lib/types";

import styles from "./mard-color-catalog.module.scss";

const ALL_SERIES = "all";

/** 根据当前筛选返回可见系列，不复制或重排后端颜色数据。 */
export const selectVisibleGroups = (
  groups: ColorSeriesGroup[],
  selectedSeries: string,
) =>
  selectedSeries === ALL_SERIES
    ? groups
    : groups.filter(({ series }) => series === selectedSeries);

export function MardColorCatalog() {
  const [catalog, setCatalog] = useState<ColorCatalogResponse | null>(null);
  const [selectedSeries, setSelectedSeries] = useState(ALL_SERIES);
  const [requestVersion, setRequestVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    getColorCatalog(controller.signal)
      .then((response) => {
        setCatalog(response);
        setSelectedSeries(ALL_SERIES);
      })
      .catch((cause: unknown) => {
        if ((cause as Error).name !== "AbortError") {
          setError("色卡加载失败，请确认后端服务已启动");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [requestVersion]);

  const visibleGroups = useMemo(
    () => selectVisibleGroups(catalog?.groups ?? [], selectedSeries),
    [catalog, selectedSeries],
  );

  return (
    <main className={styles.page} aria-busy={isLoading}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden="true">
            <Palette />
          </span>
          <div>
            <h1>MARD 全量色卡</h1>
            <p>按色号系列查看网页近似色，用于色卡和接口测试</p>
          </div>
        </div>
        {catalog && (
          <div className={styles.total} aria-label={`共 ${catalog.total_count} 色`}>
            <strong>{catalog.total_count}</strong>
            <span>种颜色</span>
          </div>
        )}
      </header>

      {isLoading && !catalog && (
        <section className={styles.statePanel} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <strong>正在加载 MARD 色卡…</strong>
          <div className={styles.skeletonGrid} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
        </section>
      )}

      {error && !isLoading && (
        <section className={styles.statePanel} role="alert">
          <strong>{error}</strong>
          <button type="button" onClick={() => setRequestVersion((value) => value + 1)}>
            <RefreshCw aria-hidden="true" />
            重新加载
          </button>
        </section>
      )}

      {!isLoading && !error && catalog?.groups.length === 0 && (
        <section className={styles.statePanel}>暂无颜色数据</section>
      )}

      {catalog && catalog.groups.length > 0 && !error && (
        <>
          <nav className={styles.filters} aria-label="颜色系列筛选">
            <button
              type="button"
              aria-pressed={selectedSeries === ALL_SERIES}
              onClick={() => setSelectedSeries(ALL_SERIES)}
            >
              全部 <span>{catalog.total_count}</span>
            </button>
            {catalog.groups.map((group) => (
              <button
                key={group.series}
                type="button"
                aria-pressed={selectedSeries === group.series}
                onClick={() => setSelectedSeries(group.series)}
              >
                {group.series} <span>{group.color_count}</span>
              </button>
            ))}
          </nav>

          <div className={styles.groups}>
            {visibleGroups.map((group) => (
              <section
                key={group.series}
                className={styles.group}
                aria-labelledby={`series-${group.series}`}
              >
                <div className={styles.groupHeading}>
                  <h2 id={`series-${group.series}`}>{group.label}</h2>
                  <span>{group.color_count} 色</span>
                </div>
                <ul className={styles.colorGrid}>
                  {group.colors.map((color) => (
                    <li key={color.code} className={styles.colorCard}>
                      <div
                        className={styles.swatch}
                        style={{ backgroundColor: color.hex }}
                        aria-label={`${color.code} 色块，${color.hex}`}
                      />
                      <div className={styles.colorMeta}>
                        <strong>{color.code}</strong>
                        <span>{color.hex}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
