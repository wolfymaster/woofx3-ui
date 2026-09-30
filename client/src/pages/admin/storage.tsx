import { useEffect } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { StorageSettings } from "@/components/settings/storage-settings";
import { useInstance } from "@/hooks/use-instance";

export default function AdminStorage() {
  const { instance } = useInstance();
  const [, navigate] = useLocation();
  const managed = instance?.hosting === "managed";

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
      <PageHeader title="Storage" description="Where this instance keeps uploaded assets and module resources." />

      <StorageSettings />
    </div>
  );
}
