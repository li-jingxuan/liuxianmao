import type { ILXMTechniqueType } from "@liuxianmao/lxm-editor";

export const TechniqueToolbarIcon = ({ type }: { type: ILXMTechniqueType }) => {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const drawing = (() => {
    switch (type) {
      case "hammerOn": case "pullOff": return <><path d="M2 19Q12 1 22 19M8 12V4M16 12V4" /><text x="9" y="11" fill="currentColor" stroke="none" fontSize="9">{type === "hammerOn" ? "H" : "P"}</text></>;
      case "slideUp": return <path d="M3 19L19 3M13 3h6v6" />;
      case "slideDown": return <path d="M3 3l16 16m-6 0h6v-6" />;
      case "tie": return <path d="M2 17Q12 2 22 17" />;
      case "bend": return <><path d="M3 20Q16 20 17 5m-4 4 4-4 4 4"/><text x="1" y="9" fill="currentColor" stroke="none" fontSize="7">full</text></>;
      case "vibrato": return <path d="M1 13q3-13 6 0t6 0t6 0t4 0"/>;
      case "naturalHarmonic": case "artificialHarmonic": return <><path d="m9 2 6 10-6 10-6-10z"/>{type === "artificialHarmonic" && <text x="16" y="16" fill="currentColor" stroke="none" fontSize="8">A</text>}</>;
      case "tapping": return <path d="M3 4h18M12 4v17"/>;
      case "trill": return <text x="2" y="18" fill="currentColor" stroke="none" fontSize="19" fontStyle="italic" fontFamily="serif">tr</text>;
      case "strum": return <><path d="M12 3v19m-4-4 4 4 4-4M5 5h14M5 9h14M5 13h14M5 17h14"/></>;
      case "arpeggio": return <><path d="M12 2q-9 4 0 7t0 7q-9 4 0 7M15 5l3-3 3 3"/></>;
      case "pickStroke": return <path d="M4 3h16L12 21z"/>;
      case "palmMute": case "letRing": return <><text x="1" y="14" fill="currentColor" stroke="none" fontSize={type === "palmMute" ? "9" : "6"}>{type === "palmMute" ? "P.M." : "let ring"}</text><path d="M2 19h20" strokeDasharray="2 2"/></>;
    }
  })();
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{drawing}</svg>;
};
