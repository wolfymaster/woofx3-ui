import { PageHeader } from "@/components/layout/page-header";
import { StorageSettings } from "@/components/settings/storage-settings";

export default function AdminStorage() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Storage" description="Where this instance keeps uploaded assets and module resources." />

      <StorageSettings />
    </div>
  );
}
