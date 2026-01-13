import { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, Grid3X3, LayoutGrid, ArrowUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface FilterOption {
  value: string;
  label: string;
}

export interface SortOption {
  value: string;
  label: string;
}

export interface GridWorkspaceProps<T> {
  title: string;
  description?: string;
  items: T[];
  isLoading?: boolean;
  searchPlaceholder?: string;
  categories?: FilterOption[];
  statusOptions?: FilterOption[];
  sortOptions?: SortOption[];
  defaultSort?: string;
  getSearchValue: (item: T) => string;
  getCategory?: (item: T) => string;
  getStatus?: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  headerActions?: React.ReactNode;
  emptyState?: React.ReactNode;
  gridCols?: 'compact' | 'normal' | 'large';
}

export function GridWorkspace<T>({
  title,
  description,
  items,
  isLoading = false,
  searchPlaceholder = 'Search...',
  categories,
  statusOptions,
  sortOptions,
  defaultSort,
  getSearchValue,
  getCategory,
  getStatus,
  renderItem,
  headerActions,
  emptyState,
  gridCols = 'normal',
}: GridWorkspaceProps<T>) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [sort, setSort] = useState<string>(defaultSort || sortOptions?.[0]?.value || 'name');
  const [density, setDensity] = useState<'compact' | 'normal' | 'large'>(gridCols);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const searchValue = getSearchValue(item).toLowerCase();
      const matchesSearch = search === '' || searchValue.includes(search.toLowerCase());
      
      const itemCategory = getCategory?.(item) || '';
      const matchesCategory = category === 'all' || itemCategory === category;
      
      const itemStatus = getStatus?.(item) || '';
      const matchesStatus = status === 'all' || itemStatus === status;
      
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [items, search, category, status, getSearchValue, getCategory, getStatus]);

  const gridClassName = cn(
    "grid gap-4",
    density === 'compact' && "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    density === 'normal' && "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
    density === 'large' && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
  );

  const hasFilters = categories || statusOptions;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">{description}</p>
          )}
        </div>
        {headerActions && (
          <div className="flex items-center gap-2" data-testid="container-header-actions">
            {headerActions}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>

          {categories && categories.length > 0 && (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-40" data-testid="select-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {statusOptions && statusOptions.length > 0 && (
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {hasFilters && (
            <Button variant="outline" size="icon" className="shrink-0" data-testid="button-more-filters">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {sortOptions && sortOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-sort">
                  <ArrowUpDown className="h-4 w-4" />
                  Sort
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                  {sortOptions.map((opt) => (
                    <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="flex items-center border rounded-md">
            <Button
              variant={density === 'compact' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-none rounded-l-md"
              onClick={() => setDensity('compact')}
              data-testid="button-density-compact"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={density === 'normal' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-none"
              onClick={() => setDensity('normal')}
              data-testid="button-density-normal"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={density === 'large' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-none rounded-r-md"
              onClick={() => setDensity('large')}
              data-testid="button-density-large"
            >
              <LayoutGrid className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground" data-testid="text-result-count">
        {isLoading ? 'Loading...' : `${filteredItems.length} items`}
      </div>

      {isLoading ? (
        <div className={gridClassName}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        emptyState || (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-muted-foreground mb-2">No items found</div>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search or filter criteria
            </p>
          </div>
        )
      ) : (
        <div className={gridClassName} data-testid="container-grid">
          {filteredItems.map((item, index) => (
            <div key={index} data-testid={`grid-item-${index}`}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
