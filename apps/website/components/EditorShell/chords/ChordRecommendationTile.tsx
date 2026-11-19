import { Button } from "antd";
import type { ILXMChordDiagram } from "@liuxianmao/lxm-editor";
import { ChordDiagramPreview } from "./ChordEditor";
import styles from "./ChordRecommendationTile.module.scss";

/** Shared compact presentation for sidebar and popover recommendations. */
export const ChordRecommendationTile = ({
  name,
  diagram,
  selected = false,
  disabled = false,
  unavailableReason,
  onClick,
}: {
  name: string;
  diagram: ILXMChordDiagram | null;
  selected?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  onClick: () => void;
}) => (
  <Button
    className={styles.tile}
    disabled={disabled}
    aria-label={name}
    aria-pressed={selected}
    title={unavailableReason ? `${name} · ${unavailableReason}` : name}
    onClick={onClick}
  >
    <span className={styles.name}>{name}</span>
    <ChordDiagramPreview diagram={diagram} width={43} height={43} />
  </Button>
);
