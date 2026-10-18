import { LearningPathOverview } from "../../components/GuitarAdvanced/LearningPathOverview";
import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../data/guitar-advanced";

const GuitarAdvancedPage = () => (
  <LearningPathOverview data={GUITAR_ADVANCED_DATA} exam={GUITAR_ADVANCED_EXAM} />
);

export default GuitarAdvancedPage;
