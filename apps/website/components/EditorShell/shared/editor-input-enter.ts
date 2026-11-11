/** Text/number fields own plain Enter; Selects and buttons keep their keyboard behavior. */
export const isEditorInputEnter = (event: {
  key: string;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}) => {
  if (event.key !== "Enter" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const input = event.target;
  return input instanceof HTMLInputElement && !input.disabled && !input.readOnly &&
    ["text", "number", "search", "email", "tel", "url"].includes(input.type) &&
    !input.closest(".ant-select, [role='combobox'], [role='listbox']");
};
