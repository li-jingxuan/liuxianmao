import { Form, Select } from "antd";
import editorFormStyles from "../shared/editor-form.module.scss";

/** 仅编辑 token 的一个维度，保留另外两维及原有变音编码；草稿仍由编辑器持有。 */
export const NumberedPitchFields = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const parts = value.match(/^([#bn♯♭♮]?)([1-7])('{1,3}|\.{1,2})?$/);
  const accidental = parts?.[1] ?? "";
  const pitch = parts?.[2];
  const suffix = parts?.[3] ?? "";
  const octave = suffix.startsWith("'") ? suffix.length : -suffix.length;
  return (
    <>
      <Form.Item layout="vertical" label="八度" htmlFor="numbered-pitch-octave">
        <Select
          id="numbered-pitch-octave"
          aria-label="简谱单音符八度"
          value={parts ? octave : undefined}
          disabled={!parts}
          options={[-2, -1, 0, 1, 2, 3].map((value) => ({
            value,
            label:
              value === 0
                ? "本位"
                : `${value > 0 ? "高" : "低"}${Math.abs(value) === 1 ? "" : Math.abs(value)}八度`,
          }))}
          onChange={(next) =>
            onChange(
              `${accidental}${pitch}${next > 0 ? "'".repeat(next) : ".".repeat(-next)}`,
            )
          }
        />
      </Form.Item>
      <div className={editorFormStyles.propertyGrid} style={{ gridColumn: "1 / -1" }}>
        <Form.Item layout="vertical" label="音高" htmlFor="numbered-pitch-degree">
          <Select
            id="numbered-pitch-degree"
            aria-label="简谱单音符音高"
            value={pitch}
            disabled={!parts}
            options={[1, 2, 3, 4, 5, 6, 7].map((value) => ({
              value: String(value),
              label: String(value),
            }))}
            onChange={(next) => onChange(`${accidental}${next}${suffix}`)}
          />
        </Form.Item>
        <Form.Item layout="vertical" label="变音" htmlFor="numbered-pitch-accidental">
          <Select
            id="numbered-pitch-accidental"
            aria-label="简谱单音符变音"
            value={
              ({ "♯": "#", "♭": "b", "♮": "n" } as Record<string, string>)[
                accidental
              ] ?? accidental
            }
            disabled={!parts}
            options={[
              { value: "", label: "无" },
              { value: "#", label: "升号 ♯" },
              { value: "b", label: "降号 ♭" },
              { value: "n", label: "还原号 ♮" },
            ]}
            onChange={(next) => onChange(`${next}${pitch}${suffix}`)}
          />
        </Form.Item>
      </div>
    </>
  );
};
