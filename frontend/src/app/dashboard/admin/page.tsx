import { AdminPanels } from "@/app/dashboard/admin/admin-panels";
import { findNavItem } from "@/components/dashboard/nav-items";
import { PageHeader } from "@/components/dashboard/page-header";

const META = findNavItem("/dashboard/admin")!;

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={META.label} subtitle={META.subtitle} />
      <AdminPanels />
    </div>
  );
}
