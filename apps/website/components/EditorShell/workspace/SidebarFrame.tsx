import type { ComponentProps, ReactNode } from "react";

export function SidebarFrame({ children, collapsed, ...props }:
  ComponentProps<"aside"> & { children: ReactNode; collapsed: boolean }) {
  return <aside {...props} hidden={collapsed}>
    {children}
  </aside>;
}
