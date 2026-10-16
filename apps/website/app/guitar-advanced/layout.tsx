import type { ReactNode } from "react";
import { GuitarAdvancedShell } from "../../components/GuitarAdvanced/GuitarAdvancedShell";

const GuitarAdvancedLayout = ({ children }: { children: ReactNode }) => (
  <GuitarAdvancedShell>{children}</GuitarAdvancedShell>
);

export default GuitarAdvancedLayout;
