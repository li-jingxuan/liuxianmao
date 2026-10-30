import type { ReactNode } from "react";
import { GuitarAdvancedShell } from "../../components/GuitarAdvanced/GuitarAdvancedShell";

import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../data/guitar-advanced";

const GuitarAdvancedLayout = ({ children }: { children: ReactNode }) => (
  <GuitarAdvancedShell data={GUITAR_ADVANCED_DATA} exam={GUITAR_ADVANCED_EXAM}>
    {children}
  </GuitarAdvancedShell>
);

export default GuitarAdvancedLayout;
