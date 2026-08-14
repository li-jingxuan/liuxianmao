"use client";

import { Palette, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getColorCatalog } from "@/lib/api";
import type {
  CatalogColor,
  ColorCatalogResponse,
  ColorSeriesGroup,
  ColorSetGroup,
} from "@/lib/types";

import styles from "./mard-color-catalog.module.scss";

const ALL_GROUPS = "all";
type GroupingMode = "series" | "sets";
type DisplayGroup = {
  id: string;
  label: string;
  colorCount: number;
  colors: CatalogColor[];
};

/** 根据当前筛选返回可见系列，不复制或重排后端颜色数据。 */
export const selectVisibleGroups = (
  groups: DisplayGroup[],
  selectedGroup: string,
) =>
  selectedGroup === ALL_GROUPS
    ? groups
    : groups.filter(({ id }) => id === selectedGroup);

const toSeriesDisplayGroups = (groups: ColorSeriesGroup[]): DisplayGroup[] =>
  groups.map((group) => ({
    id: group.series,
    label: group.label,
    colorCount: group.color_count,
    colors: group.colors,
  }));

const toSetDisplayGroups = (sets: ColorSetGroup[]): DisplayGroup[] =>
  sets.map((set) => ({
    id: String(set.size),
    label: set.label,
    colorCount: set.color_count,
    colors: set.colors,
  }));

export function MardColorCatalog() {
  const [catalog, setCatalog] = useState<ColorCatalogResponse | null>(null);
  const [groupingMode, setGroupingMode] = useState<GroupingMode>("series");
  const [selectedGroup, setSelectedGroup] = useState(ALL_GROUPS);
  const [requestVersion, setRequestVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getColorCatalog(controller.signal)
      .then((response) => {
        setCatalog(response);
        setSelectedGroup(ALL_GROUPS);
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

  const displayGroups = useMemo(
    () =>
      groupingMode === "series"
        ? toSeriesDisplayGroups(catalog?.groups ?? [])
        : toSetDisplayGroups(catalog?.sets ?? []),
    [catalog, groupingMode],
  );
  const visibleGroups = useMemo(
    () => selectVisibleGroups(displayGroups, selectedGroup),
    [displayGroups, selectedGroup],
  );

  const switchGroupingMode = (mode: GroupingMode) => {
    setGroupingMode(mode);
    setSelectedGroup(ALL_GROUPS);
  };

  const retry = () => {
    setError(null);
    setIsLoading(true);
    setRequestVersion((value) => value + 1);
  };

  return (
    <main className={styles.page} aria-busy={isLoading}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden="true">
            <Palette />
          </span>
          <div>
            <h1>MARD 全量色卡</h1>
            <p>按色号系列或颜色套装查看网页近似色，用于色卡和接口测试</p>
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
          <button type="button" onClick={retry}>
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
          <div className={styles.groupingModes} aria-label="颜色分组方式">
            <button
              type="button"
              aria-pressed={groupingMode === "series"}
              onClick={() => switchGroupingMode("series")}
            >
              按色号系列
            </button>
            <button
              type="button"
              aria-pressed={groupingMode === "sets"}
              onClick={() => switchGroupingMode("sets")}
            >
              按颜色套装
            </button>
          </div>

          {displayGroups.length > 0 ? (
            <nav
              className={styles.filters}
              aria-label={groupingMode === "series" ? "颜色系列筛选" : "颜色套装筛选"}
            >
              <button
                type="button"
                aria-label={
                  groupingMode === "series"
                    ? `全部系列，共 ${catalog.total_count} 色`
                    : `全部套装，共 ${displayGroups.length} 套`
                }
                aria-pressed={selectedGroup === ALL_GROUPS}
                onClick={() => setSelectedGroup(ALL_GROUPS)}
              >
                {groupingMode === "series" ? "全部系列" : "全部套装"}
                <span>
                  {groupingMode === "series"
                    ? catalog.total_count
                    : `${displayGroups.length}套`}
                </span>
              </button>
              {displayGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  aria-label={
                    groupingMode === "series"
                      ? `${group.id} 系列，共 ${group.colorCount} 色`
                      : `${group.id}色套装，共 ${group.colorCount} 色`
                  }
                  aria-pressed={selectedGroup === group.id}
                  onClick={() => setSelectedGroup(group.id)}
                >
                  {groupingMode === "series" ? group.id : `${group.id}色套装`}
                  <span>{group.colorCount}</span>
                </button>
              ))}
            </nav>
          ) : (
            <section className={styles.statePanel}>暂无分组数据</section>
          )}

          <div className={styles.groups}>
            {visibleGroups.map((group) => (
              <section
                key={group.id}
                className={styles.group}
                aria-labelledby={`color-group-${groupingMode}-${group.id}`}
              >
                <div className={styles.groupHeading}>
                  <h2 id={`color-group-${groupingMode}-${group.id}`}>{group.label}</h2>
                  <span>{group.colorCount} 色</span>
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
