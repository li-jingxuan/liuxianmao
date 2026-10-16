"use client";
import { Radio, Tooltip } from "antd";
import { useSyncExternalStore } from "react";
import { TECHNIQUE_GROUPS } from "./technique-catalog";
import type { TechniqueTypeController } from "./technique-type-controller";
import styles from "./index.module.scss";

/** 分组展示全部 16 类，暂存选择不提交音乐命令。 */
export const TechniqueTypePicker = ({
  controller,
}: {
  controller: TechniqueTypeController;
}) => {
  const selected = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return (
    <div className={styles.techniquePicker}>
      <p className={styles.settingsHint}>
        按当前音符、拍点或范围选择可用技巧。
      </p>
      {TECHNIQUE_GROUPS.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <Radio.Group
            buttonStyle="solid"
            value={selected}
            aria-label={group.label}
            className={styles.techniqueTypeGrid}
            onChange={(event) => controller.select(event.target.value)}
          >
            {group.items.map((item) => (
              <Tooltip key={item.value} title={controller.reason(item.value)}>
                <span
                  tabIndex={controller.reason(item.value) ? 0 : undefined}
                  aria-label={controller.reason(item.value) ?? undefined}
                >
                  <Radio.Button
                    className={styles.toolChoiceCard}
                    value={item.value}
                    disabled={!!controller.reason(item.value)}
                  >
                    {item.label}
                  </Radio.Button>
                </span>
              </Tooltip>
            ))}
          </Radio.Group>
        </section>
      ))}
    </div>
  );
};
