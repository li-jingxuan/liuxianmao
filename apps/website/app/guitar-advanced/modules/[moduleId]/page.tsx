import { notFound } from "next/navigation";
import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../../../data/guitar-advanced";
import { findModule } from "../../../../lib/guitar-advanced/catalog";
import { ModuleDetailView } from "../../../../components/GuitarAdvanced/ModuleDetailView";
export default async function ModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;
  const moduleItem = findModule(GUITAR_ADVANCED_DATA, moduleId);
  if (!moduleItem || moduleItem.availability !== "available") notFound();
  return <ModuleDetailView module={moduleItem} data={GUITAR_ADVANCED_DATA} exam={GUITAR_ADVANCED_EXAM} />;
}
