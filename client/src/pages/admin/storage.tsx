import { useEffect } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { StorageSettings } from "@/components/settings/storage-settings";
import { useStorageAccess } from "@/lib/admin-access";

export default function AdminStorage() {
  const [, navigate] = useLocation();
  const { managed } = useStorageAccess();

  // The menu leaves this page out for a managed engine, which has no storage settings;
  // a saved link or a switch of instance can still land here.
  useEffect(() => {
    if (managed) {
      navigate("/admin/engine", { replace: true });
    }
  }, [managed, navigate]);

  if (managed) {
    return null;
  }

  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Storage" description="Your uploads and module files." />

      <StorageSettings />
    </div>
  );
}
