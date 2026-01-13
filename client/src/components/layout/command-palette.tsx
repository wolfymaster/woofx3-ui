import { useCallback, useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { 
  LayoutDashboard, 
  Puzzle, 
  Workflow, 
  FolderOpen, 
  Layers, 
  Settings,
  Users,
  Plus,
  Search,
  FileText,
  Zap,
  Moon,
  Sun,
  Radio
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useTheme } from '@/hooks/use-theme';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();

  const runCommand = useCallback((command: () => void) => {
    onOpenChange(false);
    command();
  }, [onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        
        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => navigate('/'))}
            data-testid="command-dashboard"
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/modules'))}
            data-testid="command-modules"
          >
            <Puzzle className="mr-2 h-4 w-4" />
            <span>Modules</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/workflows'))}
            data-testid="command-workflows"
          >
            <Workflow className="mr-2 h-4 w-4" />
            <span>Workflows</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/assets'))}
            data-testid="command-assets"
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            <span>Assets</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/scenes'))}
            data-testid="command-scenes"
          >
            <Layers className="mr-2 h-4 w-4" />
            <span>Scenes</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() => runCommand(() => navigate('/workflows/new'))}
            data-testid="command-new-workflow"
          >
            <Plus className="mr-2 h-4 w-4" />
            <span>Create New Workflow</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/scenes'))}
            data-testid="command-new-scene"
          >
            <Layers className="mr-2 h-4 w-4" />
            <span>Open Scenes</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/assets'))}
            data-testid="command-upload-asset"
          >
            <FileText className="mr-2 h-4 w-4" />
            <span>Upload Asset</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Settings">
          <CommandItem
            onSelect={() => runCommand(toggleTheme)}
            data-testid="command-toggle-theme"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="mr-2 h-4 w-4" />
                <span>Switch to Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="mr-2 h-4 w-4" />
                <span>Switch to Dark Mode</span>
              </>
            )}
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/settings'))}
            data-testid="command-settings"
          >
            <Settings className="mr-2 h-4 w-4" />
            <span>Open Settings</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/team'))}
            data-testid="command-team"
          >
            <Users className="mr-2 h-4 w-4" />
            <span>Team Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
