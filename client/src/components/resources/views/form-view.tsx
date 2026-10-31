import {
  checkFormQuestions,
  type FormField,
  type PageProblem,
  ProblemReport,
  parseFormFields,
} from "@shared/user-pages";
import { ListPlus, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AddFormToQueueDialog } from "@/components/resources/add-form-to-queue-dialog";
import type { KindView } from "@/components/resources/kind-views";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
import { FormQuestionsEditor } from "@/components/resources/views/form-questions-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SubmissionsPanel } from "@/components/user-page/submissions-panel";
import { useFormSubmissionsSupported } from "@/engine/hooks/use-form-submissions";
import { useUpdateResourceInstanceRequest } from "@/engine/hooks/use-module-resources";
import { toast } from "@/hooks/use-toast";
import { ProblemIndex } from "@/lib/page-problems";
import { resourceName } from "@/lib/resource-instance";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";

/** The path of the questions in the problems they are checked with. */
const QUESTIONS_PATH = "fields";

function questionProblems(questions: readonly FormField[]): PageProblem[] {
  const problems: PageProblem[] = [];
  checkFormQuestions(questions, ProblemReport.root(problems).field(QUESTIONS_PATH));
  return problems;
}

function questionCount(settings: Record<string, unknown>): number {
  return parseFormFields(settings.fields).length;
}

/** A woofx3 form: its questions, the answers it has received, and a quick way to send them to a queue. */
export const formView: KindView = {
  description:
    "Questions viewers answer on your public page. Decide below what happens with each answer: add it to a queue, post it to chat, or anything else.",
  icon: STREAM_OBJECT_ICONS.forms,
  railValue: ({ settings }) => questionCount(settings).toLocaleString(),
  detail: (props) => <FormPanel key={props.instance.canonicalId} {...props} />,
};

function FormPanel(props: ResourceDetailProps) {
  const { instance, settings } = props;
  const submissionsSupported = useFormSubmissionsSupported();
  const [addingToQueue, setAddingToQueue] = useState(false);
  return (
    <div className="space-y-6">
      <QuestionsCard instance={instance} settings={settings} />
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddingToQueue(true)}
          data-testid="button-add-form-to-queue"
        >
          <ListPlus className="mr-1.5 h-3.5 w-3.5" />
          Add to a queue
        </Button>
      </div>
      {addingToQueue && (
        <AddFormToQueueDialog
          formId={instance.canonicalId}
          formName={resourceName(instance)}
          settings={settings}
          onClose={() => setAddingToQueue(false)}
        />
      )}
      {submissionsSupported && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submissions</h2>
          <SubmissionsPanel formId={instance.canonicalId} />
        </section>
      )}
    </div>
  );
}

/**
 * The questions, edited as a draft and saved whole. A published page follows a
 * save straight away, so a half-written question is never saved, and a visitor
 * holding the old questions is asked to reload when they send.
 */
function QuestionsCard({ instance, settings }: Pick<ResourceDetailProps, "instance" | "settings">) {
  const updateInstance = useUpdateResourceInstanceRequest();
  const stored = useMemo(() => parseFormFields(settings.fields), [settings.fields]);
  const [draft, setDraft] = useState<FormField[] | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const questions = draft ?? stored;
  const problems = useMemo(() => questionProblems(questions), [questions]);

  const onSave = async () => {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    try {
      await updateInstance({
        canonicalId: instance.canonicalId,
        displayName: resourceName(instance),
        settings: { ...settings, fields: questions },
      });
      setDraft(null);
      setShowProblems(false);
    } catch (err) {
      toast({
        title: "Couldn't save those questions",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-3 p-4" data-testid="form-questions">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Questions</h2>
        {draft !== null && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setShowProblems(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void onSave()} data-testid="button-save-questions">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </div>
      <FormQuestionsEditor
        idPrefix={`form-${instance.resourceInstanceId}`}
        questions={questions}
        onChange={setDraft}
        path={QUESTIONS_PATH}
        problems={showProblems ? new ProblemIndex(problems) : ProblemIndex.empty}
      />
    </Card>
  );
}
