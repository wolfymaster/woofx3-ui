import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { actionErrorMessage } from "@/lib/action-error";

interface RenameDialogProps {
  title: string;
  current: string;
  onRename: (name: string) => Promise<unknown>;
  testId: string;
}

/** A "Rename" button and its dialog, for an organization or an engine. */
export function RenameDialog({ title, current, onRename, testId }: RenameDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onRename(name.trim());
      setOpen(false);
      toast({ title: "Renamed" });
    } catch (error) {
      toast({ title: "Could not rename", description: actionErrorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setName(current);
          setOpen(true);
        }}
        data-testid={testId}
      >
        Rename
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor={`${testId}-name`}>Name</Label>
            <Input id={`${testId}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || name.trim() === ""}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
