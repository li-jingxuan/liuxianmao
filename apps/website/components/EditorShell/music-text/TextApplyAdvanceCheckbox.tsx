import { Checkbox } from "antd";

export interface TextApplyAdvanceSetting {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const TextApplyAdvanceCheckbox = ({ checked, onChange, disabled }: TextApplyAdvanceSetting & { disabled?: boolean }) => (
  <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled}>
    应用后跳转到下一处
  </Checkbox>
);
