import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from 'convex/react';
import JSZip from 'jszip';
import Editor from '@monaco-editor/react';
import {
  Upload,
  File,
  Folder,
  FolderOpen,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  Loader2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/layout/page-header';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { api } from '@convex/_generated/api';
import { useInstance } from '@/hooks/use-instance';
import type { Id } from '@convex/_generated/dataModel';

interface FileNode {
  name: string;
  path: string;
  content?: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface CheckResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
}

function buildFileTree(files: Record<string, string>): FileNode[] {
  const tree: FileNode[] = [];
  const pathMap = new Map<string, FileNode>();

  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!pathMap.has(currentPath)) {
        const node: FileNode = {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          content: isLast ? content : undefined,
          children: [],
        };
        
        pathMap.set(currentPath, node);
        
        if (i === 0) {
          tree.push(node);
        } else {
          const parentPath = parts.slice(0, i).join('/');
          const parent = pathMap.get(parentPath);
          if (parent) {
            parent.children = parent.children || [];
            parent.children.push(node);
          }
        }
      }
    }
  }
  
  return tree;
}

function FileExplorer({
  files,
  selectedPath,
  onSelect,
}: {
  files: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpand = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: FileNode, depth = 0) => {
    const isExpanded = expanded.has(node.path);
    const isSelected = selectedPath === node.path;
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted text-sm',
            isSelected && 'bg-muted font-medium'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (node.isDirectory && hasChildren) {
              toggleExpand(node.path);
            } else if (!node.isDirectory) {
              onSelect(node.path);
            }
          }}
        >
          {node.isDirectory ? (
            <>
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )
              ) : (
                <div className="w-4" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Folder className="h-4 w-4 text-muted-foreground" />
              )}
            </>
          ) : (
            <>
              <div className="w-4" />
              <File className="h-4 w-4 text-muted-foreground" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {node.isDirectory && hasChildren && isExpanded && (
          <div>
            {node.children!.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {files.map(node => renderNode(node))}
      </div>
    </ScrollArea>
  );
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'html': 'html',
    'css': 'css',
    'py': 'python',
    'go': 'go',
    'rs': 'rust',
    'sh': 'shell',
    'bash': 'shell',
  };
  return langMap[ext || ''] || 'plaintext';
}

// Checks Pipeline
interface Check {
  id: string;
  name: string;
  run: (files: Record<string, string>) => Promise<CheckResult>;
}

const checks: Check[] = [
  {
    id: 'json-validator',
    name: 'JSON Validator',
    run: async (files) => {
      const jsonFiles = Object.entries(files).filter(([path]) => 
        path.endsWith('.json')
      );
      
      for (const [path, content] of jsonFiles) {
        try {
          JSON.parse(content);
        } catch (error) {
          return {
            id: 'json-validator',
            name: 'JSON Validator',
            status: 'fail',
            message: `Invalid JSON in ${path}: ${error instanceof Error ? error.message : 'Parse error'}`,
          };
        }
      }
      
      return {
        id: 'json-validator',
        name: 'JSON Validator',
        status: 'pass',
        message: `All ${jsonFiles.length} JSON files are valid`,
      };
    },
  },
  {
    id: 'yaml-validator',
    name: 'YAML Validator',
    run: async (files) => {
      // Simple YAML validation - in production you'd use a proper YAML parser
      const yamlFiles = Object.entries(files).filter(([path]) => 
        path.endsWith('.yaml') || path.endsWith('.yml')
      );
      
      for (const [path, content] of yamlFiles) {
        // Basic YAML structure check
        if (content.trim() && !content.includes(':')) {
          return {
            id: 'yaml-validator',
            name: 'YAML Validator',
            status: 'fail',
            message: `Invalid YAML structure in ${path}`,
          };
        }
      }
      
      return {
        id: 'yaml-validator',
        name: 'YAML Validator',
        status: 'pass',
        message: `All ${yamlFiles.length} YAML files appear valid`,
      };
    },
  },
];

async function runChecks(files: Record<string, string>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      const result = await check.run(files);
      results.push(result);
    } catch (error) {
      results.push({
        id: check.id,
        name: check.name,
        status: 'fail',
        message: `Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
  return results;
}

export default function ModuleInstall() {
  const [, navigate] = useLocation();
  const { theme } = useTheme();
  const { instance } = useInstance();
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [isRunningChecks, setIsRunningChecks] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
  const createModule = useMutation(api.moduleRepository.create);

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  
  // Find manifest file on load
  useEffect(() => {
    if (Object.keys(files).length > 0 && !selectedPath) {
      const manifestPath = Object.keys(files).find(path => 
        path.endsWith('manifest.json') || path.endsWith('manifest.yaml') || path.endsWith('manifest.yml')
      );
      if (manifestPath) {
        setSelectedPath(manifestPath);
      } else {
        // Select first file
        const firstFile = Object.keys(files).find(path => !path.endsWith('/'));
        if (firstFile) {
          setSelectedPath(firstFile);
        }
      }
    }
  }, [files, selectedPath]);

  // Run checks when files change
  useEffect(() => {
    if (Object.keys(files).length > 0) {
      setIsRunningChecks(true);
      runChecks(files).then(results => {
        setCheckResults(results);
        setIsRunningChecks(false);
      });
    }
  }, [files]);

  const processZipFile = useCallback(async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file);
      const extractedFiles: Record<string, string> = {};

      await Promise.all(
        Object.keys(zip.files).map(async (filename) => {
          const zipEntry = zip.files[filename];
          if (!zipEntry.dir) {
            const content = await zipEntry.async('string');
            extractedFiles[filename] = content;
          }
        })
      );

      setFiles(extractedFiles);
    } catch (error) {
      console.error('Failed to extract zip:', error);
      setInstallError('Failed to extract zip file. Please ensure it is a valid zip archive.');
    }
  }, []);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) { return; }
    await processZipFile(file);
  }, [processZipFile]);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) { return; }

    if (!file.name.endsWith('.zip')) {
      setInstallError('Please drop a .zip file.');
      return;
    }

    await processZipFile(file);
  }, [processZipFile]);

  const handleFileChange = useCallback((path: string, content: string) => {
    setFiles(prev => ({
      ...prev,
      [path]: content,
    }));
  }, []);

  const handleInstall = useCallback(async () => {
    if (!instance) {
      setInstallError('No instance selected. Please select an instance first.');
      return;
    }

    setIsInstalling(true);
    setInstallError(null);
    try {
      // Build zip from current files
      const zip = new JSZip();
      for (const [path, content] of Object.entries(files)) {
        zip.file(path, content);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Upload zip to Convex storage
      const uploadUrl = await generateUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zipBlob,
      });
      if (!uploadResult.ok) throw new Error('Upload failed');
      const { storageId } = await uploadResult.json() as { storageId: Id<'_storage'> };

      // Parse manifest from extracted files
      const manifestContent =
        files['manifest.json'] ||
        files[Object.keys(files).find((f) => f.endsWith('manifest.json')) ?? ''];

      let manifest: Record<string, unknown> = {};
      if (manifestContent) {
        try { manifest = JSON.parse(manifestContent); } catch {}
      }

      const name = (manifest.name as string) || Object.keys(files)[0]?.split('/')[0] || 'Unknown Module';
      const description = (manifest.description as string) || '';
      const version = (manifest.version as string) || '1.0.0';
      const tags: string[] = Array.isArray(manifest.tags) ? manifest.tags as string[] : [];

      // Create module repository entry
      const moduleId = await createModule({
        instanceId: instance._id,
        name,
        description,
        version,
        tags,
        manifest,
        archiveKey: storageId,
      });

      navigate('/modules');
    } catch (error) {
      console.error('Failed to install module:', error);
      setInstallError(error instanceof Error ? error.message : 'Failed to install module. Please try again.');
    } finally {
      setIsInstalling(false);
    }
  }, [files, navigate, instance, generateUploadUrl, createModule]);

  const allChecksPassed = checkResults.length > 0 && checkResults.every(r => r.status === 'pass');
  const selectedContent = selectedPath ? files[selectedPath] : null;
  const selectedLanguage = selectedPath ? getLanguageFromPath(selectedPath) : 'plaintext';

  if (Object.keys(files).length === 0) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
        <PageHeader 
          title="Install Module" 
          description="Upload a module zip file to install it."
        />
        
        <Card
          className={cn(
            "mt-8 transition-colors",
            isDragging && "border-primary border-2 bg-primary/5",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <CardContent className="pt-12 pb-12">
            <div className="flex flex-col items-center justify-center">
              <Upload className={cn("h-16 w-16 mb-4", isDragging ? "text-primary" : "text-muted-foreground")} />
              <h3 className="text-lg font-semibold mb-2">
                {isDragging ? "Drop to upload" : "Upload Module Zip"}
              </h3>
              <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
                Drag and drop a zip file here, or click the button below to browse.
              </p>
              <label>
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose Zip File
                  </span>
                </Button>
              </label>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="border-b bg-background shrink-0">
        <div className="p-6 max-w-[1600px] mx-auto">
          <PageHeader 
            title="Install Module" 
            description="Review and edit module files before installation."
          />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* File Explorer */}
        <div className="w-64 border-r bg-muted/30 shrink-0 flex flex-col">
          <div className="p-3 border-b">
            <h3 className="text-sm font-semibold">Files</h3>
          </div>
          <div className="flex-1 overflow-hidden">
            <FileExplorer
              files={fileTree}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedPath && selectedContent !== null ? (
            <>
              <div className="border-b px-4 py-2 flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2">
                  <File className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{selectedPath}</span>
                </div>
              </div>
              <div className="flex-1">
                <Editor
                  height="100%"
                  language={selectedLanguage}
                  value={selectedContent}
                  onChange={(value) => value && handleFileChange(selectedPath, value)}
                  theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <File className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a file to edit</p>
              </div>
            </div>
          )}
        </div>

        {/* Checks & Actions */}
        <div className="w-80 border-l bg-muted/30 shrink-0 flex flex-col">
          <div className="p-4 border-b">
            <h3 className="text-sm font-semibold mb-4">Validation Checks</h3>
            {isRunningChecks ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running checks...
              </div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {checkResults.map((result) => (
                    <div
                      key={result.id}
                      className={cn(
                        'p-3 rounded-md border text-sm',
                        result.status === 'pass' && 'bg-green-500/10 border-green-500/20',
                        result.status === 'fail' && 'bg-red-500/10 border-red-500/20',
                        result.status === 'warning' && 'bg-yellow-500/10 border-yellow-500/20'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {result.status === 'pass' && (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        {result.status === 'fail' && (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        {result.status === 'warning' && (
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                        )}
                        <span className="font-medium">{result.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.message}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <Separator />

          <div className="p-4 border-b">
            <h3 className="text-sm font-semibold mb-1">Install Behavior</h3>
            <p className="text-xs text-muted-foreground">
              Creating this module now enqueues delivery to the selected engine instance.
            </p>
          </div>

          <div className="p-4 mt-auto">
            <Button
              className="w-full"
              onClick={handleInstall}
              disabled={!allChecksPassed || isInstalling}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Install Module
                </>
              )}
            </Button>
            {!allChecksPassed && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Fix validation errors before installing
              </p>
            )}
            {installError && (
              <div className="mt-3 p-3 rounded-md border bg-red-500/10 border-red-500/20">
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>{installError}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
