import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Sparkles, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BasicWorkflowEditor } from '@/components/workflows/basic-editor';
import { PageHeader } from '@/components/layout/page-header';

export default function WorkflowsNew() {
  const [, navigate] = useLocation();
  const [editorMode, setEditorMode] = useState<'basic' | 'advanced'>('basic');

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

      <Tabs value={editorMode} onValueChange={(v) => setEditorMode(v as 'basic' | 'advanced')} className="mt-6">
        <TabsList className="grid w-full max-w-md grid-cols-2 mx-auto mb-8">
          <TabsTrigger value="basic" className="gap-2" data-testid="tab-basic">
            <Sparkles className="h-4 w-4" />
            Basic
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-2" data-testid="tab-advanced">
            <Settings2 className="h-4 w-4" />
            Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <BasicWorkflowEditor />
        </TabsContent>

        <TabsContent value="advanced">
          <div className="text-center py-12">
            <Settings2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Advanced Editor</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              The advanced editor provides a visual node-based interface for building complex workflows with multiple triggers, conditions, and actions.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Create a workflow using the basic editor first, then edit it with the advanced editor.
            </p>
            <Button variant="outline" onClick={() => setEditorMode('basic')}>
              Switch to Basic Editor
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
