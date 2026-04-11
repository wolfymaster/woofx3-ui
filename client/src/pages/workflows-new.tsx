import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BasicWorkflowEditor } from '@/components/workflows/basic-editor';
import { PageHeader } from '@/components/layout/page-header';

export default function WorkflowsNew() {
  const [, navigate] = useLocation();

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Create Workflow"
        description="Build automations for your stream"
        actions={
          <Button variant="ghost" onClick={() => navigate('/workflows')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Workflows
          </Button>
        }
      />

      <div className="mt-6">
        <BasicWorkflowEditor />
      </div>
    </div>
  );
}
