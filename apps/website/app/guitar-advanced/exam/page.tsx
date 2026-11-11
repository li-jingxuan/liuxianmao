import { ExamLandingPage } from "../../../components/GuitarAdvanced/ExamLandingPage";
import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../../data/guitar-advanced";

export default function ExamPage() {
  return <ExamLandingPage data={GUITAR_ADVANCED_DATA} exam={GUITAR_ADVANCED_EXAM} />;
}
