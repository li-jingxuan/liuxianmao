"use client";
import { Button } from "antd";
import type { ExerciseOption } from "../../lib/guitar-advanced/model";
import styles from "./LearningUi.module.scss";
export const OrderingAnswerInput = ({
  items,
  ids,
  disabled,
  onChange,
}: {
  items: readonly ExerciseOption[];
  ids: readonly string[];
  disabled: boolean;
  onChange: (ids: readonly string[]) => void;
}) => {
  const move = (index: number, delta: number) => {
    const next = [...ids];
    const value = next[index];
    if (value === undefined) return;
    next.splice(index, 1);
    next.splice(index + delta, 0, value);
    onChange(next);
  };
  return (
    <ol className={styles.orderList}>
      {ids.map((id, i) => (
        <li key={id}>
          <span>
            {i + 1}. {items.find((o) => o.id === id)?.label}
          </span>
          <div className={styles.actions} style={{ marginTop: 0 }}>
            <Button
              aria-label={`${items.find((o) => o.id === id)?.label} 上移`}
              disabled={disabled || i === 0}
              onClick={() => move(i, -1)}
            >
              上移
            </Button>
            <Button
              aria-label={`${items.find((o) => o.id === id)?.label} 下移`}
              disabled={disabled || i === ids.length - 1}
              onClick={() => move(i, 1)}
            >
              下移
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
};
