import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { FileAudio, FileImage, FileVideo, Upload } from 'lucide-react';
import { 
  type ConfigField, 
  type TriggerConfigValues, 
  type ConfigValue,
} from '@/lib/workflow-presets';

interface ConfigFieldRendererProps {
  field: ConfigField;
  value: any;
  onChange: (value: any) => void;
}

function NumberField({ field, value, onChange }: ConfigFieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>{field.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={field.id}
          type="number"
          min={field.min}
          max={field.max}
          value={value || ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
          placeholder={field.placeholder}
          className="flex-1"
          data-testid={`input-${field.id}`}
        />
        {field.unit && (
          <span className="text-sm text-muted-foreground whitespace-nowrap">{field.unit}</span>
        )}
      </div>
    </div>
  );
}

function RangeField({ field, value, onChange }: ConfigFieldRendererProps) {
  const configValue = value as ConfigValue || { type: 'single', value: field.min || 1 };
  const isRange = configValue.type === 'range';

  const handleModeChange = (useRange: boolean) => {
    if (useRange) {
      onChange({ 
        type: 'range', 
        min: configValue.value || field.min || 1, 
        max: (configValue.value || field.min || 1) + 10 
      });
    } else {
      onChange({ 
        type: 'single', 
        value: configValue.min || configValue.value || field.min || 1 
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{field.label}</Label>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs", !isRange && "text-foreground", isRange && "text-muted-foreground")}>
            Exact
          </span>
          <Switch
            checked={isRange}
            onCheckedChange={handleModeChange}
            data-testid={`switch-range-${field.id}`}
          />
          <span className={cn("text-xs", isRange && "text-foreground", !isRange && "text-muted-foreground")}>
            Range
          </span>
        </div>
      </div>
      
      {isRange ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              type="number"
              min={field.min}
              max={field.max}
              value={configValue.min || ''}
              onChange={(e) => onChange({ 
                ...configValue, 
                min: e.target.value ? Number(e.target.value) : field.min 
              })}
              placeholder="Min"
              data-testid={`input-${field.id}-min`}
            />
          </div>
          <span className="text-muted-foreground">to</span>
          <div className="flex-1">
            <Input
              type="number"
              min={field.min}
              max={field.max}
              value={configValue.max || ''}
              onChange={(e) => onChange({ 
                ...configValue, 
                max: e.target.value ? Number(e.target.value) : field.max 
              })}
              placeholder="Max"
              data-testid={`input-${field.id}-max`}
            />
          </div>
          {field.unit && (
            <span className="text-sm text-muted-foreground whitespace-nowrap">{field.unit}</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={field.min}
            max={field.max}
            value={configValue.value || ''}
            onChange={(e) => onChange({ 
              ...configValue, 
              value: e.target.value ? Number(e.target.value) : field.min 
            })}
            placeholder={field.placeholder}
            className="flex-1"
            data-testid={`input-${field.id}`}
          />
          {field.unit && (
            <span className="text-sm text-muted-foreground whitespace-nowrap">{field.unit}</span>
          )}
        </div>
      )}
    </div>
  );
}

function TextField({ field, value, onChange }: ConfigFieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>{field.label}</Label>
      <Input
        id={field.id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        data-testid={`input-${field.id}`}
      />
    </div>
  );
}

function SelectField({ field, value, onChange }: ConfigFieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label>{field.label}</Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger data-testid={`select-${field.id}`}>
          <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToggleField({ field, value, onChange }: ConfigFieldRendererProps) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={field.id}>{field.label}</Label>
      <Switch
        id={field.id}
        checked={value || false}
        onCheckedChange={onChange}
        data-testid={`switch-${field.id}`}
      />
    </div>
  );
}

function MediaField({ field, value, onChange }: ConfigFieldRendererProps) {
  const MediaIcon = field.mediaType === 'audio' ? FileAudio : 
                    field.mediaType === 'video' ? FileVideo : FileImage;

  return (
    <div className="space-y-2">
      <Label>{field.label}</Label>
      {value ? (
        <Card className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MediaIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{value}</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => onChange(null)}
            data-testid={`button-remove-${field.id}`}
          >
            Remove
          </Button>
        </Card>
      ) : (
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2"
          onClick={() => onChange(`sample-${field.mediaType || 'file'}.${field.mediaType === 'audio' ? 'mp3' : field.mediaType === 'video' ? 'mp4' : 'png'}`)}
          data-testid={`button-select-${field.id}`}
        >
          <Upload className="h-4 w-4" />
          Select {field.mediaType || 'file'}
        </Button>
      )}
    </div>
  );
}

interface TriggerConfigFormProps {
  fields: ConfigField[];
  values: TriggerConfigValues;
  onChange: (values: TriggerConfigValues) => void;
  className?: string;
}

export function TriggerConfigForm({ fields, values, onChange, className }: TriggerConfigFormProps) {
  const handleFieldChange = (fieldId: string, value: any) => {
    onChange({ ...values, [fieldId]: value });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {fields.map(field => {
        const props = {
          field,
          value: values[field.id],
          onChange: (value: any) => handleFieldChange(field.id, value),
        };

        switch (field.type) {
          case 'number':
            return <NumberField key={field.id} {...props} />;
          case 'range':
            return <RangeField key={field.id} {...props} />;
          case 'text':
            return <TextField key={field.id} {...props} />;
          case 'select':
            return <SelectField key={field.id} {...props} />;
          case 'toggle':
            return <ToggleField key={field.id} {...props} />;
          case 'media':
            return <MediaField key={field.id} {...props} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
