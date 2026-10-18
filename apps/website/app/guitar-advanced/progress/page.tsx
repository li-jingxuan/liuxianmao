import { ProgressPage } from "../../../components/GuitarAdvanced/ProgressPage";
import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../../data/guitar-advanced";

export default function GuitarAdvancedProgressPage() {
  return <ProgressPage data={GUITAR_ADVANCED_DATA} exam={GUITAR_ADVANCED_EXAM} />;
}
