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
    <ChordDiagramPreview diagram={diagram} width={47} height={48} />
    <span className={styles.name}>{name}</span>
  </Button>
);
