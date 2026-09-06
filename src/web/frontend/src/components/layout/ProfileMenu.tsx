import { useTheme } from '@/hooks/useTheme';
import { Link } from 'react-router-dom';
import { CircleUserRound, Settings, ListChecks } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';

export function ProfileMenu() {
  const { preference, setPreference } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Profile menu" className="min-h-11 min-w-11 inline-flex items-center justify-center gap-2 rounded-lg hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring">
          <CircleUserRound className="h-5 w-5" />
          <span className="hidden lg:inline">Profile</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-card-elev text-foreground border-border">
        <DropdownMenuItem asChild className="min-h-11 focus:bg-foreground/10 focus:text-foreground">
          <Link to="/settings"><Settings />Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11 focus:bg-foreground/10 focus:text-foreground">
          <Link to="/review"><ListChecks />Capture review</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={value => {
          if (value === 'system' || value === 'light' || value === 'dark') setPreference(value);
        }}>
          {(['system', 'light', 'dark'] as const).map(value => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-11 focus:bg-foreground/10 focus:text-foreground">
              {value === 'system' ? 'Follow system' : value === 'light' ? 'Light' : 'Dark'}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
